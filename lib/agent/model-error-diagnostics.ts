import { randomUUID } from "node:crypto";
import { appendFile, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  MODEL_PROTOCOL_FAILURE_CODES,
  MODEL_TRANSPORT_FAILURE_CODES,
  type ModelResponseObservation,
  type ModelProtocolFailureCode,
  type ModelTransportFailureCode,
} from "@/lib/ai/client";

const MAX_CAUSE_DEPTH = 12;
const MAX_DIAGNOSTIC_EVENTS = 8;
const MAX_LABEL_LENGTH = 160;
const MAX_LOG_LINE_BYTES = 64 * 1024;
const protocolCodes = new Set<string>(MODEL_PROTOCOL_FAILURE_CODES);
const transportCodes = new Set<string>(MODEL_TRANSPORT_FAILURE_CODES);
const modelServiceCodes = new Set([
  "RATE_LIMIT",
  "PROVIDER_STATUS",
  "TIMEOUT",
  "CANCELLED",
  "TRANSPORT",
  "INVALID_RESPONSE",
]);
const diagnosticCodes = new Set<string>([
  ...modelServiceCodes,
  ...MODEL_TRANSPORT_FAILURE_CODES,
  ...MODEL_PROTOCOL_FAILURE_CODES,
  "ABORT_ERR",
]);
const diagnosticErrorNames = new Set([
  "Error",
  "TypeError",
  "SyntaxError",
  "RangeError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
  "DOMException",
  "ModelServiceError",
  "ModelResponseTransportError",
  "ModelResponseProtocolError",
  "ZodError",
  "$ZodError",
]);
const diagnosticSyscalls = new Set([
  "connect",
  "fetch",
  "getaddrinfo",
  "open",
  "read",
  "write",
]);

export type ModelErrorCauseDiagnostic = {
  name: string;
  message: string;
  code: string | null;
  errno: string | null;
  syscall: string | null;
  httpStatus: number | null;
  transportCode: ModelTransportFailureCode | null;
  protocolCode: ModelProtocolFailureCode | null;
};

export type ModelErrorDiagnosticEvent = {
  errorSummary: string;
  causeChain: ModelErrorCauseDiagnostic[];
  causeChainTruncated: boolean;
  responseObservation?: ModelResponseObservation | null;
};

export type ModelErrorDiagnosticsSnapshot = {
  errorCount: number;
  errorEvents: ModelErrorDiagnosticEvent[];
  errorEventsTruncated: boolean;
  modelTransportErrorCodes: ModelTransportFailureCode[];
  modelProtocolErrorCodes: ModelProtocolFailureCode[];
};

export type ModelErrorDiagnosticLogEntry = {
  recordedAt: string;
  runner: "AGENT_EVAL" | "TUTOR_QUALITY" | "AGENT_RUNTIME";
  stage: string;
  caseId: string | null;
  outcome: "INTERRUPTED" | "RATE_LIMITED" | "DEGRADED_CONTINUED" | "RECOVERED" | "FAILED_CONTINUED";
  errorCode: string | null;
  requestMode: "AGENT_STREAMING" | "NON_STREAMING";
  diagnostics: ModelErrorDiagnosticsSnapshot;
};

export type ModelErrorDiagnosticWriteResult = {
  status: "NOT_NEEDED" | "WRITTEN" | "REDACTED" | "UNAVAILABLE";
  path: string | null;
};

function safeProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeString(value: unknown) {
  try {
    return typeof value === "string" ? value : value === undefined ? "" : String(value);
  } catch {
    return "[UNREADABLE]";
  }
}

function safeConstructorName(value: object) {
  const constructor = safeProperty(value, "constructor");
  return typeof constructor === "function"
    ? safeString(safeProperty(constructor, "name"))
    : "";
}

function createRedactor(values: readonly (string | null | undefined)[]) {
  const exactValues = values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length);
  return (raw: unknown, maximumLength = MAX_LABEL_LENGTH) => {
    let text = safeString(raw);
    try {
      for (const value of exactValues) text = text.replaceAll(value, "[REDACTED]");
      text = text
        .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
        .replace(/([?&](?:api_?key|key|token)=)[^&\s]+/gi, "$1[REDACTED]")
        .replace(/:\/\/[^:@/\s]+:[^@/\s]+@/g, "://[REDACTED]@")
        .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[REDACTED_HOST]")
        .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?\b/gi, "[REDACTED_HOST]")
        .replace(/\b(?:sk|rk|pk|key|token)[-_][A-Za-z0-9_-]{12,}\b/gi, "[REDACTED_TOKEN]")
        .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, "[REDACTED_TOKEN]")
        .replace(/\b[A-Z]:\\[^\r\n]*/gi, "[REDACTED_PATH]")
        .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
        .replace(/\b1\d{10}\b/g, "[REDACTED_PHONE]")
        .replace(
          /\b(?:provider\s+)?(?:payload|request\s+body|response\s+body)\s*[:=]\s*[^\r\n]*/gi,
          "[REDACTED_PROVIDER_PAYLOAD]",
        )
        .replace(
          /("(?:authorization|api[_-]?key|token|messages?|input|body|payload|prompt|content)"\s*:\s*)"(?:\\.|[^"])*"/gi,
          "$1\"[REDACTED]\"",
        );
    } catch {
      return "[REDACTION_FAILED]";
    }
    return text.slice(0, maximumLength);
  };
}

function safeMetadata(
  value: unknown,
  redact: ReturnType<typeof createRedactor>,
  pattern: RegExp,
) {
  const candidate = redact(value, MAX_LABEL_LENGTH);
  return pattern.test(candidate) ? candidate : null;
}

function safeErrorName(value: unknown, redact: ReturnType<typeof createRedactor>) {
  const candidate = safeMetadata(value, redact, /^[A-Za-z_$][A-Za-z0-9_$.-]{0,79}$/);
  return candidate && diagnosticErrorNames.has(candidate) ? candidate : "Error";
}

function safeErrorCode(value: unknown, redact: ReturnType<typeof createRedactor>) {
  const candidate = safeMetadata(value, redact, /^[A-Z][A-Z0-9_.-]{0,79}$/);
  return candidate && diagnosticCodes.has(candidate) ? candidate : null;
}

function safeErrno(value: unknown, redact: ReturnType<typeof createRedactor>) {
  const candidate = safeMetadata(value, redact, /^(?:-?\d{1,12}|[A-Z][A-Z0-9_.-]{0,79})$/);
  return candidate && (/^-?\d{1,12}$/.test(candidate) || transportCodes.has(candidate))
    ? candidate
    : null;
}

function safeSyscall(value: unknown, redact: ReturnType<typeof createRedactor>) {
  const candidate = safeMetadata(value, redact, /^[a-z][a-z0-9_.:-]{0,79}$/);
  return candidate && diagnosticSyscalls.has(candidate) ? candidate : null;
}

function allowlistedTransportCode(value: unknown): ModelTransportFailureCode | null {
  return typeof value === "string" && transportCodes.has(value)
    ? value as ModelTransportFailureCode
    : null;
}

function allowlistedProtocolCode(value: unknown): ModelProtocolFailureCode | null {
  return typeof value === "string" && protocolCodes.has(value)
    ? value as ModelProtocolFailureCode
    : null;
}

function safeHttpStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function safeResponseObservation(value: unknown): ModelResponseObservation | null {
  if (typeof value !== "object" || value === null) return null;
  const object = value as Record<string, unknown>;
  const rawEventTypes = Array.isArray(object.eventTypes) ? object.eventTypes : [];
  const eventTypes = rawEventTypes.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.type !== "string" || !candidate.type.trim()) return [];
    const count = typeof candidate.count === "number" && Number.isInteger(candidate.count)
      ? Math.max(1, Math.min(999, candidate.count))
      : 1;
    return [{
      type: candidate.type
        .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "�")
        .trim()
        .slice(0, 96),
      count,
      unknown: candidate.unknown === true,
    }];
  }).filter(({ type }) => type).slice(0, 32);
  const lengths = typeof object.textLengths === "object" && object.textLengths !== null
    ? object.textLengths as Record<string, unknown>
    : {};
  const safeLength = (key: string) => {
    const value = lengths[key];
    return typeof value === "number" && Number.isInteger(value)
      ? Math.max(0, Math.min(32_000, value))
      : 0;
  };
  return {
    eventTypes,
    eventTypesTruncated: object.eventTypesTruncated === true,
    completedSeen: object.completedSeen === true,
    textLengths: {
      streamedText: safeLength("streamedText"),
      doneText: safeLength("doneText"),
      completedMessageText: safeLength("completedMessageText"),
    },
    attemptComplete: object.attemptComplete === true,
  };
}

function diagnosticSummary(chain: readonly ModelErrorCauseDiagnostic[]) {
  const protocolCode = chain.find(({ protocolCode }) => protocolCode)?.protocolCode;
  if (protocolCode) return `MODEL_INVALID_RESPONSE:${protocolCode}`;
  const transportCode = chain.find(({ transportCode }) => transportCode)?.transportCode;
  if (transportCode) return `MODEL_TRANSPORT:${transportCode}`;
  const serviceCode = chain.map(({ code }) => code).find((code) => code && modelServiceCodes.has(code));
  return serviceCode ? `MODEL_${serviceCode}` : "MODEL_ERROR_RECORDED";
}

function diagnosticMessage(input: {
  rootServiceCode: string | null;
  name: string;
  code: string | null;
  transportCode: ModelTransportFailureCode | null;
  protocolCode: ModelProtocolFailureCode | null;
}) {
  if (
    input.rootServiceCode === "INVALID_RESPONSE"
    || input.protocolCode
    || /(?:Syntax|Zod|Protocol)/i.test(input.name)
  ) {
    return "model response detail redacted";
  }
  if (
    input.rootServiceCode === "TRANSPORT"
    || input.transportCode
    || allowlistedTransportCode(input.code)
  ) {
    return "model transport detail redacted";
  }
  if (input.rootServiceCode) return "model service detail redacted";
  return "error detail redacted";
}

function serializeCauseChain(error: unknown, redact: ReturnType<typeof createRedactor>) {
  const chain: ModelErrorCauseDiagnostic[] = [];
  const seen = new Set<object>();
  const responseObservation = typeof error === "object" && error !== null
    ? safeResponseObservation(safeProperty(error, "responseObservation"))
    : null;
  const rawRootCode = typeof error === "object" && error !== null
    ? safeProperty(error, "code")
    : null;
  const rootServiceCode = typeof rawRootCode === "string" && modelServiceCodes.has(rawRootCode)
    ? rawRootCode
    : null;
  let current: unknown = error;
  let truncated = false;
  while (current !== null && current !== undefined) {
    if (chain.length >= MAX_CAUSE_DEPTH) {
      truncated = true;
      break;
    }
    if (typeof current !== "object") {
      chain.push({
        name: typeof current,
        message: rootServiceCode
          ? "model service detail redacted"
          : "error detail redacted",
        code: null,
        errno: null,
        syscall: null,
        httpStatus: null,
        transportCode: null,
        protocolCode: null,
      });
      break;
    }
    if (seen.has(current)) {
      truncated = true;
      break;
    }
    seen.add(current);
    const name = safeErrorName(
      safeProperty(current, "name") ?? safeConstructorName(current),
      redact,
    );
    const code = safeErrorCode(safeProperty(current, "code"), redact);
    const errno = safeErrno(safeProperty(current, "errno"), redact);
    const syscall = safeSyscall(safeProperty(current, "syscall"), redact);
    const transportCode = allowlistedTransportCode(safeProperty(current, "transportCode"))
      ?? allowlistedTransportCode(code);
    const protocolCode = allowlistedProtocolCode(safeProperty(current, "protocolCode"));
    chain.push({
      name,
      message: diagnosticMessage({
        rootServiceCode,
        name,
        code,
        transportCode,
        protocolCode,
      }),
      code,
      errno,
      syscall,
      httpStatus: safeHttpStatus(safeProperty(current, "httpStatus")),
      transportCode,
      protocolCode,
    });
    current = safeProperty(current, "cause");
  }
  return { chain, truncated, responseObservation };
}

export function createModelErrorDiagnostics(input: {
  redactValues?: readonly (string | null | undefined)[];
} = {}) {
  const redact = createRedactor(input.redactValues ?? []);
  const observedProtocolCodes = new Set<ModelProtocolFailureCode>();
  const observedTransportCodes = new Set<ModelTransportFailureCode>();
  const observedErrors = new WeakSet<object>();
  const events: ModelErrorDiagnosticEvent[] = [];
  let errorCount = 0;
  let eventsTruncated = false;
  return {
    record(error: unknown) {
      if (typeof error === "object" && error !== null) {
        if (observedErrors.has(error)) return;
        observedErrors.add(error);
      }
      errorCount += 1;
      try {
        const serialized = serializeCauseChain(error, redact);
        for (const entry of serialized.chain) {
          if (entry.protocolCode) observedProtocolCodes.add(entry.protocolCode);
          if (entry.transportCode) observedTransportCodes.add(entry.transportCode);
          const transportCode = allowlistedTransportCode(entry.code);
          if (transportCode) observedTransportCodes.add(transportCode);
        }
        if (events.length < MAX_DIAGNOSTIC_EVENTS) {
          events.push({
            errorSummary: diagnosticSummary(serialized.chain),
            causeChain: serialized.chain,
            causeChainTruncated: serialized.truncated,
            responseObservation: serialized.responseObservation,
          });
        } else {
          eventsTruncated = true;
        }
      } catch {
        if (events.length < MAX_DIAGNOSTIC_EVENTS) {
          events.push({
            errorSummary: "MODEL_DIAGNOSTIC_SERIALIZATION_FAILED",
            causeChain: [],
            causeChainTruncated: true,
            responseObservation: null,
          });
        } else {
          eventsTruncated = true;
        }
      }
    },
    snapshot(): ModelErrorDiagnosticsSnapshot {
      return {
        errorCount,
        errorEvents: events.map((event) => ({
          ...event,
          causeChain: event.causeChain.map((entry) => ({ ...entry })),
        })),
        errorEventsTruncated: eventsTruncated,
        modelTransportErrorCodes: [...observedTransportCodes].slice(0, 4),
        modelProtocolErrorCodes: [...observedProtocolCodes].slice(0, 4),
      };
    },
  };
}

export function consoleModelErrorDiagnostics(snapshot: ModelErrorDiagnosticsSnapshot) {
  return {
    transportCode: snapshot.modelTransportErrorCodes.at(-1) ?? null,
    protocolCode: snapshot.modelProtocolErrorCodes.at(-1) ?? null,
    errorSummary: snapshot.errorEvents.at(-1)?.errorSummary ?? "MODEL_DIAGNOSTIC_UNAVAILABLE",
  };
}

function isInside(candidate: string, parent: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

type DiagnosticEnvironment = Readonly<Record<string, string | undefined>>;

function diagnosticRoot(environment: DiagnosticEnvironment, repositoryRoot: string) {
  const localAppData = environment.LOCALAPPDATA?.trim();
  const candidates = [
    localAppData && path.isAbsolute(localAppData)
      ? path.join(localAppData, "ChuyingAI", "diagnostics")
      : null,
    path.join(tmpdir(), "ChuyingAI", "diagnostics"),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => !isInside(path.resolve(candidate), repositoryRoot)) ?? null;
}

function safeLogFallback(entry: ModelErrorDiagnosticLogEntry): ModelErrorDiagnosticLogEntry {
  return {
    ...entry,
    caseId: entry.caseId?.slice(0, MAX_LABEL_LENGTH) ?? null,
    diagnostics: {
      errorCount: entry.diagnostics.errorCount,
      errorEvents: entry.diagnostics.errorEvents.map(({ errorSummary, causeChainTruncated, responseObservation }) => ({
        errorSummary,
        causeChain: [],
        causeChainTruncated,
        responseObservation: responseObservation ?? null,
      })),
      errorEventsTruncated: entry.diagnostics.errorEventsTruncated,
      modelTransportErrorCodes: entry.diagnostics.modelTransportErrorCodes,
      modelProtocolErrorCodes: entry.diagnostics.modelProtocolErrorCodes,
    },
  };
}

export function createLocalModelErrorDiagnosticLog(input: {
  runner: "agent-eval" | "tutor-quality" | "agent-runtime";
  environment?: DiagnosticEnvironment;
  repositoryRoot?: string;
  now?: Date;
}) {
  const environment = input.environment ?? process.env;
  const repositoryRoot = path.resolve(input.repositoryRoot ?? process.cwd());
  const root = diagnosticRoot(environment, repositoryRoot);
  const runId = randomUUID();
  const timestamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const filePath = root
    ? path.join(root, `${input.runner}-${timestamp}-${process.pid}-${runId}.jsonl`)
    : null;
  let initialized = false;
  let unavailable = filePath === null;

  return {
    path: filePath,
    async append(
      entry: ModelErrorDiagnosticLogEntry,
      validate?: (text: string) => void,
    ): Promise<ModelErrorDiagnosticWriteResult> {
      if (entry.diagnostics.errorCount < 1) return { status: "NOT_NEEDED", path: null };
      if (!filePath || unavailable) return { status: "UNAVAILABLE", path: null };
      let status: ModelErrorDiagnosticWriteResult["status"] = "WRITTEN";
      let candidate = entry;
      let line = "";
      try {
        line = JSON.stringify(candidate);
        validate?.(line);
      } catch {
        status = "REDACTED";
        candidate = safeLogFallback(entry);
        try {
          line = JSON.stringify(candidate);
          validate?.(line);
        } catch {
          return { status: "UNAVAILABLE", path: null };
        }
      }
      if (Buffer.byteLength(line, "utf8") > MAX_LOG_LINE_BYTES) {
        status = "REDACTED";
        candidate = safeLogFallback(entry);
        try {
          line = JSON.stringify(candidate);
          validate?.(line);
        } catch {
          return { status: "UNAVAILABLE", path: null };
        }
        if (Buffer.byteLength(line, "utf8") > MAX_LOG_LINE_BYTES) {
          return { status: "UNAVAILABLE", path: null };
        }
      }
      try {
        if (!initialized) {
          await mkdir(path.dirname(filePath), { recursive: true });
          const [physicalDirectory, physicalRepositoryRoot] = await Promise.all([
            realpath(path.dirname(filePath)),
            realpath(repositoryRoot),
          ]);
          if (isInside(physicalDirectory, physicalRepositoryRoot)) {
            unavailable = true;
            return { status: "UNAVAILABLE", path: null };
          }
          await writeFile(filePath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
          initialized = true;
        }
        await appendFile(filePath, `${line}\n`, "utf8");
        return { status, path: filePath };
      } catch {
        unavailable = true;
        return { status: "UNAVAILABLE", path: null };
      }
    },
  };
}

import {
  StudentMemoryCandidateSchema,
  type StudentMemoryCandidate,
  type StudentMemoryPublic,
} from "@/lib/domain/student-memory";
import {
  redactSensitiveText,
  studentNumberPolicyFromEnvironment,
} from "@/lib/security/redaction";

export type StudentMemoryWriteCandidate = Pick<
  StudentMemoryPublic,
  "kind" | "content" | "salience"
> & {
  embedding?: {
    cacheKey: string;
    vector: readonly number[];
  };
};

type CandidateOptions = {
  environment?: Record<string, string | undefined>;
  sidecarCandidates?: readonly StudentMemoryCandidate[];
};

const EXPLICIT_MEMORY_PATTERNS: Array<{
  kind: StudentMemoryWriteCandidate["kind"];
  salience: number;
  matches: (sentence: string) => boolean;
}> = [
  {
    kind: "MISCONCEPTION_CORRECTED",
    salience: 2,
    matches: (sentence) => isExplicitSelfReport(sentence)
      && /(?:原来|我之前以为).*(?:不是|不应该).*(?:而是|其实|现在)/.test(sentence),
  },
  {
    kind: "RECURRING_STRUGGLE",
    salience: 2,
    matches: (sentence) => isExplicitSelfReport(sentence)
      && /我(?!的?(?:朋友|同学|老师|家人|组员|队友|学生))[^。！？!?]{0,40}(?:一直|总是|反复|每次|又|经常)[^。！？!?]{0,80}(?:卡住|卡在|不会|搞不懂|出错|失败)/.test(sentence),
  },
  {
    kind: "LEARNED_CONCEPT",
    salience: 2,
    matches: (sentence) => isExplicitSelfReport(sentence)
      && /我(?!的?(?:朋友|同学|老师|家人|组员|队友|学生)).*(?:已经理解|已经明白|学会了|会用了|弄懂了|明白了)/.test(sentence),
  },
  {
    kind: "PREFERENCE",
    salience: 1,
    matches: (sentence) => isExplicitSelfReport(sentence)
      && /我(?!的?(?:朋友|同学|老师|家人|组员|队友|学生)).*(?:更喜欢|喜欢|偏好|习惯|希望以后|不喜欢)/.test(sentence),
  },
  {
    kind: "PROJECT_FACT",
    salience: 2,
    matches: (sentence) => isExplicitSelfReport(sentence)
      && /(?:我(?:正在|目前正在|这次在)(?:做|制作|设计|开发|研究|尝试)|我的(?:项目|作品|课题)(?:正在|是|使用|采用|面向|要做|包含|已经|计划|聚焦)|这次(?:项目|作品|课题)(?:正在|是|使用|采用|面向|要做|包含|已经|计划|聚焦))/.test(sentence),
  },
];

function isExplicitSelfReport(sentence: string) {
  if (/[?？]\s*$/.test(sentence)) return false;
  if (/(?:^|[，,；;。！!])(?:如果|假如|假设|比如|例如)[^。！？!?]*(?:我|我的)/.test(sentence)) return false;
  return /(?:^|[，,；;。！!])我(?!的?(?:朋友|同学|老师|家人|组员|队友|学生))/.test(sentence);
}

function comparable(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function sentences(value: string) {
  return value.match(/[^。！？!?\n]+[。！？!?]?/g)?.map((item) => item.trim()).filter(Boolean) ?? [];
}

function redact(value: string, environment: Record<string, string | undefined>) {
  return redactSensitiveText(value, {
    studentNumber: studentNumberPolicyFromEnvironment(environment),
  }).trim();
}

export function extractExplicitStudentMemoryCandidates(
  studentMessage: string,
  options: Pick<CandidateOptions, "environment"> = {},
): StudentMemoryCandidate[] {
  const environment = options.environment ?? process.env;
  const protectedMessage = redact(studentMessage, environment);
  const found: StudentMemoryCandidate[] = [];
  for (const pattern of EXPLICIT_MEMORY_PATTERNS) {
    const evidenceQuote = sentences(protectedMessage).find(pattern.matches);
    if (!evidenceQuote) continue;
    found.push({ kind: pattern.kind, evidenceQuote, salience: pattern.salience });
    if (found.length >= 3) break;
  }
  return found;
}

export function collectStudentMemoryCandidates(
  studentMessage: string,
  options: CandidateOptions = {},
): StudentMemoryWriteCandidate[] {
  const environment = options.environment ?? process.env;
  const protectedMessage = redact(studentMessage, environment);
  const comparableMessage = comparable(protectedMessage);
  const candidates = [
    ...(options.sidecarCandidates ?? []),
    ...extractExplicitStudentMemoryCandidates(protectedMessage, { environment }),
  ];
  const byKey = new Map<string, StudentMemoryWriteCandidate>();
  for (const rawCandidate of candidates) {
    const parsed = StudentMemoryCandidateSchema.safeParse(rawCandidate);
    if (!parsed.success) continue;
    const content = redact(parsed.data.evidenceQuote, environment);
    const comparableContent = comparable(content);
    if (!comparableContent || !comparableMessage.includes(comparableContent)) continue;
    const key = `${parsed.data.kind}:${comparableContent}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      kind: parsed.data.kind,
      content,
      salience: Math.max(existing?.salience ?? 1, parsed.data.salience),
    });
  }
  return Array.from(byKey.values()).slice(0, 3);
}

import { z } from "zod";

import { AgentRequestedCapabilitySchema } from "./requested-capability";

import { LearningEpisodeSchema } from "@/lib/course-packs/contract";
import { ToolAdapterTargetSchema } from "@/lib/tool-adapters/contract";
import { normalizePublicHttpsUrl } from "@/lib/security/public-web-url";
import { ProjectBriefPatchSchema, ProjectBriefSchema } from "./project-brief-contract";
import { MAX_AGENT_TURN_LATENCY_MS } from "./latency-limits";
import { AgentRuntimeDescriptorSchema, AgentRuntimeEventSchema } from "./runtime/trace-contract";
import { CritiqueResultSchema } from "./critique-contract";

const SHA256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}

/** Isomorphic SHA-256 used to bind a one-turn consent token to its exact message. */
export function externalSearchMessageDigest(message: string) {
  const input = new TextEncoder().encode(message.normalize("NFKC").trim());
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state: number[] = [...SHA256_INITIAL_STATE];
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous = schedule[index - 15]!;
      const recent = schedule[index - 2]!;
      const sigma0 = rotateRight(previous, 7) ^ rotateRight(previous, 18) ^ (previous >>> 3);
      const sigma1 = rotateRight(recent, 17) ^ rotateRight(recent, 19) ^ (recent >>> 10);
      schedule[index] = (schedule[index - 16]! + sigma0 + schedule[index - 7]! + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const first = (h! + bigSigma1 + choice + SHA256_ROUND_CONSTANTS[index]! + schedule[index]!) >>> 0;
      const bigSigma0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const second = (bigSigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + first) >>> 0;
      d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }

  return state.map((value) => value.toString(16).padStart(8, "0")).join("");
}

export const AgentViewSchema = z.enum([
  "AGENT",
  "WORKSPACE",
  "EVIDENCE",
  "RESOURCES",
  "NODE_CANVAS",
  "CASE_LIBRARY",
  "KNOWLEDGE_MAP",
  "PROJECT",
  "BOOK_LAYOUT_LAB",
]);

export const DesignSpecialtySchema = z.enum([
  "GENERAL_DESIGN",
  "DIGITAL_INTERACTION",
  "BOOK_DESIGN",
]);

export const AgentTurnRequestSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    clientMessageId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional(),
    message: z.string().trim().min(1).max(2_000),
    capability: AgentRequestedCapabilitySchema.optional(),
    externalSearchConsent: z.object({
      nonce: z.string().uuid(),
      messageDigest: z.string().regex(/^[a-f0-9]{64}$/),
      issuedAt: z.number().int().min(0).max(9_007_199_254_740_991),
    }).strict().optional(),
    /**
     * Server-authored only.  The public request parser rejects this field;
     * it is stored on a continuation run so the model receives only the
     * learner-visible tail that needs to be completed.
     */
    continuation: z.object({
      sourceRunId: z.string().uuid(),
      previousText: z.string().trim().min(1).max(32_000),
      attempt: z.number().int().min(1).max(3),
    }).strict().optional(),
    context: z
      .object({
        view: AgentViewSchema.default("AGENT"),
        focus: z.string().trim().min(1).max(160).nullable().optional(),
      })
      .strict()
      .default({ view: "AGENT" }),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.externalSearchConsent
      && request.externalSearchConsent.messageDigest !== externalSearchMessageDigest(request.message)
    ) {
      context.addIssue({
        code: "custom",
        path: ["externalSearchConsent", "messageDigest"],
        message: "external search consent must match the submitted message",
      });
    }
  });

const PrivateAgentArtworkAttachmentSchema = z.object({
  id: z.string().uuid(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().positive().max(5 * 1024 * 1024),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  previewUrl: z.string().regex(/^\/api\/agent\/artworks\/[0-9a-f-]{36}$/),
}).strict();

export const AgentDemoArtworkPreviewUrlSchema = z.enum([
  "/demo/digital-interaction-proposal-board-preset.svg",
  "/demo/digital-interaction-three-states-preset.svg",
  "/demo/layout-poster-before-preset.svg",
  "/demo/layout-poster-after-preset.svg",
]);

const DemoAgentArtworkAttachmentSchema = z.object({
  id: z.string().uuid(),
  mimeType: z.literal("image/svg+xml"),
  byteSize: z.number().int().positive().max(5 * 1024 * 1024),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  previewUrl: AgentDemoArtworkPreviewUrlSchema,
}).strict();

/** Private uploads stay raster-only; SVG is allowed only for registered static demo presets. */
export const AgentArtworkAttachmentSchema = z.union([
  PrivateAgentArtworkAttachmentSchema,
  DemoAgentArtworkAttachmentSchema,
]);

export const AgentActionTypeSchema = z.enum([
  "OPEN_WORKSPACE",
  "OPEN_RESOURCE",
  "START_DIAGNOSTIC",
  "REQUEST_EVIDENCE",
  "START_TROUBLESHOOTING",
  "START_TRANSFER",
  "ESCALATE_TEACHER",
]);

export const AgentActionStatusSchema = z.enum(["PROPOSED", "EXECUTED", "REJECTED", "EXPIRED"]);

export const AgentResponseStrategySchema = z.enum([
  "DIRECT_INSTRUCTION",
  "CONCEPT_EXPLANATION",
  "DIAGNOSTIC_GUIDANCE",
  "TRANSFER_COACHING",
  "REFLECTION_PROMPT",
  "CLARIFY",
  "OUT_OF_SCOPE",
]);

export const AgentPolicyTraceSchema = z.object({
  policyId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  policyVersion: z.string().regex(/^[1-9][0-9]{0,7}$/),
  budgets: z.object({
    modelDecisions: z.number().int().min(0).max(8),
    maxModelDecisions: z.number().int().min(1).max(8),
    modelRetries: z.number().int().min(0).max(16).default(0),
    toolCalls: z.number().int().min(0).max(12),
    maxToolCalls: z.number().int().min(1).max(12),
    turnTimeoutMs: z.number().int().min(5_000).max(MAX_AGENT_TURN_LATENCY_MS),
  }).strict(),
  autonomy: z.object({
    readOnlyTools: z.literal("AUTOMATIC"),
    studentMutations: z.literal("STUDENT_CONFIRMATION"),
    formalAuthority: z.literal("FORBIDDEN"),
  }).strict(),
  appliedRules: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/)).max(20),
}).strict().superRefine((trace, context) => {
  if (trace.budgets.modelDecisions > trace.budgets.maxModelDecisions) {
    context.addIssue({ code: "custom", path: ["budgets", "modelDecisions"], message: "model decision budget exceeded" });
  }
  if (trace.budgets.modelRetries > trace.budgets.maxModelDecisions * 2) {
    context.addIssue({ code: "custom", path: ["budgets", "modelRetries"], message: "model retry budget exceeded" });
  }
  if (trace.budgets.toolCalls > trace.budgets.maxToolCalls) {
    context.addIssue({ code: "custom", path: ["budgets", "toolCalls"], message: "tool call budget exceeded" });
  }
});

export const AgentExecutionStepSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().min(1).max(24),
  kind: z.enum(["MODEL_DECISION", "TOOL_CALL", "TOOL_OBSERVATION", "FINAL_RESPONSE", "DEGRADED"]),
  status: z.enum(["SUCCEEDED", "FAILED", "EMPTY", "SKIPPED"]),
  label: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(300),
  toolCallId: z.string().uuid().nullable(),
  toolId: z.string().max(80).nullable(),
  latencyMs: z.number().int().min(0).max(MAX_AGENT_TURN_LATENCY_MS),
}).strict();

export const AgentActionCardSchema = z
  .object({
    id: z.string().uuid(),
    type: AgentActionTypeSchema,
    label: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(240),
    target: ToolAdapterTargetSchema,
    focus: z.string().trim().min(1).max(160).nullable(),
    status: AgentActionStatusSchema,
  })
  .strict();

export const AgentSourceSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().min(1).max(160),
    authority: z.enum(["OFFICIAL", "COURSE_DESIGN", "TEACHER_EXPERIENCE", "ANONYMIZED_CASE", "LEARNING_RECORD", "STUDENT_ARTWORK", "PUBLIC_WEB"]),
    scope: z.string().min(1).max(300),
    url: z.string().trim().max(2_048).superRefine((value, context) => {
      if (!normalizePublicHttpsUrl(value)) {
        context.addIssue({ code: "custom", message: "public web source URL must be public HTTPS" });
      }
    }).optional(),
  })
  .strict();

export const AgentAnswerBasisSchema = z.object({
  kind: z.enum([
    "GENERAL_DESIGN",
    "COURSE_KNOWLEDGE",
    "CASE_EVIDENCE",
    "CALCULATION",
    "TOOL_OBSERVATION",
    "LEARNING_RECORD",
    "ARTWORK_OBSERVATION",
    "WEB_RESEARCH",
  ]),
  label: z.string().trim().min(1).max(80),
}).strict();

export const AgentGraphNodeSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(80),
    kind: z.enum(["CONTEXT", "CONCEPT", "EVIDENCE", "ACTION"]),
  })
  .strict();

export const AgentGraphSchema = z
  .object({
    nodes: z.array(AgentGraphNodeSchema).min(2).max(8),
    links: z.array(z.tuple([z.string(), z.string()])).max(12),
  })
  .strict();

export const AgentReplySchema = z
  .object({
    eyebrow: z.string().min(1).max(60),
    title: z.string().min(1).max(100),
    message: z.string().min(1).max(32_000),
    whyThisStep: z.string().min(1).max(500),
    uncertainty: z.string().min(1).max(500),
    graph: AgentGraphSchema,
    sources: z.array(AgentSourceSchema).max(5),
    basis: z.array(AgentAnswerBasisSchema).min(1).max(8).optional(),
    incomplete: z.object({
      reason: z.enum([
        "MODEL_TIMEOUT",
        "MODEL_CONNECTION_INTERRUPTED",
        "MODEL_OUTPUT_TRUNCATED",
      ]),
    }).strict().optional(),
    actions: z.array(AgentActionCardSchema).max(3),
  })
  .strict();

export const AgentTurnResponseSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    conversationId: z.string().uuid(),
    turnId: z.string().uuid(),
    studentMessage: z.string().trim().min(1).max(2_000),
    coursePack: z.object({ id: z.string(), version: z.string(), label: z.string() }).strict(),
    specialty: z.object({ id: DesignSpecialtySchema, label: z.string(), enhanced: z.boolean() }).strict().optional(),
    episode: LearningEpisodeSchema,
    decisionCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    aiMode: z.enum(["MODEL_ASSISTED", "DETERMINISTIC_FALLBACK"]),
    policy: AgentPolicyTraceSchema,
    executionSteps: z.array(AgentExecutionStepSchema).max(24),
    runtime: AgentRuntimeDescriptorSchema.default({ id: "legacy-current-runtime", version: "1.0.0" }),
    runtimeEvents: z.array(AgentRuntimeEventSchema).max(64).default([]),
    createdAt: z.string().datetime(),
    reply: AgentReplySchema,
    critique: CritiqueResultSchema.optional(),
    artworkAttachment: AgentArtworkAttachmentSchema.optional(),
    projectBrief: ProjectBriefSchema.optional(),
  })
  .strict();

export const AgentConversationResponseSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    conversationId: z.string().uuid().nullable(),
    coursePack: z.object({ id: z.string(), version: z.string(), label: z.string() }).strict(),
    turns: z.array(AgentTurnResponseSchema).max(30),
    projectBrief: ProjectBriefSchema.optional(),
    features: z.object({
      externalSearch: z.boolean().default(false),
    }).strict().default({ externalSearch: false }),
  })
  .strict();

export const AgentActionRequestSchema = z
  .object({
    turnId: z.string().uuid(),
    actionId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export const AgentActionExecutionSchema = z
  .object({
    actionId: z.string().uuid(),
    status: z.literal("EXECUTED"),
    alreadyExecuted: z.boolean(),
    navigation: z
      .object({
        target: ToolAdapterTargetSchema,
        focus: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentModelDecisionSchema = z
  .object({
    episode: LearningEpisodeSchema,
    decisionCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    responseStrategy: AgentResponseStrategySchema,
    sourceIds: z.array(z.string().min(1).max(80)).max(5),
    actionType: AgentActionTypeSchema.nullable(),
    title: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(1_200),
    whyThisStep: z.string().trim().min(1).max(500),
    uncertainty: z.string().trim().min(1).max(500),
    briefPatch: ProjectBriefPatchSchema.optional(),
  })
  .strict();

export type AgentTurnRequest = z.infer<typeof AgentTurnRequestSchema>;
export type AgentTurnResponse = z.infer<typeof AgentTurnResponseSchema>;
export type AgentArtworkAttachment = z.infer<typeof AgentArtworkAttachmentSchema>;
export type AgentConversationResponse = z.infer<typeof AgentConversationResponseSchema>;
export type AgentActionExecution = z.infer<typeof AgentActionExecutionSchema>;
export type AgentView = z.infer<typeof AgentViewSchema>;
export type AgentResponseStrategy = z.infer<typeof AgentResponseStrategySchema>;
export type AgentPolicyTrace = z.infer<typeof AgentPolicyTraceSchema>;
export type AgentExecutionStep = z.infer<typeof AgentExecutionStepSchema>;
export type AgentSource = z.infer<typeof AgentSourceSchema>;
export type AgentAnswerBasis = z.infer<typeof AgentAnswerBasisSchema>;
export type DesignSpecialty = z.infer<typeof DesignSpecialtySchema>;

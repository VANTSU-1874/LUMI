import { z } from "zod";

import { ModelBaseUrlSchema } from "./model-url";
import { studentNumberPolicyFromEnvironment } from "@/lib/security/redaction";

const SESSION_SECRET_PLACEHOLDER =
  "replace-with-at-least-32-random-characters";
const DEFAULT_TEACHER_ACCESS_CODE = "teacher-demo-2026";
const TEACHER_ACCESS_CODE_PLACEHOLDER =
  "replace-with-a-private-teacher-code";
const IDENTITY_CODE_PEPPER_PLACEHOLDER =
  "replace-with-an-identity-code-pepper";
const AUTH_PROXY_SECRET_PLACEHOLDER = "replace-with-an-auth-proxy-secret";

const optionalNonEmptyString = z.string().trim().min(1).optional();
const agentV3EnabledSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
const outputTokenString = z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, "LLM_MAX_OUTPUT_TOKENS must be a positive integer")
  .transform(Number)
  .pipe(z.number().int().min(1).max(4096));
const totalTimeoutString = (
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
) => z
  .string()
  .trim()
  .regex(/^[1-9]\d*$/, `${name} must be a positive integer`)
  .default(String(defaultValue))
  .transform(Number)
  .pipe(z.number().int().min(minimum).max(maximum));

const envSchema = z
  .object({
    NODE_ENV: z.string().trim().optional(),
    SESSION_SECRET: z
      .string()
      .trim()
      .min(32)
      .refine((value) => value !== SESSION_SECRET_PLACEHOLDER, {
        message: "SESSION_SECRET must not use the documented placeholder",
      }),
    DATABASE_PATH: z
      .string()
      .trim()
      .min(1)
      .default("./data/tonggan.sqlite"),
    PUBLIC_APP_URL: z.string().trim().url().optional(),
    EVIDENCE_ROOT: z.string().trim().min(1)
      .refine((value) => !/(^|[\\/])public([\\/]|$)/i.test(value), {
        message: "EVIDENCE_ROOT must not be inside a public directory",
      })
      .default("./data/evidence"),
    LLM_BASE_URL: ModelBaseUrlSchema.optional(),
    LLM_API_KEY: optionalNonEmptyString,
    LLM_MODEL: optionalNonEmptyString,
    LLM_EMBEDDING_BASE_URL: ModelBaseUrlSchema.optional(),
    LLM_EMBEDDING_API_KEY: optionalNonEmptyString,
    LLM_EMBEDDING_MODEL: optionalNonEmptyString,
    LLM_MAX_OUTPUT_TOKENS: outputTokenString.optional(),
    LLM_VISION_ENABLED: z.enum(["true", "false"]).default("false")
      .transform((value) => value === "true"),
    AGENT_MODEL_IDLE_TIMEOUT_MS: totalTimeoutString(
      "AGENT_MODEL_IDLE_TIMEOUT_MS",
      75_000,
      1_000,
      600_000,
    ),
    AGENT_MODEL_TOTAL_TIMEOUT_MS: totalTimeoutString(
      "AGENT_MODEL_TOTAL_TIMEOUT_MS",
      600_000,
      1_000,
      600_000,
    ),
    AGENT_TURN_TOTAL_TIMEOUT_MS: totalTimeoutString(
      "AGENT_TURN_TOTAL_TIMEOUT_MS",
      900_000,
      5_000,
      900_000,
    ),
    AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS: totalTimeoutString(
      "AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS",
      120_000,
      1_000,
      600_000,
    ),
    AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS: totalTimeoutString(
      "AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS",
      600_000,
      1_000,
      600_000,
    ),
    AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS: totalTimeoutString(
      "AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS",
      900_000,
      5_000,
      900_000,
    ),
    AGENT_V2_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
    AGENT_V3_ENABLED: agentV3EnabledSchema,
    TEACHER_ACCESS_CODE: z
      .string()
      .trim()
      .min(8)
      .default(DEFAULT_TEACHER_ACCESS_CODE),
    IDENTITY_CODE_PEPPER: z
      .string()
      .trim()
      .min(32)
      .refine((value) => value !== IDENTITY_CODE_PEPPER_PLACEHOLDER, {
        message: "IDENTITY_CODE_PEPPER must not use the documented placeholder",
      })
      .optional(),
    AUTH_PROXY_SECRET: z
      .string()
      .trim()
      .min(32)
      .refine((value) => value !== AUTH_PROXY_SECRET_PLACEHOLDER, {
        message: "AUTH_PROXY_SECRET must not use the documented placeholder",
      })
      .optional(),
  })
  .superRefine((environment, context) => {
    const aiFieldCount = [
      environment.LLM_BASE_URL,
      environment.LLM_API_KEY,
      environment.LLM_MODEL,
    ].filter(Boolean).length;

    if (aiFieldCount > 0 && aiFieldCount < 3) {
      context.addIssue({
        code: "custom",
        path: ["LLM_BASE_URL"],
        message:
          "LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL must all be provided together",
      });
    }

    if (environment.LLM_MAX_OUTPUT_TOKENS !== undefined && aiFieldCount !== 3) {
      context.addIssue({
        code: "custom",
        path: ["LLM_MAX_OUTPUT_TOKENS"],
        message: "LLM_MAX_OUTPUT_TOKENS requires a complete AI configuration",
      });
    }

    const embeddingFields = [
      environment.LLM_EMBEDDING_BASE_URL,
      environment.LLM_EMBEDDING_API_KEY,
      environment.LLM_EMBEDDING_MODEL,
    ];
    const hasEmbeddingConfiguration = embeddingFields.some(Boolean);
    const effectiveEmbeddingFieldCount = [
      environment.LLM_EMBEDDING_BASE_URL ?? environment.LLM_BASE_URL,
      environment.LLM_EMBEDDING_API_KEY ?? environment.LLM_API_KEY,
      environment.LLM_EMBEDDING_MODEL,
    ].filter(Boolean).length;

    if (hasEmbeddingConfiguration && effectiveEmbeddingFieldCount !== 3) {
      context.addIssue({
        code: "custom",
        path: ["LLM_EMBEDDING_MODEL"],
        message:
          "LLM_EMBEDDING_MODEL and an effective embedding base URL/API key must be provided together",
      });
    }

    if (environment.LLM_VISION_ENABLED && aiFieldCount !== 3) {
      context.addIssue({
        code: "custom",
        path: ["LLM_VISION_ENABLED"],
        message: "LLM_VISION_ENABLED requires a complete AI configuration",
      });
    }

    for (const [
      profile,
      modelIdleTimeoutMs,
      modelTimeoutMs,
      turnTimeoutMs,
      idlePath,
      turnPath,
    ] of [
      [
        "online",
        environment.AGENT_MODEL_IDLE_TIMEOUT_MS,
        environment.AGENT_MODEL_TOTAL_TIMEOUT_MS,
        environment.AGENT_TURN_TOTAL_TIMEOUT_MS,
        "AGENT_MODEL_IDLE_TIMEOUT_MS",
        "AGENT_TURN_TOTAL_TIMEOUT_MS",
      ],
      [
        "evaluation",
        environment.AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS,
        environment.AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS,
        environment.AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS,
        "AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS",
        "AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS",
      ],
    ] as const) {
      if (modelIdleTimeoutMs >= modelTimeoutMs) {
        context.addIssue({
          code: "custom",
          path: [idlePath],
          message: `${profile} model idle timeout must be lower than model total timeout`,
        });
      }
      if (modelTimeoutMs >= turnTimeoutMs) {
        context.addIssue({
          code: "custom",
          path: [turnPath],
          message: `${profile} turn timeout must be greater than model timeout`,
        });
      }
    }

    if (
      environment.NODE_ENV === "production" &&
      [DEFAULT_TEACHER_ACCESS_CODE, TEACHER_ACCESS_CODE_PLACEHOLDER].includes(
        environment.TEACHER_ACCESS_CODE,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["TEACHER_ACCESS_CODE"],
        message:
          "TEACHER_ACCESS_CODE must be explicitly configured in production",
      });
    }

    if (
      environment.NODE_ENV === "production" &&
      !environment.AUTH_PROXY_SECRET
    ) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_PROXY_SECRET"],
        message: "AUTH_PROXY_SECRET must be explicitly configured in production",
      });
    }

    if (
      environment.NODE_ENV === "production" &&
      (!environment.IDENTITY_CODE_PEPPER ||
        environment.IDENTITY_CODE_PEPPER === IDENTITY_CODE_PEPPER_PLACEHOLDER)
    ) {
      context.addIssue({
        code: "custom",
        path: ["IDENTITY_CODE_PEPPER"],
        message: "IDENTITY_CODE_PEPPER must be explicitly configured in production",
      });
    }
  });

type Environment = Record<string, string | undefined>;

export function readEnv(environment: Environment = process.env) {
  const parsed = envSchema.parse(environment);
  studentNumberPolicyFromEnvironment(environment);
  const aiEnabled = Boolean(
    parsed.LLM_BASE_URL && parsed.LLM_API_KEY && parsed.LLM_MODEL,
  );

  return {
    sessionSecret: parsed.SESSION_SECRET,
    databasePath: parsed.DATABASE_PATH,
    publicAppUrl: parsed.PUBLIC_APP_URL
      ? new URL(parsed.PUBLIC_APP_URL).origin
      : undefined,
    evidenceRoot: parsed.EVIDENCE_ROOT,
    teacherAccessCode: parsed.TEACHER_ACCESS_CODE,
    identityCodePepper: parsed.IDENTITY_CODE_PEPPER ?? parsed.SESSION_SECRET,
    identityCodePepperSource: parsed.IDENTITY_CODE_PEPPER
      ? ("configured" as const)
      : ("session-secret-fallback" as const),
    authProxySecret: parsed.AUTH_PROXY_SECRET ?? parsed.SESSION_SECRET,
    authProxySecretSource: parsed.AUTH_PROXY_SECRET
      ? ("configured" as const)
      : ("session-secret-fallback" as const),
    ai: {
      enabled: aiEnabled,
      baseUrl: parsed.LLM_BASE_URL,
      apiKey: parsed.LLM_API_KEY,
      model: parsed.LLM_MODEL,
      embeddingBaseUrl:
        parsed.LLM_EMBEDDING_BASE_URL ?? parsed.LLM_BASE_URL,
      embeddingApiKey:
        parsed.LLM_EMBEDDING_API_KEY ?? parsed.LLM_API_KEY,
      embeddingModel: parsed.LLM_EMBEDDING_MODEL,
      maxOutputTokens: parsed.LLM_MAX_OUTPUT_TOKENS ?? 4096,
      vision: parsed.LLM_VISION_ENABLED,
    },
    agentTimeouts: {
      online: {
        modelIdleTimeoutMs: parsed.AGENT_MODEL_IDLE_TIMEOUT_MS,
        modelTotalTimeoutMs: parsed.AGENT_MODEL_TOTAL_TIMEOUT_MS,
        turnTotalTimeoutMs: parsed.AGENT_TURN_TOTAL_TIMEOUT_MS,
      },
      evaluation: {
        modelIdleTimeoutMs: parsed.AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS,
        modelTotalTimeoutMs: parsed.AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS,
        turnTotalTimeoutMs: parsed.AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS,
      },
    },
    agentV2Enabled: parsed.AGENT_V2_ENABLED,
    agentV3Enabled: parsed.AGENT_V3_ENABLED,
  };
}

export function agentV3EnabledFromEnvironment(
  environment: Environment = process.env,
) {
  return agentV3EnabledSchema.parse(environment.AGENT_V3_ENABLED);
}

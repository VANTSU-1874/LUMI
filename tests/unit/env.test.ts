import { describe, expect, it } from "vitest";

import {
  readEnv,
  resolvePlannerModelConfiguration,
} from "@/lib/config/env";

const validSecret = "a".repeat(32);
const validPepper = "p".repeat(32);
const validProxySecret = "x".repeat(32);
const completeChatConfiguration = {
  LLM_BASE_URL: "https://chat.example.com/v1",
  LLM_API_KEY: "chat-test-key",
  LLM_MODEL: "chat-test-model",
};
const completeEmbeddingConfiguration = {
  LLM_EMBEDDING_BASE_URL: "https://embedding.example.com/v1",
  LLM_EMBEDDING_API_KEY: "embedding-test-key",
  LLM_EMBEDDING_MODEL: "embedding-test-model",
};
const completePlannerConfiguration = {
  LLM_PLANNER_BASE_URL: "https://planner.example.com/v1",
  LLM_PLANNER_API_KEY: "planner-test-key",
  LLM_PLANNER_MODEL: "planner-test-model",
};
const completeWebConfiguration = {
  LLM_WEB_BASE_URL: "https://web.example.com/v1",
  LLM_WEB_API_KEY: "web-test-key",
  LLM_WEB_MODEL: "web-test-model",
};

describe("readEnv", () => {
  it("rejects a public evidence root", () => {
    expect(() =>
      readEnv({ SESSION_SECRET: validSecret, EVIDENCE_ROOT: "./public/evidence" }),
    ).toThrow("EVIDENCE_ROOT");
  });
  it("rejects a SESSION_SECRET shorter than 32 characters", () => {
    expect(() => readEnv({ SESSION_SECRET: "too-short" })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("rejects the documented SESSION_SECRET placeholder", () => {
    expect(() =>
      readEnv({
        SESSION_SECRET: "replace-with-at-least-32-random-characters",
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it("rejects a whitespace-only SESSION_SECRET", () => {
    expect(() => readEnv({ SESSION_SECRET: " ".repeat(32) })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("rejects a whitespace-only DATABASE_PATH", () => {
    expect(() =>
      readEnv({ SESSION_SECRET: validSecret, DATABASE_PATH: "   " }),
    ).toThrow(/DATABASE_PATH/);
  });

  it("rejects a whitespace-only TEACHER_ACCESS_CODE", () => {
    expect(() =>
      readEnv({ SESSION_SECRET: validSecret, TEACHER_ACCESS_CODE: "        " }),
    ).toThrow(/TEACHER_ACCESS_CODE/);
  });

  it.each([
    ["missing", undefined],
    ["the development default", "teacher-demo-2026"],
  ])(
    "rejects %s TEACHER_ACCESS_CODE in production",
    (_description, teacherAccessCode) => {
      expect(() =>
        readEnv({
          NODE_ENV: "production",
          SESSION_SECRET: validSecret,
          TEACHER_ACCESS_CODE: teacherAccessCode,
        }),
      ).toThrow(/TEACHER_ACCESS_CODE/);
    },
  );

  it("rejects the documented IDENTITY_CODE_PEPPER placeholder in development", () => {
    expect(() =>
      readEnv({
        SESSION_SECRET: validSecret,
        IDENTITY_CODE_PEPPER: "replace-with-an-identity-code-pepper",
      }),
    ).toThrow(/IDENTITY_CODE_PEPPER/);
  });

  it.each([
    ["missing", undefined],
    ["placeholder", "replace-with-an-auth-proxy-secret"],
  ])("rejects %s AUTH_PROXY_SECRET in production", (_case, proxySecret) => {
    expect(() =>
      readEnv({
        NODE_ENV: "production",
        SESSION_SECRET: validSecret,
        TEACHER_ACCESS_CODE: "private-teacher-code",
        IDENTITY_CODE_PEPPER: validPepper,
        AUTH_PROXY_SECRET: proxySecret,
      }),
    ).toThrow(/AUTH_PROXY_SECRET/);
  });

  it("rejects the documented TEACHER_ACCESS_CODE placeholder in production", () => {
    expect(() =>
      readEnv({
        NODE_ENV: "production",
        SESSION_SECRET: validSecret,
        TEACHER_ACCESS_CODE: "replace-with-a-private-teacher-code",
      }),
    ).toThrow(/TEACHER_ACCESS_CODE/);
  });

  it.each([
    ["missing", undefined],
    ["placeholder", "replace-with-an-identity-code-pepper"],
  ])("rejects %s IDENTITY_CODE_PEPPER in production", (_case, pepper) => {
    expect(() =>
      readEnv({
        NODE_ENV: "production",
        SESSION_SECRET: validSecret,
        TEACHER_ACCESS_CODE: "private-teacher-code",
        IDENTITY_CODE_PEPPER: pepper,
      }),
    ).toThrow(/IDENTITY_CODE_PEPPER/);
  });

  it("disables AI when only a valid SESSION_SECRET is provided", () => {
    const env = readEnv({ SESSION_SECRET: validSecret });

    expect(env.ai.enabled).toBe(false);
    expect(env.teacherAccessCode).toBe("teacher-demo-2026");
    expect(env.identityCodePepper).toBe(validSecret);
    expect(env.identityCodePepperSource).toBe("session-secret-fallback");
    expect(env.authProxySecret).toBe(validSecret);
    expect(env.authProxySecretSource).toBe("session-secret-fallback");
    expect(env.ai.maxOutputTokens).toBe(4096);
    expect(env.ai.embeddingBaseUrl).toBeUndefined();
    expect(env.ai.embeddingApiKey).toBeUndefined();
    expect(env.ai.embeddingModel).toBeUndefined();
    expect(env.ai.web).toBeNull();
    expect(env.ai.vision).toBe(false);
    expect(env.agentTimeouts).toEqual({
      online: {
        modelIdleTimeoutMs: 75_000,
        modelTotalTimeoutMs: 600_000,
        turnTotalTimeoutMs: 900_000,
      },
      evaluation: {
        modelIdleTimeoutMs: 120_000,
        modelTotalTimeoutMs: 600_000,
        turnTotalTimeoutMs: 900_000,
      },
    });
    expect(env.agentV3Enabled).toBe(false);
  });

  it("supports separate online and evaluation total timeout profiles", () => {
    const env = readEnv({
      SESSION_SECRET: validSecret,
      AGENT_MODEL_IDLE_TIMEOUT_MS: "60000",
      AGENT_MODEL_TOTAL_TIMEOUT_MS: "150000",
      AGENT_TURN_TOTAL_TIMEOUT_MS: "240000",
      AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS: "180000",
      AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS: "540000",
      AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS: "840000",
    });

    expect(env.agentTimeouts).toEqual({
      online: {
        modelIdleTimeoutMs: 60_000,
        modelTotalTimeoutMs: 150_000,
        turnTotalTimeoutMs: 240_000,
      },
      evaluation: {
        modelIdleTimeoutMs: 180_000,
        modelTotalTimeoutMs: 540_000,
        turnTotalTimeoutMs: 840_000,
      },
    });
  });

  it.each([
    ["AGENT_MODEL_IDLE_TIMEOUT_MS", "999"],
    ["AGENT_MODEL_TOTAL_TIMEOUT_MS", "999"],
    ["AGENT_MODEL_TOTAL_TIMEOUT_MS", "600001"],
    ["AGENT_TURN_TOTAL_TIMEOUT_MS", "4999"],
    ["AGENT_TURN_TOTAL_TIMEOUT_MS", "900001"],
    ["AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS", "600001"],
    ["AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS", "1.5"],
    ["AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS", "not-a-number"],
  ])("rejects invalid total timeout %s=%s", (name, value) => {
    expect(() => readEnv({ SESSION_SECRET: validSecret, [name]: value }))
      .toThrow(new RegExp(name));
  });

  it.each([
    ["online", { AGENT_MODEL_IDLE_TIMEOUT_MS: "120000", AGENT_MODEL_TOTAL_TIMEOUT_MS: "120000" }],
    ["evaluation", { AGENT_EVAL_MODEL_IDLE_TIMEOUT_MS: "600000", AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS: "600000" }],
  ])("requires the %s model total timeout to exceed its idle timeout", (_profile, timeouts) => {
    expect(() => readEnv({ SESSION_SECRET: validSecret, ...timeouts }))
      .toThrow(/model idle timeout must be lower than model total timeout/);
  });

  it.each([
    ["online", { AGENT_MODEL_TOTAL_TIMEOUT_MS: "180000", AGENT_TURN_TOTAL_TIMEOUT_MS: "180000" }],
    ["evaluation", { AGENT_EVAL_MODEL_TOTAL_TIMEOUT_MS: "600000", AGENT_EVAL_TURN_TOTAL_TIMEOUT_MS: "600000" }],
  ])("requires the %s turn timeout to exceed its model timeout", (_profile, timeouts) => {
    expect(() => readEnv({ SESSION_SECRET: validSecret, ...timeouts }))
      .toThrow(/turn timeout must be greater than model timeout/);
  });

  it.each([
    ["only the base URL", { LLM_BASE_URL: "https://api.example.com/v1" }],
    [
      "only the key and model",
      { LLM_API_KEY: "test-key", LLM_MODEL: "test-model" },
    ],
    [
      "only the base URL and key",
      { LLM_BASE_URL: "https://api.example.com/v1", LLM_API_KEY: "test-key" },
    ],
  ])("rejects partial AI configuration with %s", (_description, aiConfig) => {
    expect(() =>
      readEnv({ SESSION_SECRET: validSecret, ...aiConfig }),
    ).toThrow(/LLM_/);
  });

  it.each([
    {
      ...completeChatConfiguration,
      LLM_WEB_BASE_URL:
        completeWebConfiguration.LLM_WEB_BASE_URL,
    },
    {
      ...completeChatConfiguration,
      LLM_WEB_API_KEY:
        completeWebConfiguration.LLM_WEB_API_KEY,
      LLM_WEB_MODEL:
        completeWebConfiguration.LLM_WEB_MODEL,
    },
    completeWebConfiguration,
  ])("rejects incomplete or Web-only provider configuration", (configuration) => {
    expect(() =>
      readEnv({
        SESSION_SECRET: validSecret,
        ...configuration,
      }),
    ).toThrow(/LLM_WEB_/);
  });

  it("selects a dedicated Web provider without changing the primary model", () => {
    const env = readEnv({
      SESSION_SECRET: validSecret,
      ...completeChatConfiguration,
      ...completeWebConfiguration,
    });

    expect(env.ai.model)
      .toBe(completeChatConfiguration.LLM_MODEL);
    expect(env.ai.web).toEqual({
      baseUrl:
        completeWebConfiguration.LLM_WEB_BASE_URL,
      apiKey:
        completeWebConfiguration.LLM_WEB_API_KEY,
      model:
        completeWebConfiguration.LLM_WEB_MODEL,
    });
  });

  it("treats three blank Web placeholders as an unconfigured optional provider", () => {
    const env = readEnv({
      SESSION_SECRET: validSecret,
      ...completeChatConfiguration,
      LLM_WEB_BASE_URL: "",
      LLM_WEB_API_KEY: "   ",
      LLM_WEB_MODEL: "",
    });

    expect(env.ai.web).toBeNull();
  });

  it.each(["ftp://api.example.com", "file:///tmp/model"])(
    "rejects the non-HTTP LLM_BASE_URL %s",
    (baseUrl) => {
      expect(() =>
        readEnv({
          SESSION_SECRET: validSecret,
          LLM_BASE_URL: baseUrl,
          LLM_API_KEY: "test-key",
          LLM_MODEL: "test-model",
        }),
      ).toThrow(/LLM_BASE_URL/);
    },
  );

  it.each([
    "http://api.example.com/v1",
    "http://localhost.evil/v1",
    "http://localhost./v1",
    "https://user:pass@api.example.com/v1",
    "https://api.example.com/v1?x=1",
    "https://api.example.com/v1#x",
  ])("rejects unsafe LLM_BASE_URL %s", (baseUrl) => {
    expect(() =>
      readEnv({
        SESSION_SECRET: validSecret,
        LLM_BASE_URL: baseUrl,
        LLM_API_KEY: "test-key",
        LLM_MODEL: "test-model",
      }),
    ).toThrow(/LLM_BASE_URL/);
  });

  it("allows HTTP only for exact loopback model hosts", () => {
    expect(
      readEnv({
        SESSION_SECRET: validSecret,
        LLM_BASE_URL: "http://[::1]:11434/v1/",
        LLM_API_KEY: "test-key",
        LLM_MODEL: "test-model",
      }).ai.baseUrl,
    ).toBe("http://[::1]:11434/v1");
  });

  it.each(["0", "4097", "1.5", "abc"])(
    "rejects invalid LLM_MAX_OUTPUT_TOKENS %s",
    (maxOutputTokens) => {
      expect(() =>
        readEnv({
          SESSION_SECRET: validSecret,
          LLM_BASE_URL: "https://api.example.com/v1",
          LLM_API_KEY: "test-key",
          LLM_MODEL: "test-model",
          LLM_MAX_OUTPUT_TOKENS: maxOutputTokens,
        }),
      ).toThrow(/LLM_MAX_OUTPUT_TOKENS/);
    },
  );

  it("rejects a token cap without a complete AI provider configuration", () => {
    expect(() =>
      readEnv({ SESSION_SECRET: validSecret, LLM_MAX_OUTPUT_TOKENS: "1024" }),
    ).toThrow(/LLM_/);
  });

  it("keeps chat availability independent from an absent embedding model", () => {
    const env = readEnv({
      SESSION_SECRET: validSecret,
      ...completeChatConfiguration,
    });

    expect(env.ai).toMatchObject({
      enabled: true,
      embeddingBaseUrl: completeChatConfiguration.LLM_BASE_URL,
      embeddingApiKey: completeChatConfiguration.LLM_API_KEY,
      embeddingModel: undefined,
    });
  });

  it("selects a dedicated planner model with the primary URL and key as fallbacks", () => {
    const env = readEnv({
      SESSION_SECRET: validSecret,
      ...completeChatConfiguration,
      LLM_PLANNER_MODEL: "planner-fast-model",
    });

    expect(env.ai.model).toBe("chat-test-model");
    expect(resolvePlannerModelConfiguration(env.ai))
      .toEqual({
        enabled: true,
        selection: "planner-override",
        baseUrl: completeChatConfiguration.LLM_BASE_URL,
        apiKey: completeChatConfiguration.LLM_API_KEY,
        model: "planner-fast-model",
        maxOutputTokens: 4096,
        vision: false,
      });
  });

  it("selects a fully dedicated planner provider without changing the primary model", () => {
    const env = readEnv({
      SESSION_SECRET: validSecret,
      ...completeChatConfiguration,
      ...completePlannerConfiguration,
    });

    expect(env.ai.model).toBe("chat-test-model");
    expect(resolvePlannerModelConfiguration(env.ai))
      .toMatchObject({
        enabled: true,
        selection: "planner-override",
        baseUrl: completePlannerConfiguration.LLM_PLANNER_BASE_URL,
        apiKey: completePlannerConfiguration.LLM_PLANNER_API_KEY,
        model: completePlannerConfiguration.LLM_PLANNER_MODEL,
      });
  });

  it("falls back to the primary provider when no planner override is configured", () => {
    const env = readEnv({
      SESSION_SECRET: validSecret,
      ...completeChatConfiguration,
    });

    expect(resolvePlannerModelConfiguration(env.ai))
      .toMatchObject({
        enabled: true,
        selection: "primary-fallback",
        baseUrl: completeChatConfiguration.LLM_BASE_URL,
        apiKey: completeChatConfiguration.LLM_API_KEY,
        model: completeChatConfiguration.LLM_MODEL,
      });
  });

  it.each([
    [
      "a planner model without a primary or dedicated provider",
      { LLM_PLANNER_MODEL: "planner-fast-model" },
    ],
    [
      "a dedicated planner key without a planner model",
      {
        ...completeChatConfiguration,
        LLM_PLANNER_API_KEY: "planner-test-key",
      },
    ],
    [
      "a dedicated planner URL without a planner model",
      {
        ...completeChatConfiguration,
        LLM_PLANNER_BASE_URL: "https://planner.example.com/v1",
      },
    ],
  ])("rejects incomplete planner configuration with %s", (_description, configuration) => {
    expect(() =>
      readEnv({
        SESSION_SECRET: validSecret,
        ...configuration,
      }),
    ).toThrow(/LLM_PLANNER_MODEL/);
  });

  it.each([
    [
      "the chat URL and key",
      { ...completeChatConfiguration, LLM_EMBEDDING_MODEL: "embedding-test-model" },
      completeChatConfiguration.LLM_BASE_URL,
      completeChatConfiguration.LLM_API_KEY,
      true,
    ],
    [
      "a dedicated URL and the chat key",
      {
        ...completeChatConfiguration,
        LLM_EMBEDDING_BASE_URL: completeEmbeddingConfiguration.LLM_EMBEDDING_BASE_URL,
        LLM_EMBEDDING_MODEL: completeEmbeddingConfiguration.LLM_EMBEDDING_MODEL,
      },
      completeEmbeddingConfiguration.LLM_EMBEDDING_BASE_URL,
      completeChatConfiguration.LLM_API_KEY,
      true,
    ],
    [
      "the chat URL and a dedicated key",
      {
        ...completeChatConfiguration,
        LLM_EMBEDDING_API_KEY: completeEmbeddingConfiguration.LLM_EMBEDDING_API_KEY,
        LLM_EMBEDDING_MODEL: completeEmbeddingConfiguration.LLM_EMBEDDING_MODEL,
      },
      completeChatConfiguration.LLM_BASE_URL,
      completeEmbeddingConfiguration.LLM_EMBEDDING_API_KEY,
      true,
    ],
    [
      "a dedicated URL and key",
      { ...completeChatConfiguration, ...completeEmbeddingConfiguration },
      completeEmbeddingConfiguration.LLM_EMBEDDING_BASE_URL,
      completeEmbeddingConfiguration.LLM_EMBEDDING_API_KEY,
      true,
    ],
    [
      "an embedding-only provider",
      completeEmbeddingConfiguration,
      completeEmbeddingConfiguration.LLM_EMBEDDING_BASE_URL,
      completeEmbeddingConfiguration.LLM_EMBEDDING_API_KEY,
      false,
    ],
  ])(
    "resolves embedding credentials from %s",
    (_description, configuration, expectedBaseUrl, expectedApiKey, chatEnabled) => {
      const env = readEnv({ SESSION_SECRET: validSecret, ...configuration });

      expect(env.ai.enabled).toBe(chatEnabled);
      expect(env.ai.embeddingBaseUrl).toBe(expectedBaseUrl);
      expect(env.ai.embeddingApiKey).toBe(expectedApiKey);
      expect(env.ai.embeddingModel).toBe("embedding-test-model");
    },
  );

  it.each([
    ["model only", { LLM_EMBEDDING_MODEL: "embedding-test-model" }],
    [
      "model and URL only",
      {
        LLM_EMBEDDING_BASE_URL: completeEmbeddingConfiguration.LLM_EMBEDDING_BASE_URL,
        LLM_EMBEDDING_MODEL: completeEmbeddingConfiguration.LLM_EMBEDDING_MODEL,
      },
    ],
    [
      "model and key only",
      {
        LLM_EMBEDDING_API_KEY: completeEmbeddingConfiguration.LLM_EMBEDDING_API_KEY,
        LLM_EMBEDDING_MODEL: completeEmbeddingConfiguration.LLM_EMBEDDING_MODEL,
      },
    ],
    ["URL only", { LLM_EMBEDDING_BASE_URL: completeEmbeddingConfiguration.LLM_EMBEDDING_BASE_URL }],
    ["key only", { LLM_EMBEDDING_API_KEY: completeEmbeddingConfiguration.LLM_EMBEDDING_API_KEY }],
    [
      "URL and key without a model",
      {
        LLM_EMBEDDING_BASE_URL: completeEmbeddingConfiguration.LLM_EMBEDDING_BASE_URL,
        LLM_EMBEDDING_API_KEY: completeEmbeddingConfiguration.LLM_EMBEDDING_API_KEY,
      },
    ],
    [
      "a dedicated URL with chat but no embedding model",
      {
        ...completeChatConfiguration,
        LLM_EMBEDDING_BASE_URL: completeEmbeddingConfiguration.LLM_EMBEDDING_BASE_URL,
      },
    ],
    [
      "a dedicated key with chat but no embedding model",
      {
        ...completeChatConfiguration,
        LLM_EMBEDDING_API_KEY: completeEmbeddingConfiguration.LLM_EMBEDDING_API_KEY,
      },
    ],
    [
      "a dedicated URL and key with chat but no embedding model",
      {
        ...completeChatConfiguration,
        LLM_EMBEDDING_BASE_URL: completeEmbeddingConfiguration.LLM_EMBEDDING_BASE_URL,
        LLM_EMBEDDING_API_KEY: completeEmbeddingConfiguration.LLM_EMBEDDING_API_KEY,
      },
    ],
  ])("rejects incomplete embedding configuration with %s", (_description, configuration) => {
    expect(() => readEnv({ SESSION_SECRET: validSecret, ...configuration }))
      .toThrow(/LLM_EMBEDDING_MODEL/);
  });

  it.each([
    ["base URL only", { LLM_BASE_URL: completeChatConfiguration.LLM_BASE_URL }],
    ["API key only", { LLM_API_KEY: completeChatConfiguration.LLM_API_KEY }],
    ["model only", { LLM_MODEL: completeChatConfiguration.LLM_MODEL }],
    [
      "base URL and API key",
      {
        LLM_BASE_URL: completeChatConfiguration.LLM_BASE_URL,
        LLM_API_KEY: completeChatConfiguration.LLM_API_KEY,
      },
    ],
    [
      "base URL and model",
      {
        LLM_BASE_URL: completeChatConfiguration.LLM_BASE_URL,
        LLM_MODEL: completeChatConfiguration.LLM_MODEL,
      },
    ],
    [
      "API key and model",
      {
        LLM_API_KEY: completeChatConfiguration.LLM_API_KEY,
        LLM_MODEL: completeChatConfiguration.LLM_MODEL,
      },
    ],
  ])("rejects incomplete chat configuration with a complete embedding provider: %s", (
    _description,
    partialChat,
  ) => {
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      ...completeEmbeddingConfiguration,
      ...partialChat,
    })).toThrow(/LLM_BASE_URL/);
  });

  it("requires a complete provider before enabling vision", () => {
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      LLM_VISION_ENABLED: "true",
    })).toThrow(/LLM_VISION_ENABLED/);
  });

  it("rejects partial student-number masking configuration", () => {
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      STUDENT_NUMBER_PREFIX: "SC",
    })).toThrow();
  });

  it("rejects a generic student-number prefix in production", () => {
    expect(() => readEnv({
      NODE_ENV: "production",
      SESSION_SECRET: validSecret,
      TEACHER_ACCESS_CODE: "private-teacher-code",
      IDENTITY_CODE_PEPPER: validPepper,
      AUTH_PROXY_SECRET: validProxySecret,
      STUDENT_NUMBER_PREFIX: "DEMO",
      STUDENT_NUMBER_DIGITS: "8",
    })).toThrow(/school-specific/);
  });

  it("accepts a paired school-specific student-number policy", () => {
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      STUDENT_NUMBER_PREFIX: "SCIT",
      STUDENT_NUMBER_DIGITS: "10",
    })).not.toThrow();
  });

  it("trims configured values and enables complete AI configuration", () => {
    const env = readEnv({
      SESSION_SECRET: `  ${validSecret}  `,
      DATABASE_PATH: "  ./data/custom.sqlite  ",
      TEACHER_ACCESS_CODE: "  private-teacher-code  ",
      IDENTITY_CODE_PEPPER: `  ${validPepper}  `,
      AUTH_PROXY_SECRET: `  ${validProxySecret}  `,
      LLM_BASE_URL: "  https://api.example.com/v1  ",
      LLM_API_KEY: "  test-key  ",
      LLM_MODEL: "  test-model  ",
      LLM_EMBEDDING_BASE_URL: "  https://embedding.example.com/v1  ",
      LLM_EMBEDDING_API_KEY: "  embedding-test-key  ",
      LLM_EMBEDDING_MODEL: "  text-embedding-test  ",
      LLM_PLANNER_BASE_URL: "  https://planner.example.com/v1  ",
      LLM_PLANNER_API_KEY: "  planner-test-key  ",
      LLM_PLANNER_MODEL: "  planner-fast-model  ",
      LLM_WEB_BASE_URL: "  https://web.example.com/v1  ",
      LLM_WEB_API_KEY: "  web-test-key  ",
      LLM_WEB_MODEL: "  web-search-model  ",
      LLM_MAX_OUTPUT_TOKENS: "1024",
      LLM_VISION_ENABLED: "true",
    });

    expect(env).toEqual({
      sessionSecret: validSecret,
      databasePath: "./data/custom.sqlite",
      evidenceRoot: "./data/evidence",
      teacherAccessCode: "private-teacher-code",
      identityCodePepper: validPepper,
      identityCodePepperSource: "configured",
      authProxySecret: validProxySecret,
      authProxySecretSource: "configured",
      ai: {
        enabled: true,
        baseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        model: "test-model",
        embeddingBaseUrl: "https://embedding.example.com/v1",
        embeddingApiKey: "embedding-test-key",
        embeddingModel: "text-embedding-test",
        planner: {
          baseUrl: "https://planner.example.com/v1",
          apiKey: "planner-test-key",
          model: "planner-fast-model",
        },
        web: {
          baseUrl: "https://web.example.com/v1",
          apiKey: "web-test-key",
          model: "web-search-model",
        },
        maxOutputTokens: 1024,
        vision: true,
      },
      agentTimeouts: {
        online: {
          modelIdleTimeoutMs: 75_000,
          modelTotalTimeoutMs: 600_000,
          turnTotalTimeoutMs: 900_000,
        },
        evaluation: {
          modelIdleTimeoutMs: 120_000,
          modelTotalTimeoutMs: 600_000,
          turnTotalTimeoutMs: 900_000,
        },
      },
      agentV2Enabled: true,
      agentInterventionsEnabled: false,
      agentV3Enabled: false,
      agentUnifiedHarnessMode: "OFF",
      knowledgeObjectV2Enabled: false,
      visualRetrievalEnabled: false,
      evidenceBundleV2Enabled: false,
      knowledgeV2CanaryUserIds: [],
    });
  });

  it("supports an explicit rollback switch for the competition agent", () => {
    expect(readEnv({ SESSION_SECRET: validSecret, AGENT_V2_ENABLED: "false" }).agentV2Enabled).toBe(false);
  });

  it("keeps the V3 tutor disabled by default and supports an explicit opt-in", () => {
    expect(readEnv({ SESSION_SECRET: validSecret }).agentV3Enabled).toBe(false);
    expect(readEnv({ SESSION_SECRET: validSecret, AGENT_V3_ENABLED: "true" }).agentV3Enabled).toBe(true);
  });

  it("keeps the unified runtime Harness off by default and accepts only its three modes", () => {
    expect(readEnv({ SESSION_SECRET: validSecret }).agentUnifiedHarnessMode).toBe("OFF");
    expect(readEnv({
      SESSION_SECRET: validSecret,
      AGENT_UNIFIED_HARNESS_MODE: "SHADOW",
    }).agentUnifiedHarnessMode).toBe("SHADOW");
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      AGENT_UNIFIED_HARNESS_MODE: "INVALID",
    })).toThrow(/AGENT_UNIFIED_HARNESS_MODE/);
  });

  it("keeps run interventions disabled by default and supports an explicit opt-in", () => {
    expect(readEnv({ SESSION_SECRET: validSecret }).agentInterventionsEnabled)
      .toBe(false);
    expect(readEnv({
      SESSION_SECRET: validSecret,
      AGENT_INTERVENTIONS_ENABLED: "true",
    }).agentInterventionsEnabled).toBe(true);
  });

  it("keeps all Knowledge V2 feature flags fail-closed and validates explicit opt-in", () => {
    expect(readEnv({ SESSION_SECRET: validSecret }))
      .toMatchObject({
        knowledgeObjectV2Enabled: false,
        visualRetrievalEnabled: false,
        evidenceBundleV2Enabled: false,
        knowledgeV2CanaryUserIds: [],
      });
    expect(readEnv({
      SESSION_SECRET: validSecret,
      KNOWLEDGE_OBJECT_V2: "true",
      VISUAL_RETRIEVAL: "true",
      EVIDENCE_BUNDLE_V2: "true",
      KNOWLEDGE_V2_CANARY_USER_IDS: "internal-1, internal-2",
    })).toMatchObject({
      knowledgeObjectV2Enabled: true,
      visualRetrievalEnabled: true,
      evidenceBundleV2Enabled: true,
      knowledgeV2CanaryUserIds: ["internal-1", "internal-2"],
    });
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      KNOWLEDGE_OBJECT_V2: "yes",
    })).toThrow();
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      VISUAL_RETRIEVAL: "yes",
    })).toThrow();
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      EVIDENCE_BUNDLE_V2: "yes",
    })).toThrow();
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      KNOWLEDGE_V2_CANARY_USER_IDS: "internal-1,,internal-2",
    })).toThrow(/KNOWLEDGE_V2_CANARY_USER_IDS/);
    expect(() => readEnv({
      SESSION_SECRET: validSecret,
      KNOWLEDGE_V2_CANARY_USER_IDS: "internal-1,internal-1",
    })).toThrow(/KNOWLEDGE_V2_CANARY_USER_IDS/);
  });
});

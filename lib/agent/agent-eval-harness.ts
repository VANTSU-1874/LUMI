import type { DatabaseConnection } from "@/lib/db/client";
import type { SessionPayload } from "@/lib/auth/session";

import { DesignAgentKernel } from "./design-agent-kernel";
import { runAgentHarness } from "./harness-runner";
import type { ModelProviderAdapter } from "./model-provider-adapter";

export class AgentEvalHarness {
  constructor(private readonly connection: DatabaseConnection) {}

  runReleaseSuite() {
    return runAgentHarness(this.connection);
  }

  async runIdentitySuite(input: {
    actor: SessionPayload;
    message: string;
    adapters: Array<{ id: string; adapter: ModelProviderAdapter }>;
  }) {
    const results = [];
    for (const { id, adapter } of input.adapters) {
      const response = await new DesignAgentKernel(this.connection, input.actor, {
        modelProviderAdapter: adapter,
      }).run({ message: input.message, context: { view: "AGENT" } });
      const failures = [
        response.coursePack.id === "general-design" ? null : "MODEL_CHANGED_GENERAL_SCOPE",
        response.reply.basis?.some(({ kind }) => kind === "GENERAL_DESIGN") ? null : "GENERAL_BASIS_MISSING",
        response.policy.appliedRules.includes("ALLOW_GENERAL_DESIGN") ? null : "GENERAL_POLICY_MISSING",
        /(超出课程|不在课程|无法回答|不能回答)/.test(response.reply.message) ? "DESIGN_QUESTION_REJECTED" : null,
        (response.reply.message.match(/[？?]/g)?.length ?? 0) <= 1 ? null : "TOO_MANY_QUESTIONS",
      ].filter((failure): failure is string => failure !== null);
      results.push({ id, passed: failures.length === 0, failures, response });
    }
    return results;
  }
}

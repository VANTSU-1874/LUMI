import type { ProjectStage } from "@/lib/domain/stages";

export class ProjectStageConflictError extends Error {
  constructor(
    public readonly current: ProjectStage,
    public readonly required: ProjectStage | readonly ProjectStage[],
  ) {
    super("当前项目阶段暂不能进行此操作");
    this.name = "ProjectStageConflictError";
  }
}

export function assertProjectStage(
  current: ProjectStage,
  required: ProjectStage | readonly ProjectStage[],
): void {
  const accepted = Array.isArray(required) ? required : [required];
  if (!accepted.includes(current)) {
    throw new ProjectStageConflictError(current, required);
  }
}

export function nextStageAfterLogicReview(
  ruleReady: boolean,
  semanticReady: boolean,
): "LOGIC_CARD" | "TOOL_PATH" {
  return ruleReady && semanticReady ? "TOOL_PATH" : "LOGIC_CARD";
}

export function canEnterTransfer(stage: ProjectStage, evidenceCount: number): boolean {
  return (stage === "BUILD" || stage === "TROUBLESHOOT") && evidenceCount >= 3;
}

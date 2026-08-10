export class AgentRunInterventionNotFoundError extends Error {
  constructor() {
    super("运行不存在");
    this.name = "AgentRunInterventionNotFoundError";
  }
}

export class AgentRunInterventionConflictError extends Error {
  constructor(message = "补充消息状态已变化，请刷新后重试") {
    super(message);
    this.name = "AgentRunInterventionConflictError";
  }
}

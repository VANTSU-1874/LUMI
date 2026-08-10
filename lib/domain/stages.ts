export const PROJECT_STAGES = [
  "DIAGNOSTIC",
  "LOGIC_CARD",
  "TOOL_PATH",
  "BUILD",
  "TROUBLESHOOT",
  "TRANSFER",
  "COMPLETE",
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

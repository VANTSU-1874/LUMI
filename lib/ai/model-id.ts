export function isGpt56ModelId(modelId: string): boolean {
  return /^gpt-5\.6(?:[-\s]|$)/i.test(modelId);
}

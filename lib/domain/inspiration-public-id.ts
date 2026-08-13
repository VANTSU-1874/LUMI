import { createHash } from "node:crypto";

export function inspirationPublicId(candidateId: string) {
  return `inspiration:${createHash("sha256").update(candidateId).digest("hex").slice(0, 24)}`;
}

export function isInspirationPublicId(value: string) {
  return /^inspiration:[a-f0-9]{24}$/.test(value);
}

import { createHmac, randomInt } from "node:crypto";

import { InvalidIdentityCodeError } from "@/lib/auth/errors";
import type { DatabaseConnection } from "@/lib/db/client";
import { studentIdentityCodes } from "@/lib/db/schema";

const GENERATED_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const IDENTITY_CODE_PATTERN = /^[A-Z0-9-]{12,32}$/;
type CourseDatabase = DatabaseConnection["db"];

export function normalizeIdentityCode(code: string) {
  const normalized = code.trim().toUpperCase();
  const symbols = new Set(normalized.replaceAll("-", ""));
  if (!IDENTITY_CODE_PATTERN.test(normalized) || symbols.size < 4) {
    throw new InvalidIdentityCodeError();
  }
  return normalized;
}

export function generateIdentityCode() {
  while (true) {
    const symbols = Array.from(
      { length: 12 },
      () => GENERATED_ALPHABET[randomInt(GENERATED_ALPHABET.length)],
    );
    const code = `${symbols.slice(0, 4).join("")}-${symbols.slice(4, 8).join("")}-${symbols.slice(8).join("")}`;
    try {
      return normalizeIdentityCode(code);
    } catch {
      // Regenerate the astronomically unlikely low-diversity sample.
    }
  }
}

export function digestIdentityCode(code: string, pepper: string) {
  const normalizedPepper = pepper.trim();
  if (Buffer.byteLength(normalizedPepper, "utf8") < 32) {
    throw new Error("IDENTITY_CODE_PEPPER is too short");
  }
  return createHmac("sha256", normalizedPepper)
    .update(normalizeIdentityCode(code), "utf8")
    .digest("hex");
}

export function issueStudentIdentityCode(
  db: CourseDatabase,
  input: { classId: string; pepper: string },
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateIdentityCode();
    const codeDigest = digestIdentityCode(code, input.pepper);
    const result = db
      .insert(studentIdentityCodes)
      .values({
        codeDigest,
        classId: input.classId,
        createdAt: new Date(),
      })
      .onConflictDoNothing({ target: studentIdentityCodes.codeDigest })
      .run();
    if (result.changes === 1) {
      return code;
    }
  }
  throw new Error("Unable to issue a unique identity code");
}

import { z } from "zod";

const StudentNumberPolicySchema = z.object({
  prefix: z.string().regex(/^[A-Za-z]{1,12}$/),
  digits: z.number().int().min(4).max(20),
}).strict();

export type StudentNumberPolicy = z.infer<typeof StudentNumberPolicySchema>;

function escapeLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizationShadow(value: string) {
  let text = "";
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  for (let sourceStart = 0; sourceStart < value.length;) {
    const glyph = String.fromCodePoint(value.codePointAt(sourceStart)!);
    const sourceEnd = sourceStart + glyph.length;
    const normalized = glyph.normalize("NFKC");
    text += normalized;
    for (let offset = 0; offset < normalized.length; offset += 1) {
      sourceStarts.push(sourceStart);
      sourceEnds.push(sourceEnd);
    }
    sourceStart = sourceEnd;
  }
  return { text, sourceStarts, sourceEnds };
}

export function studentNumberPolicyFromEnvironment(environment: Record<string, string | undefined> = process.env) {
  const prefix = environment.STUDENT_NUMBER_PREFIX?.trim();
  const digits = environment.STUDENT_NUMBER_DIGITS?.trim();
  if (!prefix && !digits) return undefined;
  const policy = StudentNumberPolicySchema.parse({ prefix, digits: Number(digits) });
  if (environment.NODE_ENV === "production" && /^(?:DEMO|TEST|STUDENT|SAMPLE)$/i.test(policy.prefix)) {
    throw new Error("production student-number prefix must be school-specific");
  }
  return policy;
}

export function redactSensitiveText(text: string, options: { studentNumber?: StudentNumberPolicy }) {
  const shadow = normalizationShadow(text);
  const candidates: Array<{ start: number; end: number; replacement: string; priority: number }> = [];
  const collect = (pattern: RegExp, replacement: string, priority: number) => {
    for (const match of shadow.text.matchAll(pattern)) {
      const shadowStart = match.index;
      const shadowEnd = shadowStart + match[0].length;
      if (shadowEnd <= shadowStart) continue;
      candidates.push({
        start: shadow.sourceStarts[shadowStart],
        end: shadow.sourceEnds[shadowEnd - 1],
        replacement,
        priority,
      });
    }
  };
  collect(
    /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/giu,
    "[已遮蔽邮箱]",
    0,
  );
  collect(
    /(?<![\p{L}\p{N}\p{M}])(?:\+86[ \t\u00a0-]*)?1[3-9](?:[ \t\u00a0-]*\d){9}(?![\p{L}\p{N}\p{M}])/gu,
    "[已遮蔽手机号]",
    1,
  );
  collect(
    /(?<![\p{L}\p{N}\p{M}])\d{17}[0-9X](?![\p{L}\p{N}\p{M}])/giu,
    "[已遮蔽身份证号]",
    2,
  );
  if (options.studentNumber) {
    const policy = StudentNumberPolicySchema.parse(options.studentNumber);
    collect(
      new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escapeLiteral(policy.prefix)}\\d{${policy.digits}}(?![\\p{L}\\p{N}\\p{M}])`, "giu"),
      "[已遮蔽学号]",
      3,
    );
  }
  candidates.sort((left, right) => left.start - right.start || right.end - left.end || left.priority - right.priority);
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const previous = selected[selected.length - 1];
    if (!previous || candidate.start >= previous.end) selected.push(candidate);
  }
  if (selected.length === 0) return text;
  let result = "";
  let cursor = 0;
  for (const replacement of selected) {
    result += text.slice(cursor, replacement.start) + replacement.replacement;
    cursor = replacement.end;
  }
  return result + text.slice(cursor);
}

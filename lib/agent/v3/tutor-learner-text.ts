const GENERIC_PROVENANCE_LINE =
  /^[ \t]*通用设计(?:经验|建议)(?:与[^\r\n]{1,160})?[，,]?\s*非本课程指定资料[。.]?[ \t]*$/gmu;

const GENERIC_PROVENANCE_PARENTHETICAL =
  /[（(]\s*通用设计(?:经验|建议)[，,]?\s*非本课程指定资料[。.]?\s*[）)]/gu;

const GENERIC_PROVENANCE_PREFIX =
  /通用设计(?:经验|建议)[，,]\s*非本课程指定资料[。.]?\s*(?:不确定性[:：]\s*)?/gu;

const GENERIC_PROVENANCE_CLAUSES = [
  /课程、学习现场或联网资料来自本轮列出的可追溯依据[；;。.]?/gu,
  /数值来自本轮确定性计算，适用范围见计算说明[；;。.]?/gu,
  /其余判断属于导师的通用设计经验[。.]?/gu,
] as const;

function cleanTutorLearnerText(value: string) {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(GENERIC_PROVENANCE_LINE, "")
    .replace(GENERIC_PROVENANCE_PARENTHETICAL, "")
    .replace(GENERIC_PROVENANCE_PREFIX, "")
    .replace(
      /(^|\n)[ \t]*通用设计经验[，,]\s*并(?=参考)/gu,
      "$1",
    )
    .replace(
      /(^|\n)[ \t]*通用设计经验(?=参考)/gu,
      "$1",
    )
    .replace(
      new RegExp(
        GENERIC_PROVENANCE_CLAUSES
          .map((pattern) => pattern.source)
          .join("|"),
        "gu",
      ),
      "",
    )
    .replace(/(^|\n)[ \t]*[，,；;。]+\s*/gu, "$1")
    .replace(/[；;]\s*[；;]+/gu, "；")
    .replace(/[；;]\s*$/gu, "。")
    .replace(/[（(]\s*[）)]/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/**
 * Removes generic provenance disclaimers from learner-facing prose.
 *
 * Source identity and authority remain available through structured sources,
 * basis records, and the internal trace. Concrete limitations and unknowns are
 * deliberately left intact.
 */
export function sanitizeTutorLearnerText(value: string) {
  return cleanTutorLearnerText(value);
}

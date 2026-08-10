import type { KnowledgeItem, RankedKnowledgeItem } from "@/lib/knowledge/retrieve";

type TutorKnowledge = KnowledgeItem | RankedKnowledgeItem;

type Candidate = {
  item: TutorKnowledge;
  fullTitle: string;
  baseTitle: string;
  surfaces: readonly string[];
};

const MIN_FULL_TITLE_CHARACTERS = 8;
const MIN_QUOTED_TITLE_CHARACTERS = 4;
const TRAILING_TITLE_QUALIFIER = /\s*\((?:课程设计|本地设计说明|官方教程目录|derivative官方文档)\)\s*$/iu;

const ATTRIBUTION_ACTION = "(?:根据|依据|依照|按照|按|基于|据|引用|参考|参照|参见|参阅|详见|来自(?:于)?|源自|出自|引自|摘自|取自|借鉴|采用|采纳|使用|用|查阅|阅读|结合|遵循|对照)";
const SOURCE_DESCRIPTOR = "(?:课程资料|课程材料|官方资料)";
const ATTRIBUTION_ASPECT = "(?:了|过|的(?:是)?)?";
const ATTRIBUTION_BEFORE = new RegExp(
  `(?:${ATTRIBUTION_ACTION}${ATTRIBUTION_ASPECT}(?:这份|该份|本份|相关)?(?:${SOURCE_DESCRIPTOR}(?:中|里)?的?)?`
    + "|(?:参考|引用|使用|采用|借鉴)的(?:课程)?资料(?:是|为)"
    + "|(?:本回答|这个判断|这套方法|上述结论)(?:的)?(?:依据|来源)(?:是|为)|出处是)[：:]?$",
  "u",
);
const ATTRIBUTION_AFTER = /^(?:(?:中|里|所)?(?:指出|提到|提及|强调|建议|说明|提出|要求|给出|提供|介绍|解释|认为|写明|写道|主张|表明|显示|记载|阐明|阐述)(?:了|过)?|(?:中|里)(?:采用|采纳|借鉴|使用|参考|引用|依据)(?:了|过)?|(?:中|里)?(?:可以|可)?(?:看出|得出)|(?:中|里)?(?:可见|可知)|(?:为|作为)[^，,。！？!?；;\n]{0,8}(?:依据|准则)|为准|是(?:本回答|这里|这个判断|本段|上述结论)?的?(?:依据|来源))/u;

const AFFIRMATIVE_NEGATION_FORM = /(?:不妨|不但|不仅|不只|不光|不得不|不能不|没少|从未不|未曾不|不否认|不是没有|不是不|并非没有)/gu;
const CONTRAST_BEFORE_ATTRIBUTION = /(?:但是|不过|而是|只好|但|却|实际上|实际|经核实)/gu;
const NEGATIVE_POLARITY = /(?:不|未|没|勿|别|无法|无须|无需|拒绝|否认|未必|并非|绝非|禁止|避免|停止|放弃)/u;
const PLANNED_OR_UNCERTAIN = /(?:(?:下一版|下次|稍后|之后|以后|未来|后续|过会儿|接下来|下一步)[^，,。！？!?；;\n]{0,12}(?:会|将|可能|准备|打算|计划|拟|再)?|(?:等|待)[^，,。！？!?；;\n]{0,20}后(?:再)?|(?:准备|打算|计划|拟)(?:要|会|将)?|(?:在)?考虑(?:要|是否)?|(?:会|将|可能|也许|或许|大概|似乎|好像)(?:已经|曾经)?|(?:看起来|看上去)(?:像是|似乎)?|(?:据说|听说|疑似|尚待核实|待核实))$/u;
const HYPOTHETICAL_PREFIX = /^(?:如果|假如|假设|假定|设想|倘若|若(?!干)|要是|万一|即使)(?:[^，,。！？!?；;\n]{0,40})$/u;
const INTERROGATIVE_PREFIX = /(?:为什么|为何|怎么|如何|是否|能否|可否|要不要|该不该|可不可以|是不是|请问)/u;
const LEADING_NON_FACTUAL_SENTENCE = /^\s*(?:例如|比如|举个例子|举例|示范一下|假设|假如|如果|若(?!干)|要是|万一)(?:[，,:：]|$)/u;
const RESTATEMENT_BEFORE = /(?:这里只(?:演示|示范|复述|转述)|改成这句|固定句式|所谓|书名号(?:的)?(?:示例|演示)|资料名(?:示例)?)[^。！？!?；;\n]{0,40}$/u;
const REPORTED_SPEECH_BEFORE = /(?:^|[：:])\s*(?:你|学生|题目|问题|用户|有人)[^。！？!?；;\n]{0,16}(?:提到|说到|写到|问到|问的是|问|复述|说|说道|表示|声称|称)[^。！？!?；;\n]{0,28}$/u;

const LITERAL_ROLE_AFTER = /^(?:\s|[，,:：])*?(?:(?:只是|仅是|仅用于|仅供|只用于|只作|仅作|当(?:作)?|作为|作|用作)[^，,。！？!?；;\n]{0,24}(?:举例|例子|示例|假设|名称|名字|标题|问题|句式|演示|书名号|学生原话|格式|搜索词|搜索关键词|关键词|文件名|字符串)|(?:这个|该)(?:名字|名称|标题|字符串)[^，,。！？!?；;\n]{0,20}(?:演示|示例|格式|命名|搜索)|给[^，,。！？!?；;\n]{0,18}命名|命名(?:这个|该)?(?:文件|小节|章节)|(?:当(?:作)?|作为|用作)(?:搜索词|搜索关键词|关键词|文件名|名称|名字|标题|字符串)|为例)/u;
const QUERY_AFTER = /^(?:\s|[，,])*?(?:(?:了)?(?:吗|呢)|可以(?:吗|不可以)?|行不行|好不好|合不合适|合适吗?|可行吗?|是否(?:合适|可行|可靠)|可靠吗?|值得吗|能否(?:使用)?|可否(?:使用)?|怎么样|如何|还是不用|要不要用|该不该用|可不可以|来安排吗|安排吗|对吧|对不对)(?:[？?。.]|$)/u;
const UNCERTAIN_AFTER = /^(?:\s|[，,])*?(?:是否(?:合适|可行|可靠)|行不行|怎么样|如何)(?:[？?。.]|$)/u;
const QUESTIONING_SUBJECT_BEFORE = /^\s*(?:你|学生|用户)[^，,。！？!?；;\n]{0,12}(?:是|是否|有没有|曾否)?[^，,。！？!?；;\n]*$/u;
const FULL_RETRACTION_AFTER = /(?:(?:以上说法|上述说法|以上内容|上述内容|前一句|刚才那句话|这句话)[^。！？!?；;\n]{0,10}(?:作废|撤回|收回|取消|不算|无效)|(?:但|不过|然而|最终|最后|后来)[^。！？!?；;\n]{0,32}(?:(?:最终)?(?:完全)?(?:没有|未)采用(?:[。！？!?；;\n]|$)|不再(?:采用|使用|引用|参考|依据)|改用(?:了)?(?:另一|其他|别的)[^。！？!?；;\n]{0,10}(?:资料|来源|依据)|删除了?(?:这条|该条|上述)?(?:依据|引用|来源)|放弃了?(?:这条|该条)?(?:依据|引用|来源))|(?:这条|该条|上述)?(?:依据|引用|来源)[^。！？!?；;\n]{0,8}(?:已)?(?:删除|取消|作废)|[—-]\s*这不是真的)/u;
const UNCONFIRMED_AFTER = /(?:但|不过|然而)\s*(?:我)?\s*(?:尚|仍)?(?:无法|不能|不)(?:确认|确定)(?:[。！？!?；;\n]|$)/u;
const TITLE_EXTENSION_AFTER = /^\s*(?:(?:[（(][^）)\n]{0,20}(?:修订|增订|扩展|新版|第[^）)\n]{0,6}版)[^）)\n]*[）)])|[:：]\s*[^，,。！？!?；;\n]{1,16}版|(?:[:：]\s*)?(?:扩展版|修订版|增订版|新版|第[^，,。！？!?；;\n]{0,8}版))/u;
const SAFE_UNQUOTED_SUFFIX = /^(?:中|里|所|的|来|用于|先|再|然后|安排|检查|核对|完成|给出)/u;

const CLAUSE_BOUNDARY = /[，,。！？!?；;\n]/u;
const SENTENCE_BOUNDARY = /[。！？!?；;\n]/u;
const NON_FACTUAL_HEADER = "(?:(?:下面|以下|下列)(?:是|为)?\\s*)?(?:错误示范|错误示例|反例|句式示例|例句|原句|学生(?:的)?原话|学生回答|用户(?:的)?原话|题目原文)";
const NON_FACTUAL_HEADER_ONLY = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?${NON_FACTUAL_HEADER}(?:如下|是)?[：:]?\\s*[“\"「『‘]?$`,
  "u",
);
const NON_FACTUAL_HEADER_WITH_TEXT = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?${NON_FACTUAL_HEADER}(?:如下|是)?[：:]\\s*\\S+`,
  "u",
);
const SOURCE_QUOTE_INTRO = /^\s*(?:(?:[-*+]|\d+[.)、])\s*)?(?:#{1,6}\s*)?(?:(?:本回答|这个判断|这套方法|上述结论)的?)?(?:课程)?(?:依据|来源|出处|引用(?:资料)?|参考(?:资料|文献)?|资料)(?:如下|是|为)?[：:]\s*$/u;

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function characterCount(value: string) {
  return Array.from(value).length;
}

function titleBase(title: string) {
  return normalized(title).replace(TRAILING_TITLE_QUALIFIER, "").trim();
}

function buildCandidates(knowledge: readonly TutorKnowledge[]) {
  return knowledge.map((item): Candidate => {
    const fullTitle = normalized(item.title);
    const baseTitle = titleBase(item.title);
    return {
      item,
      fullTitle,
      baseTitle,
      surfaces: Array.from(new Set([
        ...(characterCount(fullTitle) >= MIN_FULL_TITLE_CHARACTERS ? [fullTitle] : []),
        ...(characterCount(baseTitle) >= MIN_QUOTED_TITLE_CHARACTERS ? [baseTitle] : []),
      ])),
    };
  });
}

function surfaceOwners(candidates: readonly Candidate[]) {
  const owners = new Map<string, Set<string>>();
  for (const { item, surfaces } of candidates) {
    for (const surface of surfaces) {
      const ids = owners.get(surface) ?? new Set<string>();
      ids.add(item.id);
      owners.set(surface, ids);
    }
  }
  return owners;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHiddenHtml(value: string) {
  return value
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, "\n")
    .replace(/<(script|style|template|pre|code|del|s)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, "\n")
    .replace(/<blockquote\b[^>]*>([\s\S]*?)(?:<\/blockquote\s*>|$)/giu,
      (_match, inner: string) => `\n> ${inner.replace(/\n/gu, "\n> ")}\n`)
    .replace(/<q\b[^>]*>([\s\S]*?)(?:<\/q\s*>|$)/giu, "“$1”")
    .replace(/<[^>\n]*>/gu, " ");
}

function stripInactiveBlocks(value: string) {
  const lines = stripHiddenHtml(value.normalize("NFKC").replace(/\r\n?/g, "\n")).split("\n");
  const kept: string[] = [];
  let fence: { marker: string; length: number } | undefined;
  let quoteMode: "KEEP" | "DROP" | undefined;
  let pendingNonFactualBlock = false;
  let droppingNonFactualBlock = false;
  let droppedBlockKind: "LIST" | "PROSE" | "QUOTE" | undefined;
  let inIndentedCode = false;
  let previousWasBlank = true;
  let previousKeptNonBlank = "";

  for (const line of lines) {
    if (fence) {
      const close = new RegExp(
        `^ {0,3}${escapeRegExp(fence.marker)}{${fence.length},}\\s*$`,
        "u",
      );
      if (close.test(line)) fence = undefined;
      previousWasBlank = line.trim().length === 0;
      continue;
    }

    const fenceOpen = line.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (fenceOpen) {
      fence = { marker: fenceOpen[1]![0]!, length: fenceOpen[1]!.length };
      quoteMode = undefined;
      pendingNonFactualBlock = false;
      droppingNonFactualBlock = false;
      droppedBlockKind = undefined;
      previousWasBlank = false;
      continue;
    }

    const blank = line.trim().length === 0;
    if (blank) {
      quoteMode = undefined;
      pendingNonFactualBlock = false;
      droppingNonFactualBlock = false;
      droppedBlockKind = undefined;
      inIndentedCode = false;
      kept.push("");
      previousWasBlank = true;
      continue;
    }

    const startsListBlock = /^ {0,3}(?:[-*+]|\d+[.)])\s+/u.test(line);
    const startsHardBlock = /^ {0,3}(?:#{1,6}\s+.*|(?:---+|___+|\*\*\*+)\s*)$/u.test(line);
    if (startsHardBlock) {
      quoteMode = undefined;
      pendingNonFactualBlock = false;
      droppingNonFactualBlock = false;
      droppedBlockKind = undefined;
    }
    if (droppingNonFactualBlock && startsListBlock && droppedBlockKind !== "LIST") {
      droppingNonFactualBlock = false;
      droppedBlockKind = undefined;
    }
    if (quoteMode && startsListBlock) {
      quoteMode = undefined;
    }
    if (pendingNonFactualBlock) {
      pendingNonFactualBlock = false;
      droppingNonFactualBlock = true;
      droppedBlockKind = startsListBlock
        ? "LIST"
        : /^ {0,3}>/u.test(line)
          ? "QUOTE"
          : "PROSE";
    }
    if (droppingNonFactualBlock) {
      previousWasBlank = false;
      continue;
    }

    const quoteMatch = line.match(/^ {0,3}(?:>\s?)+(.*)$/u);
    if (quoteMatch) {
      const content = quoteMatch[1] ?? "";
      if (!quoteMode) {
        quoteMode = SOURCE_QUOTE_INTRO.test(previousKeptNonBlank) ? "KEEP" : "DROP";
      }
      if (NON_FACTUAL_HEADER_ONLY.test(content) || NON_FACTUAL_HEADER_WITH_TEXT.test(content)) {
        quoteMode = "DROP";
      }
      if (quoteMode === "KEEP") {
        kept.push(content);
        previousKeptNonBlank = content.trim();
      }
      previousWasBlank = false;
      continue;
    }

    if (quoteMode) {
      if (quoteMode === "KEEP") {
        kept.push(line);
        previousKeptNonBlank = line.trim();
      }
      previousWasBlank = false;
      continue;
    }

    const headerLine = line.replace(/^\s*(?:[-*+]|\d+[.)、])\s+/u, "");
    if (NON_FACTUAL_HEADER_ONLY.test(headerLine)) {
      pendingNonFactualBlock = true;
      previousWasBlank = false;
      continue;
    }
    if (NON_FACTUAL_HEADER_WITH_TEXT.test(headerLine)) {
      pendingNonFactualBlock = true;
      previousWasBlank = false;
      continue;
    }

    const indented = /^(?: {4}|\t)/u.test(line);
    if (indented && (previousWasBlank || inIndentedCode)) {
      inIndentedCode = true;
      previousWasBlank = false;
      continue;
    }
    inIndentedCode = false;

    kept.push(line);
    previousKeptNonBlank = line.trim();
    previousWasBlank = false;
  }

  return kept.join("\n");
}

function stripInlineCode(value: string) {
  let output = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "`") {
      output += value[index];
      index += 1;
      continue;
    }
    let runEnd = index;
    while (value[runEnd] === "`") runEnd += 1;
    const delimiter = "`".repeat(runEnd - index);
    const close = value.indexOf(delimiter, runEnd);
    if (close < 0) {
      const lineEnd = value.indexOf("\n", runEnd);
      output += " ";
      index = lineEnd < 0 ? value.length : lineEnd;
      continue;
    }
    const hidden = value.slice(runEnd, close);
    output += hidden.includes("\n") ? "\n".repeat(hidden.split("\n").length - 1) : " ";
    index = close + delimiter.length;
  }
  return output.split("\n").map((line) => line.replace(/~~.*?(?:~~|$)/gu, " ")).join("\n");
}

function canonicalSurface(value: string, owners: ReadonlyMap<string, ReadonlySet<string>>) {
  const inner = normalized(value).replace(/^《([\s\S]*)》$/u, "$1").trim();
  return owners.get(inner)?.size === 1 ? inner : undefined;
}

function canonicalizeTitle(value: string, owners: ReadonlyMap<string, ReadonlySet<string>>) {
  const surface = canonicalSurface(value, owners);
  return surface ? `《${surface}》` : undefined;
}

function normalizeMarkdownTitles(value: string, owners: ReadonlyMap<string, ReadonlySet<string>>) {
  const formattedTitle = (
    _match: string,
    ...captures: Array<string | undefined>
  ) => {
    const inner = captures.find((capture) => typeof capture === "string") ?? "";
    return canonicalizeTitle(inner, owners) ?? inner;
  };
  return value
    .replace(/!\[[^\]\n]*\]\([^\n)]*\)/gu, " ")
    .replace(/\[([^\]\n]{1,300})\]\([^\n)]*\)/gu, (_match, label: string) =>
      canonicalizeTitle(label, owners) ?? label)
    .replace(/\*\*\*([^*\n]{1,300})\*\*\*|___([^_\n]{1,300})___/gu, formattedTitle)
    .replace(/\*\*([^*\n]{1,300})\*\*|__([^_\n]{1,300})__/gu, formattedTitle)
    .replace(/(?<!\*)\*([^*\n]{1,300})\*(?!\*)|(?<!_)_([^_\n]{1,300})_(?!_)/gu, formattedTitle);
}

function normalizeCandidateQuotes(value: string, owners: ReadonlyMap<string, ReadonlySet<string>>) {
  let result = value;
  const pairs: readonly [RegExp, RegExp | null][] = [
    [/“([\s\S]*?)”/gu, /“[\s\S]*$/gu],
    [/「([\s\S]*?)」/gu, /「[\s\S]*$/gu],
    [/『([\s\S]*?)』/gu, /『[\s\S]*$/gu],
    [/‘([\s\S]*?)’/gu, /‘[\s\S]*$/gu],
    [/"([\s\S]*?)"/gu, /"[\s\S]*$/gu],
    [/(?<![\p{L}\p{N}])'([^'\n]{1,300})'(?![\p{L}\p{N}])/gu, null],
  ];
  for (const [closed, unclosed] of pairs) {
    result = result
      .replace(closed, (
        _match: string,
        inner: string,
        offset: number,
        whole: string,
      ) => {
        const title = canonicalizeTitle(inner, owners);
        if (title) return title;
        const prefix = whole.slice(Math.max(0, offset - 160), offset).trim();
        return /(?:(?:实际)?(?:采用|采纳|使用|引用|借鉴|参考)(?:了|的是)?|(?:本回答|这个判断|这套方法|上述结论)(?:的)?(?:依据|来源)(?:(?:是|为|的是))?[：:]?)\s*$/u.test(prefix)
          ? inner
          : " ";
      })
      .replace(unclosed ?? /\b\B/gu, " ");
  }
  return result;
}

function answerForMatching(
  value: string,
  owners: ReadonlyMap<string, ReadonlySet<string>>,
) {
  const active = stripInactiveBlocks(value);
  const withoutInlineCode = stripInlineCode(active);
  const markdownTitles = normalizeMarkdownTitles(withoutInlineCode, owners);
  return normalized(normalizeCandidateQuotes(markdownTitles, owners));
}

function currentClause(value: string) {
  return value.split(CLAUSE_BOUNDARY).at(-1) ?? "";
}

function nextClause(value: string) {
  return value.split(CLAUSE_BOUNDARY)[0] ?? "";
}

function currentSentence(value: string) {
  return value.split(SENTENCE_BOUNDARY).at(-1) ?? "";
}

function nextSentence(value: string) {
  return value.split(SENTENCE_BOUNDARY)[0] ?? "";
}

function activePrefix(prefix: string) {
  let start = 0;
  for (const match of prefix.matchAll(CONTRAST_BEFORE_ATTRIBUTION)) {
    start = (match.index ?? 0) + match[0].length;
  }
  return prefix.slice(start).replace(AFFIRMATIVE_NEGATION_FORM, "").trim();
}

function hasNegativePolarity(prefix: string) {
  return NEGATIVE_POLARITY.test(activePrefix(prefix));
}

function isPlannedUncertainOrHypothetical(prefix: string) {
  const active = activePrefix(prefix);
  return PLANNED_OR_UNCERTAIN.test(active)
    || HYPOTHETICAL_PREFIX.test(active)
    || INTERROGATIVE_PREFIX.test(active);
}

function isRestatementOrReported(
  beforeClause: string,
  beforeSentence: string,
) {
  return LEADING_NON_FACTUAL_SENTENCE.test(beforeSentence)
    || RESTATEMENT_BEFORE.test(beforeSentence)
    || REPORTED_SPEECH_BEFORE.test(beforeClause);
}

function isAffirmedPartialUse(prefix: string, afterContext: string) {
  return /(?:没有|未)(?:完全|完整)\s*$/u.test(prefix)
    && /^[^。！？!?；;\n]{0,48}(?:只|但)[^。！？!?；;\n]{0,24}(?:用|参考|采用|采纳|借鉴)(?:了|过)?[^。！？!?；;\n]{0,16}(?:其中|原则|方法|部分)/u.test(afterContext);
}

function questionBelongsToCitation(
  beforeSentence: string,
  prefix: string,
  afterContext: string,
) {
  const hardEnd = afterContext.search(/[。！!；;\n]/u);
  const questionAt = afterContext.search(/[？?]/u);
  if (questionAt < 0 || (hardEnd >= 0 && hardEnd < questionAt)) {
    const sentence = nextSentence(afterContext);
    return QUERY_AFTER.test(sentence) || UNCERTAIN_AFTER.test(sentence);
  }

  const beforeQuestion = afterContext.slice(0, questionAt).trim();
  if (INTERROGATIVE_PREFIX.test(activePrefix(prefix))) return true;
  if (QUERY_AFTER.test(beforeQuestion)) return true;
  if (!beforeQuestion || /^[，,\s]*(?:了)?(?:吗|呢)$/u.test(beforeQuestion)) return true;
  if (QUESTIONING_SUBJECT_BEFORE.test(beforeSentence)
    && /(?:对吧|对不对|吗|呢)\s*$/u.test(beforeQuestion)) return true;
  return false;
}

function isNonFactualMention(
  beforeClause: string,
  beforeSentence: string,
  afterClause: string,
  afterSentence: string,
  afterContext: string,
  attributionBefore: RegExpMatchArray | null,
) {
  const prefix = beforeClause.slice(
    0,
    attributionBefore?.index ?? beforeClause.length,
  ).trim();
  return (hasNegativePolarity(prefix) && !isAffirmedPartialUse(prefix, afterContext))
    || isPlannedUncertainOrHypothetical(prefix)
    || isRestatementOrReported(beforeClause, beforeSentence)
    || LITERAL_ROLE_AFTER.test(afterSentence)
    || questionBelongsToCitation(beforeSentence, prefix, afterContext)
    || FULL_RETRACTION_AFTER.test(afterContext)
    || UNCONFIRMED_AFTER.test(afterContext)
    || LITERAL_ROLE_AFTER.test(afterClause);
}

function hasAttributedMention(
  answer: string,
  mention: string,
  isAllowedAt: (index: number) => boolean = () => true,
) {
  let start = 0;
  while (start <= answer.length - mention.length) {
    const index = answer.indexOf(mention, start);
    if (index < 0) return false;
    if (!isAllowedAt(index)) {
      start = index + mention.length;
      continue;
    }

    const beforeContext = answer.slice(Math.max(0, index - 240), index);
    const afterContext = answer.slice(index + mention.length, index + mention.length + 240);
    const beforeClause = currentClause(beforeContext).trim();
    const beforeSentence = currentSentence(beforeContext).trim();
    const afterClause = nextClause(afterContext).trim();
    const afterSentence = nextSentence(afterContext).trim();
    const attributionBefore = beforeClause.match(ATTRIBUTION_BEFORE);
    const attributed = Boolean(attributionBefore) || ATTRIBUTION_AFTER.test(afterClause);
    if (attributed && !isNonFactualMention(
      beforeClause,
      beforeSentence,
      afterClause,
      afterSentence,
      afterContext,
      attributionBefore,
    )) return true;
    start = index + mention.length;
  }
  return false;
}

function hasAttributedQuotedMention(answer: string, surface: string) {
  return hasAttributedMention(answer, `《${surface}》`);
}

function isUnicodeBoundary(value: string) {
  return !value || /[\s\p{P}\p{S}]/u.test(value);
}

function hasAttributedFullTitleMention(answer: string, fullTitle: string) {
  return hasAttributedMention(answer, fullTitle, (index) => {
    const beforeCharacter = answer[index - 1] ?? "";
    const afterIndex = index + fullTitle.length;
    const afterCharacter = answer[afterIndex] ?? "";
    if (beforeCharacter === "《" || afterCharacter === "》") return false;
    if (/^[a-z0-9]$/u.test(beforeCharacter) || /^[a-z0-9]$/u.test(afterCharacter)) return false;

    const before = currentClause(answer.slice(Math.max(0, index - 96), index)).trim();
    const after = nextClause(answer.slice(afterIndex, afterIndex + 64)).trim();
    const attributedBefore = ATTRIBUTION_BEFORE.test(before);
    const attributedAfter = ATTRIBUTION_AFTER.test(after.replace(/^[\s:：]+/u, ""));
    if (!attributedBefore && !attributedAfter) return false;
    if (!attributedBefore && !isUnicodeBoundary(beforeCharacter)) return false;

    const suffix = answer.slice(afterIndex, afterIndex + 64);
    if (TITLE_EXTENSION_AFTER.test(suffix)) return false;
    if (!attributedAfter
      && !isUnicodeBoundary(afterCharacter)
      && !(attributedBefore && SAFE_UNQUOTED_SUFFIX.test(suffix))) return false;
    return true;
  });
}

export function knowledgeIdsExplicitlyMentioned(
  visibleAnswer: string,
  knowledge: readonly TutorKnowledge[],
) {
  const candidates = buildCandidates(knowledge);
  const owners = surfaceOwners(candidates);
  const answer = answerForMatching(visibleAnswer, owners);
  if (!answer) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const { item, fullTitle, surfaces } of candidates) {
    if (seen.has(item.id)) continue;
    const mentioned = surfaces.some((surface) => {
      if (owners.get(surface)?.size !== 1) return false;
      if (hasAttributedQuotedMention(answer, surface)) return true;
      return surface === fullTitle
        && characterCount(fullTitle) >= MIN_FULL_TITLE_CHARACTERS
        && hasAttributedFullTitleMention(answer, fullTitle);
    });
    if (!mentioned) continue;
    seen.add(item.id);
    ids.push(item.id);
  }
  return ids;
}

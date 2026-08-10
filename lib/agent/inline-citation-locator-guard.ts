import { decodeNamedCharacterReference } from "decode-named-character-reference";

const MAX_NORMALIZATION_PASSES = 3;
const CHARACTER_REFERENCE = /&(#(?:[xX][0-9A-Fa-f]{1,8}|[0-9]{1,10})|[A-Za-z][A-Za-z0-9]{0,31});/gu;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const HEX_DIGIT = /^[0-9A-Fa-f]$/u;
const ASCII_ALPHANUMERIC = /^[0-9A-Za-z]$/u;
const PATH_SEPARATOR = /[\\/\u2044\u2215\u29f5\u29f8]/u;
const EMAILISH = /[\p{L}\p{M}\p{N}._%+-]+@[\p{L}\p{M}\p{N}_-]+/u;
const HTML_LOCATOR_ATTRIBUTE = /(?:href|src)\s*=/iu;
const DOTFILE = /(?:^|[\s"'`([{（【])\.[\p{L}\p{M}\p{N}_~-]{1,128}(?=$|[\s"'`)\]}，。！？；：、）】])/u;
const IPV4 = /(?:^|[^\p{N}])((?:\d{1,3}\.){3}\d{1,3})(?!\p{N})/gu;
const IDEOGRAPHIC_LABEL_SOURCE = "[\\p{L}\\p{M}\\p{N}_-]{1,63}";
const IDEOGRAPHIC_TOKEN = new RegExp(`${IDEOGRAPHIC_LABEL_SOURCE}(?:。${IDEOGRAPHIC_LABEL_SOURCE})+`, "gu");
const ASCII_LABEL = /^[A-Za-z0-9_-]+$/u;
const CJK_LABEL = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{M}\p{N}_-]+$/u;
const JAPANESE_CHARACTER = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const KOREAN_CHARACTER = /\p{Script=Hangul}/u;
const ASCII_SCHEME_CHARACTER = /[A-Za-z0-9+.-]/u;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;
const ASCII_UNIT = /^(?:mm|cm|km|m|px|pt|pc|in|ft|dpi|ppi|em|rem|vw|vh|vmin|vmax|s|ms|hz|khz|mhz|deg|rad|kg|g|mg|l|ml|db)$/iu;
const LOCATOR_CUES = [
  "访问", "打开", "浏览", "读取", "阅读", "查阅", "查看", "参考", "核对", "链接", "网址", "网站", "域名", "从", "用",
  "visit", "open", "read", "from",
] as const;
const MAX_CUE_LENGTH = Math.max(...LOCATOR_CUES.map((cue) => cue.length));
const CUE_GAP_CHARACTER = /[\s:"'“”‘’()【】\[\]]/u;

function decodeNumericReference(body: string, reference: string) {
  const hexadecimal = body[1]?.toLowerCase() === "x";
  const digits = body.slice(hexadecimal ? 2 : 1);
  const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return reference;
  }
  return String.fromCodePoint(codePoint);
}

function decodeCharacterReferences(value: string) {
  return value.replace(CHARACTER_REFERENCE, (reference, body: string) => (
    body.startsWith("#")
      ? decodeNumericReference(body, reference)
      : decodeNamedCharacterReference(body) || reference
  ));
}

function startsPercentByte(value: string, index: number) {
  return value[index] === "%"
    && HEX_DIGIT.test(value[index + 1] ?? "")
    && HEX_DIGIT.test(value[index + 2] ?? "");
}

function decodePercentBytes(value: string) {
  let text = "";
  let invalid = false;
  for (let index = 0; index < value.length;) {
    if (value[index] !== "%") {
      text += value[index]!;
      index += 1;
      continue;
    }
    if (!startsPercentByte(value, index)) {
      invalid ||= ASCII_ALPHANUMERIC.test(value[index + 1] ?? "");
      text += "%";
      index += 1;
      continue;
    }
    let end = index + 3;
    while (startsPercentByte(value, end)) end += 3;
    const encoded = value.slice(index, end);
    try {
      text += decodeURIComponent(encoded);
    } catch {
      invalid = true;
      text += encoded;
    }
    index = end;
  }
  return { text, invalid };
}

function normalizeOnce(value: string) {
  const percentDecoded = decodePercentBytes(decodeCharacterReferences(value));
  return {
    invalidPercent: percentDecoded.invalid,
    text: percentDecoded.text
    .normalize("NFKC")
    .replace(DEFAULT_IGNORABLE, "")
    .replace(/[\u2044\u2215\u29f8]/gu, "/")
    .replace(/\u29f5/gu, "\\"),
  };
}

function normalizeForScanning(value: string) {
  let text = value;
  for (let pass = 0; pass < MAX_NORMALIZATION_PASSES; pass += 1) {
    const next = normalizeOnce(text);
    if (next.invalidPercent) return { text: next.text, unsafe: true };
    if (next.text === text) return { text, unsafe: false };
    text = next.text;
  }
  const next = normalizeOnce(text);
  return { text, unsafe: next.invalidPercent || next.text !== text };
}

function hasMarkdownLocator(value: string) {
  const nextNonWhitespace = new Array<number>(value.length + 1);
  nextNonWhitespace[value.length] = value.length;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    nextNonWhitespace[index] = /\s/u.test(value[index]!) ? nextNonWhitespace[index + 1]! : index;
  }
  const brackets: number[] = [];
  let backslashes = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") { backslashes += 1; continue; }
    const escaped = backslashes % 2 === 1; backslashes = 0;
    if (escaped) continue;
    if (value[index] === "[") { brackets.push(index); continue; }
    if (value[index] !== "]" || brackets.length === 0) continue;
    const labelStart = brackets.pop()!;
    if (value[labelStart + 1] === "[" && value[index - 1] === "]") return true;
    const suffix = value[index + 1];
    if (suffix === "(" || suffix === "[") return true;
    const definition = nextNonWhitespace[index + 1]!;
    if (value[definition] === ":" && /\S/u.test(value.slice(definition + 1))) return true;
  }
  return HTML_LOCATOR_ATTRIBUTE.test(value);
}

function hasLocatorCueBefore(value: string, start: number) {
  let end = start;
  while (end > 0 && CUE_GAP_CHARACTER.test(value[end - 1]!)) end -= 1;
  const prefix = value.slice(Math.max(0, end - MAX_CUE_LENGTH), end).toLowerCase();
  return LOCATOR_CUES.some((cue) => prefix.endsWith(cue));
}

function hasColonLocator(value: string) {
  for (let colon = value.indexOf(":"); colon >= 0; colon = value.indexOf(":", colon + 1)) {
    if (!value[colon + 1] || /\s/u.test(value[colon + 1]!)) continue;
    let start = colon;
    while (start > 0 && ASCII_SCHEME_CHARACTER.test(value[start - 1]!)) start -= 1;
    const token = value.slice(start, colon);
    const boundary = start === 0 || !WORD_CHARACTER.test(value[start - 1]!);
    const context = boundary || hasLocatorCueBefore(value, start);
    if (/^[A-Za-z]$/u.test(token) && context) return true;
    if (/^[A-Za-z][A-Za-z0-9+.-]{1,31}$/u.test(token) && context) return true;
  }
  return false;
}

type LabelFamily = "ASCII" | "HAN" | "JAPANESE" | "KOREAN" | "MIXED" | "OTHER";

function labelFamily(label: string): LabelFamily {
  if (ASCII_LABEL.test(label)) return "ASCII";
  if (!CJK_LABEL.test(label)) return "OTHER";
  const japanese = JAPANESE_CHARACTER.test(label);
  const korean = KOREAN_CHARACTER.test(label);
  if (japanese && korean) return "MIXED";
  if (korean) return "KOREAN";
  if (japanese) return "JAPANESE";
  return "HAN";
}

function hasIdeographicLocator(value: string) {
  return [...value.matchAll(IDEOGRAPHIC_TOKEN)].some((match) => {
    const families = match[0].split("。").map(labelFamily);
    if (hasLocatorCueBefore(value, match.index ?? 0)) return true;
    if (families.some((family) => family === "ASCII" || family === "OTHER" || family === "MIXED")) return true;
    return new Set(families).size > 1;
  });
}

function numericDotIsNotation(value: string, dotIndex: number) {
  if (!/[0-9]/u.test(value[dotIndex - 1] ?? "") || !/[0-9]/u.test(value[dotIndex + 1] ?? "")) return false;
  let start = dotIndex - 1; let end = dotIndex + 1;
  while (start > 0 && /[0-9.]/u.test(value[start - 1]!)) start -= 1;
  while (end + 1 < value.length && /[0-9.]/u.test(value[end + 1]!)) end += 1;
  let prefixStart = start; let suffixEnd = end + 1;
  while (prefixStart > 0 && /[A-Za-z]/u.test(value[prefixStart - 1]!)) prefixStart -= 1;
  while (suffixEnd < value.length && /[A-Za-z]/u.test(value[suffixEnd]!)) suffixEnd += 1;
  const prefix = value.slice(prefixStart, start);
  const suffix = value.slice(end + 1, suffixEnd);
  const numbered = prefix.length === 1 && /(?:编号|图|表|章节)\s*$/u.test(value.slice(0, prefixStart));
  return (!prefix || /^v$/iu.test(prefix) || numbered) && (!suffix || ASCII_UNIT.test(suffix));
}

function hasDottedLocator(value: string) {
  for (const match of value.matchAll(/[.。]{2,}/gu)) {
    const start = match.index ?? 0;
    const left = value[start - 1] ?? "";
    const right = value[start + match[0].length] ?? "";
    if (left && right && !/[\s.,;:!?。！？；：，]/u.test(left + right)) return true;
  }
  for (let index = value.indexOf("."); index >= 0; index = value.indexOf(".", index + 1)) {
    const left = value[index - 1] ?? ""; const right = value[index + 1] ?? "";
    if (numericDotIsNotation(value, index)) continue;
    if (left && right && !/[\s.,;:!?。！？；：，]/u.test(left + right)) return true;
  }
  return false;
}

export function containsInlineCitationLocator(value: string) {
  const normalized = normalizeForScanning(value);
  if (normalized.unsafe) return true;
  const text = normalized.text;
  if (
    PATH_SEPARATOR.test(text)
    || EMAILISH.test(text)
    || hasMarkdownLocator(text)
    || hasColonLocator(text)
    || DOTFILE.test(text)
    || hasIdeographicLocator(text)
    || hasDottedLocator(text)
  ) return true;
  return [...text.matchAll(IPV4)].some(([, address]) => (
    address!.split(".").every((part) => Number(part) <= 255)
  ));
}

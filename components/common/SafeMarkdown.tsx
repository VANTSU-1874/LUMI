import type { ReactNode } from "react";

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; depth: 1 | 2 | 3; text: string }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; language: string; text: string }
  | { type: "rule" };

const FENCE_PATTERN = /^ {0,3}```([A-Za-z0-9_+#.-]{0,24})\s*$/;
const HEADING_PATTERN = /^ {0,3}(#{1,3})\s+(.+)$/;
const UNORDERED_PATTERN = /^\s*[-*+]\s+(.+)$/;
const ORDERED_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
const QUOTE_PATTERN = /^\s*>\s?(.*)$/;
const RULE_PATTERN = /^\s*(?:---+|___+|\*\*\*+)\s*$/;

function startsBlock(line: string) {
  return FENCE_PATTERN.test(line)
    || HEADING_PATTERN.test(line)
    || UNORDERED_PATTERN.test(line)
    || ORDERED_PATTERN.test(line)
    || QUOTE_PATTERN.test(line)
    || RULE_PATTERN.test(line);
}

function parseBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE_PATTERN);
    if (fence) {
      const contents: string[] = [];
      index += 1;
      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index] ?? "")) {
        contents.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fence[1] ?? "", text: contents.join("\n") });
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      blocks.push({
        type: "heading",
        depth: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!.trim(),
      });
      index += 1;
      continue;
    }

    const unordered = line.match(UNORDERED_PATTERN);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(UNORDERED_PATTERN);
        if (!item) break;
        items.push(item[1]!.trim());
        index += 1;
      }
      blocks.push({ type: "unordered-list", items });
      continue;
    }

    const ordered = line.match(ORDERED_PATTERN);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(ORDERED_PATTERN);
        if (!item) break;
        items.push(item[1]!.trim());
        index += 1;
      }
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    const quote = line.match(QUOTE_PATTERN);
    if (quote) {
      const quoted: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(QUOTE_PATTERN);
        if (!item) break;
        quoted.push(item[1]!.trim());
        index += 1;
      }
      blocks.push({ type: "quote", text: quoted.join("\n") });
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !startsBlock(lines[index] ?? "")) {
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

type InlineMatch = {
  index: number;
  length: number;
  node: (key: string) => ReactNode;
};

function nextInlineMatch(text: string): InlineMatch | null {
  const candidates: InlineMatch[] = [];
  const code = /`([^`\n]+)`/.exec(text);
  if (code) {
    candidates.push({
      index: code.index,
      length: code[0].length,
      node: (key) => <code className="rounded bg-[#edf1ee] px-1.5 py-0.5 font-mono text-[0.9em] text-[#214b40]" key={key}>{code[1]}</code>,
    });
  }
  const bold = /\*\*([^*\n]+)\*\*/.exec(text);
  if (bold) {
    candidates.push({
      index: bold.index,
      length: bold[0].length,
      node: (key) => <strong className="font-semibold text-[#202b27]" key={key}>{bold[1]}</strong>,
    });
  }
  const emphasis = /(^|[^*])\*([^*\n]+)\*/.exec(text);
  if (emphasis) {
    const prefixLength = emphasis[1]?.length ?? 0;
    candidates.push({
      index: emphasis.index + prefixLength,
      length: emphasis[0].length - prefixLength,
      node: (key) => <em key={key}>{emphasis[2]}</em>,
    });
  }
  const link = /\[([^\]\n]{1,200})\]\(([^)\n]+)\)/.exec(text);
  if (link) {
    candidates.push({
      index: link.index,
      length: link[0].length,
      node: (key) => <span key={key}>{link[1]}</span>,
    });
  }
  const newline = text.indexOf("\n");
  if (newline >= 0) {
    candidates.push({ index: newline, length: 1, node: (key) => <br key={key} /> });
  }
  return candidates.sort((left, right) => left.index - right.index || left.length - right.length)[0] ?? null;
}

function renderInline(text: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let sequence = 0;
  while (remaining) {
    const match = nextInlineMatch(remaining);
    if (!match) {
      nodes.push(remaining);
      break;
    }
    if (match.index > 0) nodes.push(remaining.slice(0, match.index));
    nodes.push(match.node(`${keyPrefix}-${sequence}`));
    sequence += 1;
    remaining = remaining.slice(match.index + match.length);
  }
  return nodes;
}

export function SafeMarkdown({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  const blocks = parseBlocks(children);
  return <div className={`space-y-3 [overflow-wrap:anywhere] text-[15px] leading-7 text-[#303a36] ${className}`.trim()}>
    {blocks.map((block, index) => {
      const key = `${block.type}-${index}`;
      if (block.type === "heading") {
        const headingClass = block.depth === 1
          ? "pt-2 text-lg font-semibold tracking-[-0.015em] text-[#1f2b27]"
          : "pt-1 text-base font-semibold text-[#26332e]";
        if (block.depth === 1) return <h3 className={headingClass} key={key}>{renderInline(block.text, key)}</h3>;
        if (block.depth === 2) return <h4 className={headingClass} key={key}>{renderInline(block.text, key)}</h4>;
        return <h5 className={headingClass} key={key}>{renderInline(block.text, key)}</h5>;
      }
      if (block.type === "unordered-list") {
        return <ul className="ml-1 list-disc space-y-1.5 pl-5 marker:text-[#4a8978]" key={key}>{block.items.map((item, itemIndex) => <li className="pl-1" key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}</ul>;
      }
      if (block.type === "ordered-list") {
        return <ol className="ml-1 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-[#397565]" key={key}>{block.items.map((item, itemIndex) => <li className="pl-1" key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}</ol>;
      }
      if (block.type === "quote") {
        return <blockquote className="rounded-r-xl border-l-2 border-[#7fae9f] bg-[#f4f8f5] py-2 pl-4 pr-3 text-[#4a5a54]" key={key}>{renderInline(block.text, key)}</blockquote>;
      }
      if (block.type === "code") {
        return <figure className="overflow-hidden rounded-xl border border-[#233832] bg-[#14231f]" key={key}>
          <figcaption className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[10px] font-medium text-[#a9beb6]"><span>代码示例</span>{block.language ? <span className="font-mono uppercase tracking-wide">{block.language}</span> : null}</figcaption>
          <pre className="overflow-x-auto p-3 text-[12px] leading-6 text-[#edf5f1]" tabIndex={0}><code className="font-mono">{block.text}</code></pre>
        </figure>;
      }
      if (block.type === "rule") return <hr className="border-[#dfe5e1]" key={key} />;
      return <p key={key}>{renderInline(block.text, key)}</p>;
    })}
  </div>;
}

import { defaultRehypePlugins } from "streamdown";

export const LUMI_TEXT_FENCE_CLASS = "lumi-text-fence";

const TEXT_FENCE_POSITIONS_KEY = "lumiExplicitProseFencePositions";

const TEXT_FENCE_LANGUAGES = new Set([
  "plain",
  "plaintext",
  "prose",
  "text",
  "text/plain",
  "txt",
]);

type MarkdownHastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownHastNode[];
  position?: {
    start?: { line?: number; column?: number; offset?: number };
    end?: { line?: number; column?: number; offset?: number };
  };
};

type MarkdownVFile = {
  data: Record<string, unknown>;
};

function classNamesOf(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? value.split(/\s+/u).filter(Boolean) : [];
}

function fenceLanguage(classNames: readonly string[]) {
  const languageClass = classNames.find((className) => className.startsWith("language-"));
  return languageClass?.slice("language-".length).trim().toLowerCase() ?? "";
}

function positionKey(node: MarkdownHastNode) {
  const { start, end } = node.position ?? {};
  if (typeof start?.offset === "number" && typeof end?.offset === "number") {
    return `offset:${start.offset}:${end.offset}`;
  }
  if (
    typeof start?.line === "number"
    && typeof start.column === "number"
    && typeof end?.line === "number"
    && typeof end.column === "number"
  ) {
    return `point:${start.line}:${start.column}:${end.line}:${end.column}`;
  }
  return null;
}

function collectTextFencePositions(
  node: MarkdownHastNode,
  positions: Set<string>,
  parent?: MarkdownHastNode,
) {
  if (node.type === "element" && node.tagName === "code" && parent?.tagName === "pre") {
    const classNames = classNamesOf(node.properties?.className);
    if (TEXT_FENCE_LANGUAGES.has(fenceLanguage(classNames))) {
      const key = positionKey(node);
      if (key) positions.add(key);
    }
  }

  node.children?.forEach((child) => collectTextFencePositions(child, positions, node));
}

function finalizeTextFences(
  node: MarkdownHastNode,
  positions: ReadonlySet<string>,
  parent?: MarkdownHastNode,
) {
  if (node.type === "element" && node.tagName === "code" && parent?.tagName === "pre") {
    const properties = node.properties ?? (node.properties = {});
    const classNames = classNamesOf(properties.className);
    const key = positionKey(node);
    if (
      key
      && positions.has(key)
      && TEXT_FENCE_LANGUAGES.has(fenceLanguage(classNames))
    ) {
      properties.className = classNames.includes(LUMI_TEXT_FENCE_CLASS)
        ? classNames
        : [...classNames, LUMI_TEXT_FENCE_CLASS];
    }
  }

  node.children?.forEach((child) => finalizeTextFences(child, positions, node));
}

/**
 * Records provenance before raw HTML is parsed, so only CommonMark code nodes
 * with an explicit prose label can become light text fences. Source positions
 * stay in the current VFile's private processing context across raw/sanitize,
 * so native pre/code and user-controlled class names cannot forge provenance.
 */
export function rehypeClassifyAssistantMarkdownFences() {
  return (tree: MarkdownHastNode, file: MarkdownVFile) => {
    const positions = new Set<string>();
    collectTextFencePositions(tree, positions);
    file.data[TEXT_FENCE_POSITIONS_KEY] = positions;
  };
}

function rehypeFinalizeAssistantMarkdownFences() {
  return (tree: MarkdownHastNode, file: MarkdownVFile) => {
    const value = file.data[TEXT_FENCE_POSITIONS_KEY];
    const positions = value instanceof Set ? value : new Set<string>();
    finalizeTextFences(tree, positions);
    delete file.data[TEXT_FENCE_POSITIONS_KEY];
  };
}

export const assistantMarkdownRehypePlugins = [
  rehypeClassifyAssistantMarkdownFences,
  ...Object.values(defaultRehypePlugins),
  rehypeFinalizeAssistantMarkdownFences,
];

import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SOURCE_DOCUMENT_NAME = "审美刻意训练白皮书.md";
const ATTACHMENTS_DIRECTORY_NAME = "图片和附件";
const ASSET_LIMIT_BYTES = 80 * 1024 * 1024;
const MAX_COMPRESSED_EDGE = 1600;

type AssetRole = "layout" | "type" | "color" | "grid";

type AssetMapping = {
  group: "poster" | "grid";
  role: AssetRole;
  sourceReference: string;
  sourceAbsolutePath: string;
  sourceBytes: number;
  targetRelativePath: string;
  targetAbsolutePath: string;
};

type AttachmentInventory = {
  files: Array<{ name: string; bytes: number; extension: string }>;
  bytes: number;
  byExtension: Map<string, number>;
};

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/");
}

function markdownImageReferences(markdown: string) {
  return [...markdown.matchAll(/!\[[^\]]*]\(([^)\r\n]+)\)/g)].map((match) => {
    const encoded = match[1].trim().replace(/^<|>$/g, "");
    let decoded: string;
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      throw new Error(`invalid percent-encoded image reference: ${encoded}`);
    }
    return normalizePath(decoded);
  });
}

function sourcePathForReference(
  corpusRoot: string,
  attachmentsRoot: string,
  reference: string,
) {
  const expectedPrefix = `${ATTACHMENTS_DIRECTORY_NAME}/`;
  if (!reference.startsWith(expectedPrefix)) {
    throw new Error(`image reference leaves the attachment directory: ${reference}`);
  }
  const relativeAttachment = reference.slice(expectedPrefix.length);
  const resolved = path.resolve(attachmentsRoot, ...relativeAttachment.split("/"));
  const relativeToAttachments = path.relative(attachmentsRoot, resolved);
  if (
    relativeToAttachments.startsWith("..")
    || path.isAbsolute(relativeToAttachments)
    || resolved === path.resolve(corpusRoot)
  ) {
    throw new Error(`unsafe image reference: ${reference}`);
  }
  return resolved;
}

async function attachmentInventory(attachmentsRoot: string): Promise<AttachmentInventory> {
  const entries = await readdir(attachmentsRoot, { withFileTypes: true });
  const files: AttachmentInventory["files"] = [];
  const byExtension = new Map<string, number>();
  let bytes = 0;
  for (const entry of entries.sort((left, right) => compareCodePoints(left.name, right.name))) {
    if (!entry.isFile()) {
      throw new Error(`unexpected nested attachment entry: ${entry.name}`);
    }
    const fileStat = await stat(path.join(attachmentsRoot, entry.name));
    const extension = path.extname(entry.name).toLowerCase() || "<none>";
    files.push({ name: entry.name, bytes: fileStat.size, extension });
    bytes += fileStat.size;
    byExtension.set(extension, (byExtension.get(extension) ?? 0) + 1);
  }
  return { files, bytes, byExtension };
}

function posterBlocks(markdown: string) {
  const headings = [...markdown.matchAll(/^###\s+📃海报[^\r\n]+$/gm)];
  if (headings.length !== 50) {
    throw new Error(`expected 50 poster headings, found ${headings.length}`);
  }
  return headings.map((heading, index) => {
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index
      ?? markdown.search(/^##\s+.*书籍整理.*$/m);
    if (end < start) throw new Error(`poster ${index + 1}: could not find block end`);
    return markdown.slice(start, end);
  });
}

function firstGridImageReference(markdown: string, caseNumber: number) {
  const number = String(caseNumber).padStart(2, "0");
  const headingPattern = new RegExp(`^##[^\\r\\n]*${number}网格版式设计[^\\r\\n]*$`, "m");
  const heading = headingPattern.exec(markdown);
  if (!heading || heading.index === undefined) {
    throw new Error(`grid case ${caseNumber}: heading not found`);
  }
  const afterHeading = heading.index + heading[0].length;
  const nextHeadingOffset = markdown.slice(afterHeading).search(/^##\s+/m);
  const blockEnd = nextHeadingOffset < 0 ? markdown.length : afterHeading + nextHeadingOffset;
  const references = markdownImageReferences(markdown.slice(afterHeading, blockEnd));
  if (references.length === 0) throw new Error(`grid case ${caseNumber}: image not found`);
  return references[0];
}

async function buildMappings(input: {
  markdown: string;
  corpusRoot: string;
  attachmentsRoot: string;
  outputRoot: string;
}) {
  const mappings: AssetMapping[] = [];
  const posterRoles = ["layout", "type", "color"] as const;
  for (const [posterIndex, block] of posterBlocks(input.markdown).entries()) {
    const references = markdownImageReferences(block);
    if (references.length !== 3) {
      throw new Error(`poster ${posterIndex + 1}: expected 3 images, found ${references.length}`);
    }
    for (const [roleIndex, reference] of references.entries()) {
      const role = posterRoles[roleIndex];
      const sourceAbsolutePath = sourcePathForReference(
        input.corpusRoot,
        input.attachmentsRoot,
        reference,
      );
      const sourceStat = await stat(sourceAbsolutePath);
      const filename = `poster-${String(posterIndex + 1).padStart(2, "0")}-${role}.png`;
      mappings.push({
        group: "poster",
        role,
        sourceReference: reference,
        sourceAbsolutePath,
        sourceBytes: sourceStat.size,
        targetRelativePath: normalizePath(path.join("assets", "layout-design", filename)),
        targetAbsolutePath: path.join(input.outputRoot, filename),
      });
    }
  }
  for (let caseNumber = 1; caseNumber <= 6; caseNumber += 1) {
    const reference = firstGridImageReference(input.markdown, caseNumber);
    const sourceAbsolutePath = sourcePathForReference(
      input.corpusRoot,
      input.attachmentsRoot,
      reference,
    );
    const sourceStat = await stat(sourceAbsolutePath);
    const filename = `grid-case-${caseNumber}.png`;
    mappings.push({
      group: "grid",
      role: "grid",
      sourceReference: reference,
      sourceAbsolutePath,
      sourceBytes: sourceStat.size,
      targetRelativePath: normalizePath(path.join("assets", "layout-design", filename)),
      targetAbsolutePath: path.join(input.outputRoot, filename),
    });
  }
  if (new Set(mappings.map(({ sourceAbsolutePath }) => sourceAbsolutePath)).size !== 156) {
    throw new Error("selected asset sources must be unique");
  }
  if (new Set(mappings.map(({ targetAbsolutePath }) => targetAbsolutePath)).size !== 156) {
    throw new Error("selected asset targets must be unique");
  }
  return mappings;
}

async function writeAssets(mappings: AssetMapping[], compress: boolean) {
  for (const mapping of mappings) {
    const sourceExtension = path.extname(mapping.sourceAbsolutePath).toLowerCase();
    if (!compress && sourceExtension === ".png") {
      await copyFile(mapping.sourceAbsolutePath, mapping.targetAbsolutePath);
      continue;
    }
    let pipeline = sharp(mapping.sourceAbsolutePath, { failOn: "error" });
    if (compress) {
      pipeline = pipeline.resize({
        width: MAX_COMPRESSED_EDGE,
        height: MAX_COMPRESSED_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    await pipeline.png({ compressionLevel: 9 }).toFile(mapping.targetAbsolutePath);
  }
}

function markdownTable(rows: string[][]) {
  return [
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function listItems(items: string[]) {
  return items.map((item) => `- \`${item}\``).join("\n");
}

function registryMarkdown(input: {
  sourceRoot: string;
  sourceDocumentPath: string;
  sourceDocumentBytes: number;
  sourceDocumentLines: number;
  sourceDocumentSha256: string;
  inventory: AttachmentInventory;
  allImageReferences: string[];
  mappings: AssetMapping[];
  selectedSourceBytes: number;
  outputBytes: number;
  compressed: boolean;
}) {
  const extensionRows = [
    ["扩展名", "数量"],
    ...[...input.inventory.byExtension.entries()]
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([extension, count]) => [`\`${extension}\``, String(count)]),
  ];
  const mappingRows = [
    ["源文件", "仓库目标", "角色"],
    ...input.mappings.map((mapping) => [
      `\`${path.basename(mapping.sourceAbsolutePath)}\``,
      `\`${normalizePath(path.join("data", "courses", mapping.targetRelativePath))}\``,
      mapping.group === "poster" ? mapping.role : "grid",
    ]),
  ];
  const pdfs = input.inventory.files
    .filter(({ extension }) => extension === ".pdf")
    .map(({ name }) => name);
  const videos = input.inventory.files
    .filter(({ extension }) => extension === ".mp4")
    .map(({ name }) => name);
  const sourceRootNormalized = normalizePath(input.sourceRoot);
  const sourceDocumentNormalized = normalizePath(input.sourceDocumentPath);
  return `# AES-WP 源材料登记表

> 本文件是品牌与来源代号的唯一映射登记，不进入编号语料转换。编号条目和生成知识不得复制本节的资料全称或机构名。

## 代号与来源

- 内部代号：\`AES-WP\`
- 资料全称：《审美刻意训练白皮书》
- 提供机构：摇醒（shake up）
- 源目录：\`${sourceRootNormalized}\`
- 源正文：\`${sourceDocumentNormalized}\`
- 源正文大小：${input.sourceDocumentBytes.toLocaleString("en-US")} bytes
- 源正文行数：${input.sourceDocumentLines.toLocaleString("en-US")}
- 源正文 SHA-256：\`${input.sourceDocumentSha256}\`

## 索引边界与红线

- 检索转换只读取 \`data/courses/<受支持课程>/<三位序号>-<slug>.md\`；\`inbox/\`、本 REGISTRY、\`FORMAT.md\`、\`NEEDS.md\` 与 \`INTAKE.md\` 不入索引。
- 扫描书 PDF 不拆条、不摘抄正文、不复制进仓库；学术论文只用于核验，不整篇摘录。
- 百度网盘与外部资料包链接剔除；视频不入库。
- 小红书专栏（源正文 4942–5205 行）明确排除。
- 海报配图只作教学演示；条目不声称作品版权或作者归属。
- 海报 27 的字体段与海报 29 的三段正文存在明显错配；对应条目只使用各自标注图可直接观察的视觉关系。

## 源材料清点

- 附件：${input.inventory.files.length} 个，共 ${input.inventory.bytes.toLocaleString("en-US")} bytes。
- Markdown 图片引用：${input.allImageReferences.length} 个、${new Set(input.allImageReferences).size} 个唯一引用、缺失 0。

${markdownTable(extensionRows)}

### PDF（18 个，仅登记，不复制）

${listItems(pdfs)}

- 其中 \`拼贴艺术观念对数字媒体设计的价值探究_陶哲.pdf\` 与带 \` 1\` 后缀的同题文件大小相同，按疑似重复来源处理。
- 复古未来章节正文列出的核验论文未在附件中找到，因此对应史实条目暂缓。

### 视频（6 个，全部排除）

${listItems(videos)}

## 正文板块与行号

| 板块 | 行号 | 处理 |
| --- | ---: | --- |
| 使用说明 | 9–59 | 仅作边界参考 |
| 七大风格 | 60–2365 | 拆为 13 条；缺核验附件的复古未来史暂缓 |
| 海报前置内容 | 2366–2505 | 不单独拆条 |
| 50 张海报 | 2506–3537 | 50 条，每条 3 张标注图 |
| 书籍 | 3538–3713 | 2 条，不摘录扫描书正文 |
| 字体与品牌字标 | 3714–3991 | 5 条；只有图片的六字体条暂缓 |
| 网格与排版技巧 | 3992–4325 | 5 条，另选 6 张案例图 |
| 网站区 | 4326–4941 | 1 条不含 URL 的资源选择方法 |
| 小红书专栏 | 4942–5205 | 排除 |

## 精选资产决策

- 海报标注图：150 张；网格案例关键图：6 张。
- 拷贝前合并计量：${input.selectedSourceBytes.toLocaleString("en-US")} bytes（${(input.selectedSourceBytes / 1024 / 1024).toFixed(2)} MiB）。
- 门槛：${ASSET_LIMIT_BYTES.toLocaleString("en-US")} bytes（80 MiB）。
- 是否压缩长边至 ${MAX_COMPRESSED_EDGE}px：${input.compressed ? "是" : "否"}。
- 仓库产物体积：${input.outputBytes.toLocaleString("en-US")} bytes（${(input.outputBytes / 1024 / 1024).toFixed(2)} MiB）。
- JPG 网格源图转换为真实 PNG；PNG 海报源图在未触发门槛时逐字节复制。
- 海报规范命名缺号 17、59、第二组 15，但正文分别引用异名替代文件，实物齐全，不是缺图。

## 源文件到仓库文件映射（156 项）

${markdownTable(mappingRows)}
`;
}

export async function importAestheticAssets() {
  const sourceRootValue = process.env.AESTHETIC_CORPUS_ROOT?.trim();
  if (!sourceRootValue) {
    throw new Error("AESTHETIC_CORPUS_ROOT must point to the external corpus directory");
  }
  const sourceRoot = path.resolve(sourceRootValue);
  const sourceDocumentPath = path.join(sourceRoot, SOURCE_DOCUMENT_NAME);
  const attachmentsRoot = path.join(sourceRoot, ATTACHMENTS_DIRECTORY_NAME);
  const outputRoot = path.resolve("data", "courses", "assets", "layout-design");
  const registryPath = path.resolve(
    "data",
    "courses",
    "inbox",
    "aesthetic-whitepaper-REGISTRY.md",
  );
  const markdownBuffer = await readFile(sourceDocumentPath);
  const markdown = markdownBuffer.toString("utf8");
  const inventory = await attachmentInventory(attachmentsRoot);
  const allImageReferences = markdownImageReferences(markdown);
  const missingReferences: string[] = [];
  for (const reference of allImageReferences) {
    try {
      await stat(sourcePathForReference(sourceRoot, attachmentsRoot, reference));
    } catch {
      missingReferences.push(reference);
    }
  }
  if (missingReferences.length > 0) {
    throw new Error(`missing Markdown image references: ${missingReferences.join(", ")}`);
  }
  if (allImageReferences.length !== 361 || new Set(allImageReferences).size !== 361) {
    throw new Error(
      `expected 361 unique Markdown image references, found ${allImageReferences.length}/${new Set(allImageReferences).size}`,
    );
  }

  await mkdir(outputRoot, { recursive: true });
  await mkdir(path.dirname(registryPath), { recursive: true });
  const mappings = await buildMappings({
    markdown,
    corpusRoot: sourceRoot,
    attachmentsRoot,
    outputRoot,
  });
  const selectedSourceBytes = mappings.reduce((sum, mapping) => sum + mapping.sourceBytes, 0);
  const compressed = selectedSourceBytes > ASSET_LIMIT_BYTES;
  await writeAssets(mappings, compressed);
  let outputBytes = 0;
  for (const mapping of mappings) {
    const metadata = await sharp(mapping.targetAbsolutePath, { failOn: "error" }).metadata();
    if (metadata.format !== "png") {
      throw new Error(`${mapping.targetRelativePath}: output is not PNG`);
    }
    outputBytes += (await stat(mapping.targetAbsolutePath)).size;
  }
  const sourceDocumentLines = markdown.replace(/\r?\n$/, "").split(/\r?\n/).length;
  const registry = registryMarkdown({
    sourceRoot,
    sourceDocumentPath,
    sourceDocumentBytes: markdownBuffer.length,
    sourceDocumentLines,
    sourceDocumentSha256: createHash("sha256").update(markdownBuffer).digest("hex"),
    inventory,
    allImageReferences,
    mappings,
    selectedSourceBytes,
    outputBytes,
    compressed,
  });
  await writeFile(registryPath, registry, "utf8");
  return {
    sourceDocumentLines,
    attachmentCount: inventory.files.length,
    markdownImageReferenceCount: allImageReferences.length,
    selectedAssetCount: mappings.length,
    selectedSourceBytes,
    outputBytes,
    compressed,
    registryPath: normalizePath(path.relative(process.cwd(), registryPath)),
  };
}

importAestheticAssets()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });

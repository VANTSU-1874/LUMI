import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_DOCUMENT_NAME = "审美刻意训练白皮书.md";
const POSTER_COUNT = 50;
const BANNED_BRAND_PATTERN = /摇醒|shake\s*up|审美刻意训练白皮书/i;
const URL_PATTERN = /https?:\/\/\S+/gi;

type PosterAnalyses = {
  layout: string;
  type: string;
  color: string;
};

function posterBlocks(markdown: string) {
  const headings = [...markdown.matchAll(/^###\s+📃海报[^\r\n]+$/gm)];
  if (headings.length !== POSTER_COUNT) {
    throw new Error(`expected ${POSTER_COUNT} poster headings, found ${headings.length}`);
  }
  return headings.map((heading, index) => {
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index
      ?? markdown.search(/^##\s+.*书籍整理.*$/m);
    if (end < start) {
      throw new Error(`poster ${index + 1}: could not find block end`);
    }
    return markdown.slice(start, end);
  });
}

function imageMatches(block: string) {
  return [...block.matchAll(/!\[[^\]]*]\(([^)\r\n]+)\)/g)];
}

function cleanAnalysis(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*>\s?/, "")
      .replaceAll("\\", "")
      .replace(/\*\*/g, "")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .trim())
    .filter((line) =>
      line
      && line !== "---"
      && !/^[123]\s*[.,，、]?\s*(版式拆分|版式设计|字体形式|色彩构图)\s*$/.test(line)
    );
  return lines
    .join(" ")
    .replace(URL_PATTERN, "")
    .replace(/\s+/g, " ")
    .replaceAll("完美契合了", "与主题形成联系")
    .replaceAll("完美呼应了", "与主题形成联系")
    .replaceAll("精准呼应了", "与主题形成联系")
    .replaceAll("完美契合", "与主题形成联系")
    .replaceAll("完美呼应", "与主题形成联系")
    .replaceAll("完美融合", "形成结合")
    .replaceAll("精准呼应", "与主题形成联系")
    .replaceAll("精准传递", "传递")
    .replaceAll("经典设计", "案例")
    .replaceAll("经典表达", "表达")
    .replaceAll("极具", "具有")
    .trim();
}

function analysesForBlock(block: string, posterNumber: number): PosterAnalyses {
  const images = imageMatches(block);
  if (images.length !== 3) {
    throw new Error(`poster ${posterNumber}: expected 3 images, found ${images.length}`);
  }
  const analyses = images.map((image, index) => {
    const start = (image.index ?? 0) + image[0].length;
    const end = images[index + 1]?.index ?? block.length;
    return cleanAnalysis(block.slice(start, end));
  });
  if (analyses.some((analysis) => !analysis)) {
    throw new Error(`poster ${posterNumber}: empty analysis after normalization`);
  }
  if (posterNumber === 6 && /^张海报/.test(analyses[1])) {
    analyses[1] = `这${analyses[1]}`;
  }
  if (posterNumber === 44 && /^报采用/.test(analyses[0])) {
    analyses[0] = `海${analyses[0]}`;
  }

  const result: PosterAnalyses = {
    layout: analyses[0],
    type: analyses[1],
    color: analyses[2],
  };
  if (posterNumber === 27) {
    result.type = "标注图显示，主标题使用厚重的宋体或黑体变体，笔画粗犷，承担主要视觉重量；其余中英文信息使用不同粗细的无衬线体，以字号、颜色和横竖方向区分大标题、次要信息、内容与装饰性文字。多方向排布保留了错落节奏，也要求在真实尺寸中逐级检查可读性。";
  }
  if (posterNumber === 29) {
    result.layout = "标注图显示，版面采用去中心化的自由结构，以像素化重构的三个大字作为视觉主体。中英文主标题放大后错落叠排，占据上部核心区域；展览日期、地点与辅助信息沿下方横向展开。文字图形的层叠和错位形成上下平衡，并以重复点阵建立贯穿版面的节奏。";
    result.type = "标注图显示，主视觉使用黑黄碰撞的像素化、点阵化汉字，笔画被拆成点状和块状，形成数字信号被重组的质感。顶部亮粉色中英文无衬线标题与主体形成对比，底部信息则用较细的无衬线体维持可读性；字号与粗细共同区分主标题、内容和装饰性文字。";
    result.color = "标注图显示，白色基底上使用黑、黄、亮粉三色形成高对比。黑色像素字建立主体重量，黄色轮廓制造视觉焦点，亮粉标题与底部小字形成上下呼应。色彩叠加和错位加强数字信号感，但核心信息仍需在实际输出尺寸中检查对比和辨识度。";
  }
  return result;
}

function quote(value: string) {
  return JSON.stringify(value);
}

function listField(name: string, values: string[]) {
  return [
    `${name}:`,
    ...values.map((value) => `  - ${quote(value)}`),
  ].join("\n");
}

function serializePosterEntry(input: {
  posterNumber: number;
  analyses: PosterAnalyses;
}) {
  const number = String(input.posterNumber).padStart(2, "0");
  const sequence = String(100 + input.posterNumber);
  const images = ["layout", "type", "color"]
    .map((role) => `assets/layout-design/poster-${number}-${role}.png`);
  const markdown = `---
课程标签: "版式设计"
内容类型: "学理内容"
标题: "从海报案例 ${number} 复核版式、字体与色彩关系"
来源出处: "第三方教研资料 AES-WP + 海报 ${number} 标注图"
来源类别: "第三方教研资料"
可信度: "教师经验"
事实边界: "本条只整理源材料及标注图中可观察的版式、字体和色彩关系；不核定作品作者、年代、版权归属或传播效果。"
${listField("适用问题", [
    `想参考海报案例 ${number}，应该先临摹哪一种关系`,
    `怎样把案例 ${number} 的层级方法换成自己的内容`,
  ])}
${listField("关键词", ["版式拆分", "字体形式", "色彩构图", "可观察证据"])}
${listField("配图", images)}
---

## 核心内容

以下三段需结合对应标注图阅读，重点是关系而非表面风格。

### 版式拆分

${input.analyses.layout}

### 字体形式

${input.analyses.type}

### 色彩构图

${input.analyses.color}

## 导师可先追问

- 你的项目目标和受众与这个案例有哪些关键差异？
- 版式、字体、色彩三组关系里，哪一组最能解决你当前的问题？
- 你能在配图上指出支持判断的具体位置吗？

## 提示与局部示范

- 先只临摹一个关系，例如主体与辅助信息的面积对比；其余内容保持自己的版本。
- 替换成自己的标题与信息后，在真实输出尺寸截图，检查阅读顺序是否仍成立。

## 常见误区与证据

- 版式证据应落实到对齐、分区、遮挡、疏密或阅读顺序，不能只说“有设计感”。
- 字体证据应落实到字形、字号、字重、方向和文字角色，不能只凭字体类别下结论。
- 色彩证据应落实到色相、明度、面积与位置关系，不能把情绪形容词当成唯一证据。
- 临摹只复现一项可说明的关系；直接复制文字、图像和完整构图不能证明已经理解。

## 使用边界

配图仅供教学演示和关系分析；临摹用于训练，不得直接提交为作业成果，也不得据此声称作品版权或作者归属。

## 术语待议

- 无。
`;
  if (BANNED_BRAND_PATTERN.test(markdown)) {
    throw new Error(`poster ${input.posterNumber}: banned source brand leaked into entry`);
  }
  if (URL_PATTERN.test(markdown)) {
    throw new Error(`poster ${input.posterNumber}: URL leaked into entry`);
  }
  return {
    filename: `${sequence}-poster-${number}-analysis.md`,
    markdown,
  };
}

export async function generateAestheticPosters(input: {
  sourceRoot: string;
  start: number;
  end: number;
}) {
  if (
    !Number.isInteger(input.start)
    || !Number.isInteger(input.end)
    || input.start < 1
    || input.end > POSTER_COUNT
    || input.start > input.end
  ) {
    throw new Error(`poster range must satisfy 1 <= start <= end <= ${POSTER_COUNT}`);
  }
  const sourcePath = path.join(path.resolve(input.sourceRoot), SOURCE_DOCUMENT_NAME);
  const markdown = await readFile(sourcePath, "utf8");
  const blocks = posterBlocks(markdown);
  const outputDirectory = path.resolve("data", "courses", "layout-design");
  await mkdir(outputDirectory, { recursive: true });
  const written: string[] = [];
  for (let posterNumber = input.start; posterNumber <= input.end; posterNumber += 1) {
    const entry = serializePosterEntry({
      posterNumber,
      analyses: analysesForBlock(blocks[posterNumber - 1], posterNumber),
    });
    await writeFile(path.join(outputDirectory, entry.filename), entry.markdown, "utf8");
    written.push(entry.filename);
  }
  return {
    sourcePosterCount: blocks.length,
    start: input.start,
    end: input.end,
    generatedCount: written.length,
    generatedFiles: written,
    correctedSourceAnalyses: [
      ...(input.start <= 27 && input.end >= 27 ? ["poster-27-type"] : []),
      ...(input.start <= 29 && input.end >= 29
        ? ["poster-29-layout", "poster-29-type", "poster-29-color"]
        : []),
    ],
  };
}

const sourceRoot = process.env.AESTHETIC_CORPUS_ROOT?.trim();
const start = Number(process.argv[2]);
const end = Number(process.argv[3]);
if (!sourceRoot) {
  process.stderr.write("AESTHETIC_CORPUS_ROOT must point to the external corpus directory\n");
  process.exitCode = 1;
} else {
  generateAestheticPosters({ sourceRoot, start, end })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

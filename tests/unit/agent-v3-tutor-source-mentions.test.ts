import { describe, expect, it } from "vitest";

import { knowledgeIdsExplicitlyMentioned } from "@/lib/agent/v3/tutor-source-mentions";
import type { KnowledgeItem } from "@/lib/knowledge/retrieve";

function knowledge(id: string, title: string): KnowledgeItem {
  return {
    id,
    title,
    topic: "INFORMATION_HIERARCHY",
    tags: ["版式"],
    content: `${title}的测试内容。`,
    facts: [],
    actions: [],
    source: {
      authority: "COURSE_DESIGN",
      verifiedDate: "2026-07-18",
      scope: "测试来源标题是否被明确提及",
      localDocument: "test.md",
    },
  };
}

describe("V3 tutor source mentions", () => {
  const hierarchy = knowledge("information-hierarchy", "信息层级与页序（课程设计）");
  const readingTest = knowledge("layout-evidence", "版面证据与阅读测试（课程设计）");

  it("recognizes a candidate's complete title in the visible answer", () => {
    expect(knowledgeIdsExplicitlyMentioned(
      "这个判断依据《信息层级与页序（课程设计）》中的分层方法。",
      [hierarchy],
    )).toEqual(["information-hierarchy"]);
  });

  it.each([
    "这个判断依据课程资料信息层级与页序（课程设计）",
    "信息层级与页序（课程设计）指出先分层再排页。",
  ])("recognizes an attributed complete title without book-title marks", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [hierarchy]))
      .toEqual(["information-hierarchy"]);
  });

  it("recognizes the quoted title after removing the trailing course-design qualifier", () => {
    expect(knowledgeIdsExplicitlyMentioned(
      "这里可以参照《信息层级与页序》来安排阅读顺序，再根据《版面证据与阅读测试》检查结果。",
      [hierarchy, readingTest],
    )).toEqual(["information-hierarchy", "layout-evidence"]);
  });

  it("normalizes English case, width, and a controlled official-document qualifier", () => {
    const official = knowledge("getting-started", "Getting started（Derivative官方文档）");
    expect(knowledgeIdsExplicitlyMentioned(
      "根据《ＧＥＴＴＩＮＧ   ＳＴＡＲＴＥＤ》先核对官方入门步骤。",
      [official],
    )).toEqual(["getting-started"]);
  });

  it("does not attach a candidate whose title is not mentioned", () => {
    expect(knowledgeIdsExplicitlyMentioned(
      "先把最重要的信息放在读者最容易看到的位置。",
      [hierarchy],
    )).toEqual([]);
  });

  it("does not treat short or generic words as explicit source mentions", () => {
    const genericCandidates = [
      knowledge("design", "设计"),
      knowledge("grid", "网格系统"),
    ];

    expect(knowledgeIdsExplicitlyMentioned(
      "这个设计可以先用网格系统整理，再比较两个版本。",
      genericCandidates,
    )).toEqual([]);
  });

  it("does not attach an unquoted base title or an uncited full-title phrase", () => {
    expect(knowledgeIdsExplicitlyMentioned(
      "先调整信息层级与页序；信息层级与页序（课程设计）也是当前要解决的问题。",
      [hierarchy],
    )).toEqual([]);
  });

  it.each([
    "我没有使用《信息层级与页序》，只用了自己的判断。",
    "不要参考《信息层级与页序》，请用通用设计经验。",
    "不能依据《信息层级与页序》继续判断。",
    "别使用《信息层级与页序》。",
    "不可按照《信息层级与页序》安排内容。",
    "你提到《信息层级与页序》，所以我先复述这个名字。",
    "你问的是《信息层级与页序》吗？",
    "请只复述资料名：《信息层级与页序》。",
    "例如《信息层级与页序》只是一个举例名称。",
    "以《信息层级与页序》为例说明书名号。",
    "《信息层级与页序》仅用于举例。",
    "这不是来自《信息层级与页序》的判断。",
    "这个说法并非引自《信息层级与页序》。",
    "我没有借鉴《信息层级与页序》，只用了通用经验。",
    "这不是课程资料《信息层级与页序》，只是同名标题。",
    "我不引用《信息层级与页序》，这里只给通用建议。",
    "请勿参考《信息层级与页序》。",
    "学生问我是否可以参考《信息层级与页序》。",
    "问题是在没有资料时能否依据《信息层级与页序》？",
    "如果参考《信息层级与页序》，结果会怎样？",
    "不是说要参考《信息层级与页序》，这里只是在复述。",
    "不要把《信息层级与页序》中指出当作固定句式。",
    "不是《信息层级与页序》中指出的结论。",
    "若参考《信息层级与页序》，结果会怎样？",
    "这里只是在复述‘参考《信息层级与页序》’这句话。",
    "如果《信息层级与页序》中指出先分层，我们再采用。",
    "假设《信息层级与页序》中建议先分层，这只是条件句。",
    "把参考《信息层级与页序》当作一个例子。",
    "这里只演示如何参考《信息层级与页序》。",
    "例如，参考《信息层级与页序》只是句式演示。",
    "比如，依据《信息层级与页序》来说明书名号。",
    "参考《信息层级与页序》？这只是问题，不是引用。",
    "我本来参考《信息层级与页序》，但最终完全没有采用。",
    "要参考《信息层级与页序》吗？不用。",
    "我参考《信息层级与页序》了吗？没有。",
    "可以根据《信息层级与页序》来安排吗？",
    "错误示范：根据《信息层级与页序》安排页序。",
    "反例：根据《信息层级与页序》安排页序。",
    "可以改成这句：课程资料《信息层级与页序》中指出先分层。",
    "学生原话是：我参考《信息层级与页序》。",
    "课程资料《信息层级与页序》并未用于本回答。",
    "参考《信息层级与页序》只是学生原话。",
    "课程资料《信息层级与页序》只用于格式演示。",
    "课程资料《信息层级与页序》仅作书名号示例。",
    "课程资料《信息层级与页序》只是在这里被提及。",
    "我暂时把课程资料《信息层级与页序》列为备选，尚未使用。",
    "我不建议参考《信息层级与页序》，先用自己的判断。",
    "我不想参考《信息层级与页序》。",
    "我不愿依据《信息层级与页序》。",
    "学生说：“我参考《信息层级与页序》安排的。”",
    "用户说：“我根据《信息层级与页序》做了判断。”",
    "你刚才说：“我依据《信息层级与页序》排页。”",
    "设想《信息层级与页序》中指出先分层。",
    "根据《信息层级与页序》安排页序；但前一句作废。",
    "参考《信息层级与页序》，可以吗？",
    "要参考《信息层级与页序》，还是不用？",
    "可以根据《信息层级与页序》，来安排吗？",
    "参考文献：《信息层级与页序》仅供格式演示。",
    "出处：《信息层级与页序》。",
    "参考文献：《信息层级与页序》。",
    "我把《信息层级与页序》作为待选参考，尚未使用。",
    "《信息层级与页序》是学生提到的来源。",
    "错误示范：\n根据《信息层级与页序》安排页序。",
    "学生原话：\n> 我参考《信息层级与页序》安排页序。",
    "句式示例：\n参考《信息层级与页序》",
    "我在考虑参考《信息层级与页序》是否合适。",
    "参考《信息层级与页序》可以吗。",
    "我曾参考《信息层级与页序》，但后来改用另一份资料。",
    "所谓《信息层级与页序》中指出先分层。",
    "举个例子，参考《信息层级与页序》。",
    "例句：参考《信息层级与页序》。",
    "示范一下，依据《信息层级与页序》。",
    "原句是：‘参考《信息层级与页序》’。",
    "`参考《信息层级与页序》`",
    "```text\n根据《信息层级与页序》安排页序。\n```",
    "~~根据《信息层级与页序》安排页序~~。",
    "用《信息层级与页序》作例子说明书名号。",
    "我用了《信息层级与页序》这个名字做格式演示。",
    "引用《信息层级与页序》这个标题作为示例。",
    "我不建议再参考《信息层级与页序》。",
    "我不太建议参考《信息层级与页序》。",
    "我不想继续参考《信息层级与页序》。",
    "我不建议你参考《信息层级与页序》。",
    "我不需要参考《信息层级与页序》。",
    "我不推荐使用《信息层级与页序》。",
    "我否认参考过《信息层级与页序》。",
    "这未必需要参考《信息层级与页序》。",
    "请把“我参考《信息层级与页序》做了判断”这句话删掉。",
    "你刚才的原话是：“我参考《信息层级与页序》排页。”",
    "学生表示：“我参考《信息层级与页序》安排的。”",
    "有人声称《信息层级与页序》中指出先分层。",
    "假定《信息层级与页序》中指出先分层，我们再讨论。",
    "即使《信息层级与页序》中指出先分层，我也不会采用。",
    "我参考《信息层级与页序》安排页序；以上说法撤回。",
    "我参考《信息层级与页序》——这不是真的。",
    "你是参考《信息层级与页序》做的，对吧？",
    "我们讨论的问题是“参考《信息层级与页序》是否合适”。",
    "没必要参考《信息层级与页序》，先用自己的判断。",
    "为什么要参考《信息层级与页序》？",
    "我准备参考《信息层级与页序》完善下一版。",
    "这里只演示两个字：参考\n《信息层级与页序》作为书名号例子。",
    "学生原话如下：\n我根据《信息层级与页序》安排页序。",
    "错误示范如下：\n根据《信息层级与页序》安排页序。",
    "错误示范\n1. 根据《信息层级与页序》安排页序。",
    "我之后可能会参考《信息层级与页序》。",
    "我下一版会参考《信息层级与页序》。",
    "稍后将根据《信息层级与页序》调整页序。",
    "这个版本可能参考了《信息层级与页序》，但我无法确认。",
    "据说《信息层级与页序》中指出先分层。",
    "怎么参考《信息层级与页序》？",
    "参考《信息层级与页序》是否可靠？",
    "参考《信息层级与页序》行不行？",
    "请问参考《信息层级与页序》怎么样？",
    "我参考《信息层级与页序》，但后来删除了这条依据。",
    "我参考《信息层级与页序》；刚才那句话取消。",
    "我用《信息层级与页序》给文件命名。",
    "我用《信息层级与页序》作为搜索关键词。",
    "我按《信息层级与页序》命名这个小节。",
    "    根据《信息层级与页序》安排页序。",
    "```text\n根据《信息层级与页序》安排页序。",
    "<!-- 根据《信息层级与页序》安排页序。 -->",
    "请输出 ``参考《信息层级与页序》`` 这几个字。",
    "> 学生原话：\n我参考《信息层级与页序》。",
    "学生原话：“\n我参考《信息层级与页序》\n”",
    "### 学生原话\n我参考《信息层级与页序》。",
    "接下来再参考《信息层级与页序》。",
    "这个版本看起来像是参考了《信息层级与页序》。",
    "这个版本参考了《信息层级与页序》，但我尚不能确定。",
    "参考《信息层级与页序》合不合适？",
    "参考《信息层级与页序》值得吗？",
    "我参考《信息层级与页序》；刚才那句话收回。",
    "我参考《信息层级与页序》；以上内容无效。",
    "我用《信息层级与页序》当文件名。",
    "我用《信息层级与页序》当搜索词。",
    "学生回答：我参考《信息层级与页序》安排页序。",
    "请删除 '我参考《信息层级与页序》' 这句话。",
    "等确认需求后再参考《信息层级与页序》。",
    "错误示范：下面这句不要照抄\n根据《信息层级与页序》安排页序。",
    "下面是学生原话：\n我参考《信息层级与页序》安排页序。",
    "以下是错误示范：\n根据《信息层级与页序》安排页序。",
    "这个版本好像参考了《信息层级与页序》。",
    "待需求确认后参考《信息层级与页序》。",
    "学生的原话如下：\n我参考《信息层级与页序》安排页序。",
    "错误示例：\n根据《信息层级与页序》安排页序。",
    "请输出 ``这里是\n根据《信息层级与页序》`` 这几个字。",
    "<blockquote>根据《信息层级与页序》安排页序。</blockquote>\n这里只给通用建议。",
    "<q>根据《信息层级与页序》安排页序。</q>\n这里只给通用建议。",
    "学生原话：\n1. 我参考《信息层级与页序》安排页序。\n2. 我依据《信息层级与页序》完成分层。",
  ])("does not infer a source from negation, restatement, or example context: %s", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [hierarchy])).toEqual([]);
  });

  it.each([
    "这不是凭空猜测，我参考《信息层级与页序》安排页序。",
    "没有别的资料，按《信息层级与页序》先做分层。",
    "《信息层级与页序》中强调先分层再排页。",
    "我参考了《信息层级与页序》来安排页序。",
    "我使用过《信息层级与页序》中的检查方法。",
    "这一步参考的是《信息层级与页序》。",
    "基于《信息层级与页序》安排页序。",
    "《信息层级与页序》中提到先分层。",
    "不妨参考《信息层级与页序》来安排页序。",
    "不但参考《信息层级与页序》，还做了阅读测试。",
    "没有别的选择只好参考《信息层级与页序》。",
    "虽然没有逐字引用但我参考《信息层级与页序》。",
    "依据课程资料中的《信息层级与页序》安排页序。",
    "参考的资料是《信息层级与页序》。",
    "我以《信息层级与页序》为依据。",
    "我从《信息层级与页序》中采用了分层法。",
    "《信息层级与页序》是这里的依据。",
    "从《信息层级与页序》中可以看出应先分层。",
    "据《信息层级与页序》记载，应先分层。",
    "参见《信息层级与页序》。",
    "《信息层级与页序》表明应先分层。",
    "我阅读了《信息层级与页序》，并用其中的方法。",
    "根据《信息层级与页序》，先完成内容分层，然后你更想突出哪一层？",
    "我先依据《信息层级与页序》完成分层，你接下来想先排目录还是封面？",
    "《信息层级与页序》指出先分层，你准备从哪一页开始？",
    "我采纳《信息层级与页序》中的分层方法。",
    "这句话摘自《信息层级与页序》。",
    "《信息层级与页序》写道先分层。",
    "《信息层级与页序》显示应先分层。",
    "以《信息层级与页序》为准来安排页序。",
    "本回答的依据是《信息层级与页序》。",
    "出处是《信息层级与页序》。",
    "我用了《信息层级与页序》的方法。",
    "依照《信息层级与页序》安排页序。",
    "遵循《信息层级与页序》的分层方法。",
    "我参考了 **《信息层级与页序》**。",
    "根据**《信息层级与页序》**安排页序。",
    "依据 [《信息层级与页序》](https://example.invalid/source) 安排页序。",
    "根据《信息层级与页序》，先完成内容分层，你愿意试试吗？",
    "我先依据《信息层级与页序》给出三层，你觉得可以吗？",
    "《信息层级与页序》指出先分层，你同意吗？",
    "这个判断的来源是《信息层级与页序》。",
    "这套方法源自《信息层级与页序》。",
    "《信息层级与页序》提供了分层方法。",
    "我参阅了《信息层级与页序》。",
    "根据[信息层级与页序](https://example.invalid/source)安排页序。",
    "根据“信息层级与页序（课程设计）”安排页序。",
    "根据「信息层级与页序（课程设计）」安排页序。",
    "根据 **信息层级与页序** 安排页序。",
    "这套方法出自《信息层级与页序》。",
    "下面这个示例依据《信息层级与页序》中的方法。",
    "针对学生说的层级混乱，我根据《信息层级与页序》给出建议。",
    "根据《信息层级与页序》完成分层后你准备好了吗？",
    "我不仅参考《信息层级与页序》，还做了阅读测试。",
    "我不只参考《信息层级与页序》，还进行了走查。",
    "我没少参考《信息层级与页序》。",
    "我参阅了《信息层级与页序》。你愿意试试吗？",
    "我参考《信息层级与页序》的分层原则，但没有采用它的页序方案。",
    "我考虑后采用了《信息层级与页序》的方法。",
    "我讨论后参考了《信息层级与页序》。",
    "我完成模拟测试后参考了《信息层级与页序》。",
    "我比较若干方案后采用了《信息层级与页序》。",
    "这个结论取自《信息层级与页序》。",
    "《信息层级与页序》介绍了分层方法。",
    "《信息层级与页序》解释了为什么先分层。",
    "我没有完全采用《信息层级与页序》，只用了其中的分层方法。",
    "我未完整采用《信息层级与页序》，但参考了其中原则。",
    "我从未不参考《信息层级与页序》。",
    "我不是没有参考《信息层级与页序》，只是没有逐字引用。",
    "我实际采用了“根据《信息层级与页序》先分层”这一方法。",
    "我引用的是“《信息层级与页序》中指出先分层”这个结论。",
    "我参考《信息层级与页序》安排页序，但具体页数无法确认。",
    "我不否认参考了《信息层级与页序》。",
    "在 student's 项目里，我参考《信息层级与页序》重新分层。",
    "我实际参考了“根据《信息层级与页序》先分层”这一方法。",
    "本回答依据的是“《信息层级与页序》中指出先分层”这个结论。",
    "在 designer's 流程里，我参考《信息层级与页序》；这是 student's 版本。",
    "本回答依据：“《信息层级与页序》中指出先分层。”",
    "本回答依据：\n“《信息层级与页序》中指出先分层。”",
  ])("keeps an explicit citation when unrelated nearby text is negative: %s", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [hierarchy]))
      .toEqual(["information-hierarchy"]);
  });

  it("does not choose between injected candidates with the same full or base title", () => {
    const duplicateBase = knowledge("hierarchy-copy", "信息层级与页序（本地设计说明）");
    const duplicateFull = knowledge("hierarchy-exact-copy", "信息层级与页序（课程设计）");
    expect(knowledgeIdsExplicitlyMentioned(
      "根据《信息层级与页序》安排页序。",
      [hierarchy, duplicateBase],
    )).toEqual([]);
    expect(knowledgeIdsExplicitlyMentioned(
      "依据《信息层级与页序（课程设计）》安排页序。",
      [hierarchy, duplicateFull],
    )).toEqual([]);
    expect(knowledgeIdsExplicitlyMentioned(
      "根据《信息层级与页序》安排页序。",
      [hierarchy, knowledge("hierarchy-short", "信息层级与页序")],
    )).toEqual([]);
  });

  it.each([
    "参考信息层级与页序（课程设计）扩展版来安排页序。",
    "新版信息层级与页序（课程设计）指出先分层。",
    "我参考了信息层级与页序（课程设计）扩展版。",
    "我参考信息层级与页序（课程设计）：扩展版来安排页序。",
    "我参考信息层级与页序（课程设计） （修订版）来安排页序。",
    "我参考信息层级与页序（课程设计）：教师版来安排页序。",
  ])("does not infer an unquoted title from a longer Chinese title", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [hierarchy])).toEqual([]);
  });

  it.each([
    "我参考了 信息层级与页序（课程设计） 里的方法。",
    "我参考信息层级与页序（课程设计）：先分层，再排页。",
    "我参考信息层级与页序（课程设计） 来安排页序。",
    "我依据课程资料信息层级与页序（课程设计）来安排页序。",
  ])("recognizes natural boundaries around an unquoted complete Chinese title: %s", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [hierarchy]))
      .toEqual(["information-hierarchy"]);
  });

  it("recognizes natural whitespace around an unquoted complete English title", () => {
    const official = knowledge("getting-started", "Getting started（Derivative官方文档）");
    expect(knowledgeIdsExplicitlyMentioned(
      "根据 Getting started（Derivative官方文档） 先核对步骤。",
      [official],
    )).toEqual(["getting-started"]);
  });

  it.each([
    "根据“版面证据与阅读测试（课程设计）”检查结果。",
    "根据 **版面证据与阅读测试** 检查结果。",
  ])("does not confuse attribution words inside an exact formatted title: %s", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [readingTest]))
      .toEqual(["layout-evidence"]);
  });

  it("recognizes an exact formatted title even when the title contains action words", () => {
    const actionTitle = knowledge(
      "printer-marks",
      "印刷标记应按输出流程和印厂要求选择（课程设计）",
    );
    expect(knowledgeIdsExplicitlyMentioned(
      "根据“印刷标记应按输出流程和印厂要求选择（课程设计）”核对输出。",
      [actionTitle],
    )).toEqual(["printer-marks"]);
  });

  it("keeps an explicitly introduced source blockquote", () => {
    expect(knowledgeIdsExplicitlyMentioned(
      "依据如下：\n> 根据《信息层级与页序》先分层。",
      [hierarchy],
    )).toEqual(["information-hierarchy"]);
  });

  it.each([
    "课程依据如下：\n> 根据《信息层级与页序》先分层。",
    "参考资料如下：\n> 《信息层级与页序》中指出先分层。",
    "引用资料如下：\n> 《信息层级与页序》中指出先分层。",
    "参考文献如下：\n> 《信息层级与页序》中指出先分层。",
    "- 参考文献如下：\n  > 《信息层级与页序》中指出先分层。",
  ])("keeps a naturally introduced source blockquote: %s", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [hierarchy]))
      .toEqual(["information-hierarchy"]);
  });

  it("does not let an example header cross a blank paragraph boundary", () => {
    expect(knowledgeIdsExplicitlyMentioned(
      "错误示范：\n\n实际答案中，我参考《信息层级与页序》重新分层。",
      [hierarchy],
    )).toEqual(["information-hierarchy"]);
  });

  it.each([
    "根据 ***信息层级与页序*** 安排页序。",
    "根据 *信息层级与页序* 安排页序。",
  ])("recognizes an exact title with CommonMark emphasis: %s", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [hierarchy]))
      .toEqual(["information-hierarchy"]);
  });

  it("ends a lazy blockquote before a Markdown heading", () => {
    expect(knowledgeIdsExplicitlyMentioned(
      "> 学生原话：我参考《信息层级与页序》。\n### 正确答案\n我根据《信息层级与页序》重新分层。",
      [hierarchy],
    )).toEqual(["information-hierarchy"]);
  });

  it.each([
    "错误示范：\n根据《信息层级与页序》安排页序。\n### 正确答案\n我根据《信息层级与页序》重新分层。",
    "> 学生原话：我参考《信息层级与页序》。\n- 正确答案：我根据《信息层级与页序》重新分层。",
    "错误示范：\n```text\n根据《信息层级与页序》安排页序。\n```\n实际答案中，我参考《信息层级与页序》重新分层。",
    "> 学生原话：我参考《信息层级与页序》。\n```text\n示例\n```\n实际答案中，我参考《信息层级与页序》重新分层。",
    "错误示范：\n根据《信息层级与页序》安排页序。\n---\n实际答案中，我参考《信息层级与页序》重新分层。",
  ])("ends inactive prose at a new Markdown block: %s", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [hierarchy]))
      .toEqual(["information-hierarchy"]);
  });

  it.each([
    "~~~text\n根据《信息层级与页序》安排页序。",
    "\t根据《信息层级与页序》安排页序。",
    "<!-- 根据《信息层级与页序》安排页序。",
    "<code>根据《信息层级与页序》安排页序。</code>",
    "<del>根据《信息层级与页序》安排页序。</del>",
  ])("ignores inactive Markdown or HTML content: %s", (answer) => {
    expect(knowledgeIdsExplicitlyMentioned(answer, [hierarchy])).toEqual([]);
  });

  it("returns only injected candidate ids even when the answer names another source", () => {
    expect(knowledgeIdsExplicitlyMentioned(
      "我参考《信息层级与页序（课程设计）》，也提到了《版式节奏与留白》。",
      [hierarchy],
    )).toEqual(["information-hierarchy"]);
  });
});

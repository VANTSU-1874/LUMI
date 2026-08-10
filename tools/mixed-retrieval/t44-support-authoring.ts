import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";

export const T44_SUPPORT_DEV_VERSION = "2026-07-28.1";
export const T44_SUPPORT_RUNTIME_ID =
  "lumi-t44-support-dev-runtime";
export const T44_SUPPORT_QRELS_ID =
  "lumi-t44-support-dev-qrels";
export const T44_SUPPORT_CORPUS_BUNDLE_SHA256 =
  "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8";

export const T44_SUPPORT_COURSE_PACK_IDS = [
  "general-design",
  "digital-interaction",
  "book-design",
  "layout-design",
  "brand-vi-design",
] as const;

export const T44_SUPPORT_STRATA = [
  "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
  "ANSWERABLE_PARAPHRASE_ALIAS",
  "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
  "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
  "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
] as const;

export type T44SupportCoursePackId =
  (typeof T44_SUPPORT_COURSE_PACK_IDS)[number];
export type T44SupportStratum =
  (typeof T44_SUPPORT_STRATA)[number];

type EvidenceRef = {
  objectId: string;
  statementId: string;
};

type EvidenceGroupSpec = {
  groupId: string;
  refs: readonly EvidenceRef[];
};

type T44SupportCaseSpec = {
  caseId: string;
  coursePackId: T44SupportCoursePackId;
  question: string;
  stratum: T44SupportStratum;
  multiClaim: boolean;
  groups: readonly EvidenceGroupSpec[];
  hardNegatives: readonly EvidenceRef[];
};

const ref = (
  objectId: string,
  statementId: string,
): EvidenceRef => ({ objectId, statementId });

const group = (
  groupId: string,
  ...refs: EvidenceRef[]
): EvidenceGroupSpec => ({ groupId, refs });

const CASE_SPECS: readonly T44SupportCaseSpec[] = [
  {
    caseId: "t44-support-general-p1a",
    coursePackId: "general-design",
    question: "双钻做项目时，前面理解问题和后面验证方案分别在做什么？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("understand-problem", ref("design-double-diamond", "design-discover-before-assume")),
      group("test-solution", ref("design-double-diamond", "design-deliver-small-tests")),
    ],
    hardNegatives: [
      ref("design-double-diamond", "design-double-diamond-stages"),
    ],
  },
  {
    caseId: "t44-support-general-p1b",
    coursePackId: "general-design",
    question: "项目简报总写得很空，我应该先把哪几件事说清楚？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("brief-aspects", ref("design-project-brief", "design-brief-eight-aspects")),
    ],
    hardNegatives: [
      ref("design-project-brief", "design-brief-not-form"),
    ],
  },
  {
    caseId: "t44-support-general-p2a",
    coursePackId: "general-design",
    question: "只靠颜色区分状态不太稳，还能加什么线索？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("color-not-alone", ref("design-color-redundancy", "design-color-not-alone")),
      group("redundant-cues", ref("design-color-redundancy", "design-color-additional-cue")),
    ],
    hardNegatives: [
      ref("design-nontext-contrast", "design-nontext-three-to-one"),
    ],
  },
  {
    caseId: "t44-support-general-p2b",
    coursePackId: "general-design",
    question: "两个关键图形快黏在一起了，怎么检查它们的明暗差别？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("nontext-threshold", ref("design-nontext-contrast", "design-nontext-three-to-one")),
      group("measure-control", ref("design-nontext-contrast", "design-measure-control-contrast")),
    ],
    hardNegatives: [
      ref("design-text-contrast", "design-text-contrast-normal"),
    ],
  },
  {
    caseId: "t44-support-general-p3a",
    coursePackId: "general-design",
    question: "有了一个想法后，怎样先做小样，再用观察结果决定改哪里？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("small-prototype", ref("design-prototype-test", "design-prototype-small-scale")),
      group("observation-plan", ref("design-prototype-test", "design-test-assumption")),
    ],
    hardNegatives: [
      ref("design-double-diamond", "design-double-diamond-stages"),
    ],
  },
  {
    caseId: "t44-support-general-p3b",
    coursePackId: "general-design",
    question: "正文又挤又不醒目时，字距适应性和文字对比各自要检查什么？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("spacing-adaptability", ref("design-text-spacing", "design-test-spacing-override")),
      group("text-contrast", ref("design-text-contrast", "design-measure-text-contrast")),
    ],
    hardNegatives: [
      ref("design-nontext-contrast", "design-measure-control-contrast"),
    ],
  },
  {
    caseId: "t44-support-general-p4a",
    coursePackId: "general-design",
    question: "状态反馈做得很热闹却让人更迷糊，判断重点是什么？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("status-purpose", ref("design-status-feedback", "design-status-message-purpose")),
      group("required-state", ref("design-status-feedback", "design-clarify-goal")),
    ],
    hardNegatives: [
      ref("design-status-feedback", "design-status-programmatic"),
    ],
  },
  {
    caseId: "t44-support-general-p4b",
    coursePackId: "general-design",
    question: "Illustrator 里的文字格式怎样复用，才不会每段都重新调？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("record-format", ref("illustrator-001-grid-guides-and-format-reuse", "design-illustrator-001-fact-04")),
      group("apply-and-compare", ref("illustrator-001-grid-guides-and-format-reuse", "design-illustrator-001-action-05")),
    ],
    hardNegatives: [
      ref("illustrator-001-grid-guides-and-format-reuse", "design-illustrator-001-fact-02"),
    ],
  },
  {
    caseId: "t44-support-general-p5a",
    coursePackId: "general-design",
    question: "参考线都对齐了，为什么还要抽查新段落的实际阅读效果？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("reading-check", ref("illustrator-001-grid-guides-and-format-reuse", "design-illustrator-001-fact-05")),
    ],
    hardNegatives: [
      ref("illustrator-001-grid-guides-and-format-reuse", "design-illustrator-001-fact-02"),
    ],
  },
  {
    caseId: "t44-support-general-p5b",
    coursePackId: "general-design",
    question: "交互反馈不能只做动画的话，还要让使用者确认什么？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("operation-result", ref("design-status-feedback", "design-status-message-purpose")),
    ],
    hardNegatives: [
      ref("design-color-redundancy", "design-add-redundant-cue"),
    ],
  },
  {
    caseId: "t44-support-digital-p1a",
    coursePackId: "digital-interaction",
    question: "DigiShow 的连续值、开关和音符信号应该怎么区分？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("signal-types", ref("digishow-signals", "digishow-signal-types")),
      group("identify-signal", ref("digishow-signals", "digishow-identify-signal")),
    ],
    hardNegatives: [
      ref("digishow-lighting-midi", "digishow-midi-topics"),
    ],
  },
  {
    caseId: "t44-support-digital-p1b",
    coursePackId: "digital-interaction",
    question: "OSC Out CHOP 发不出去时，第一轮排查从哪儿开始？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("sender-check", ref("osc-out-chop", "osc-check-sender")),
      group("receiver-check", ref("osc-out-chop", "osc-check-receiver")),
    ],
    hardNegatives: [
      ref("osc-out-chop", "osc-out-localhost"),
    ],
  },
  {
    caseId: "t44-support-digital-p2a",
    coursePackId: "digital-interaction",
    question: "声音一大画面就乱跳，怎样先把输入变得平稳一点？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("filter-principle", ref("td-filter-chop", "td-filter-neighbors")),
      group("compare-smoothing", ref("td-filter-chop", "td-compare-filter-trail")),
    ],
    hardNegatives: [
      ref("td-analyze-chop", "td-analyze-rms"),
    ],
  },
  {
    caseId: "t44-support-digital-p2b",
    coursePackId: "digital-interaction",
    question: "画面拖影一层层糊住了，反馈回路里应该先改哪类关系？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("feedback-target", ref("td-feedback-top", "td-feedback-target")),
      group("minimal-reset-test", ref("td-feedback-top", "td-test-feedback-reset")),
    ],
    hardNegatives: [
      ref("touchdesigner-foundations", "td-top-images"),
    ],
  },
  {
    caseId: "t44-support-digital-p3a",
    coursePackId: "digital-interaction",
    question: "从传感器输入到灯光输出，怎样把映射和协议两段一起排查？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("protocol-evidence", ref("dicd-001-signal-chain-troubleshooting", "digishow-dicd-001-action-02")),
      group("mapping-endpoint", ref("digishow-lighting-midi", "digishow-test-one-endpoint")),
    ],
    hardNegatives: [
      ref("digishow-lighting-midi", "digishow-lighting-topics"),
    ],
  },
  {
    caseId: "t44-support-digital-p3b",
    coursePackId: "digital-interaction",
    question: "互动方案想换一个场地测试，哪些条件要保持，哪些条件可以只改一个？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("change-boundary", ref("dicd-004-change-one-condition-for-transfer", "course-dicd-004-fact-01")),
      group("preserve-replace-verify", ref("dicd-004-change-one-condition-for-transfer", "course-dicd-004-action-03")),
    ],
    hardNegatives: [
      ref("course-four-stage-progression", "course-stage-four-project"),
    ],
  },
  {
    caseId: "t44-support-digital-p4a",
    coursePackId: "digital-interaction",
    question: "节点都在工作但互动还是没反应，为什么不能只看最后输出？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("layered-observation", ref("audio-reactive-visual", "td-audio-debug-layers")),
      group("evidence-chain", ref("dicd-001-signal-chain-troubleshooting", "digishow-dicd-001-action-02")),
    ],
    hardNegatives: [
      ref("touchdesigner-foundations", "td-top-images"),
    ],
  },
  {
    caseId: "t44-support-digital-p4b",
    coursePackId: "digital-interaction",
    question: "MIDI Note 和 MIDI CC 都能进来时，映射前要先确认什么？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("midi-entry", ref("digishow-lighting-midi", "digishow-midi-topics")),
      group("midi-signal-role", ref("digishow-lighting-midi", "digishow-identify-signal")),
    ],
    hardNegatives: [
      ref("digishow-signals", "digishow-signal-types"),
    ],
  },
  {
    caseId: "t44-support-digital-p5a",
    coursePackId: "digital-interaction",
    question: "互动界面的版面很整齐，但状态变化还是看不懂，问题可能在哪？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("experience-feedback", ref("dicd-002-interaction-scheme-six-clarifications", "course-dicd-002-fact-03")),
      group("behavior-response", ref("dicd-002-interaction-scheme-six-clarifications", "course-dicd-002-action-01")),
    ],
    hardNegatives: [
      ref("course-principles", "course-six-elements"),
    ],
  },
  {
    caseId: "t44-support-digital-p5b",
    coursePackId: "digital-interaction",
    question: "TOP 和 CHOP 名字很像时，怎样先按数据角色判断该看哪个？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("chop-role", ref("touchdesigner-foundations", "td-chop-channels")),
      group("top-role", ref("touchdesigner-foundations", "td-top-images")),
    ],
    hardNegatives: [
      ref("touchdesigner-foundations", "td-operator-flow"),
    ],
  },
  {
    caseId: "t44-support-book-p1a",
    coursePackId: "book-design",
    question: "出血线和最终裁切边界到底是什么关系？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("bleed-trim-relation", ref("book-bleed-output", "book-bleed-prevents-gaps")),
    ],
    hardNegatives: [
      ref("book-bleed-output", "book-slug-purpose"),
    ],
  },
  {
    caseId: "t44-support-book-p1b",
    coursePackId: "book-design",
    question: "图片链接丢失时，交付印刷前应该先检查什么？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("missing-link-risk", ref("book-linked-assets", "book-links-missing-risk")),
      group("link-preflight", ref("book-linked-assets", "book-preflight-links")),
    ],
    hardNegatives: [
      ref("book-linked-assets", "book-links-info"),
    ],
  },
  {
    caseId: "t44-support-book-p2a",
    coursePackId: "book-design",
    question: "正文贴边不是加边距的话，哪些画面才需要延伸出去？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("edge-object-bleed", ref("book-bleed-output", "book-bleed-prevents-gaps")),
      group("check-edge-images", ref("book-bleed-output", "book-check-print-bleed")),
    ],
    hardNegatives: [
      ref("book-bleed-output", "book-slug-purpose"),
    ],
  },
  {
    caseId: "t44-support-book-p2b",
    coursePackId: "book-design",
    question: "字母看着忽松忽紧，应该先分清字偶距还是整体字距吗？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("kerning-tracking", ref("book-kerning-tracking", "book-kerning-pairs")),
      group("adjust-by-scope", ref("book-kerning-tracking", "book-adjust-spacing-by-scope")),
    ],
    hardNegatives: [
      ref("book-kerning-tracking", "book-kerning-metrics-optical"),
    ],
  },
  {
    caseId: "t44-support-book-p3a",
    coursePackId: "book-design",
    question: "做跨页图时，怎样同时检查出血和装订影响？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("cross-page-bleed", ref("book-bleed-output", "book-bleed-prevents-gaps")),
      group("binding-purpose", ref("book-001-book-as-complete-system", "book-book-001-action-02")),
    ],
    hardNegatives: [
      ref("book-001-book-as-complete-system", "book-book-001-fact-01"),
    ],
  },
  {
    caseId: "t44-support-book-p3b",
    coursePackId: "book-design",
    question: "目录页既要对齐又要分层，Layout Grid 和信息层级怎么配合？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("layout-grid-role", ref("book-layout-grid", "layout-grid-typographic-control")),
      group("information-levels", ref("information-hierarchy", "hierarchy-three-levels")),
    ],
    hardNegatives: [
      ref("book-document-grid", "layout-document-grid-nonprinting"),
    ],
  },
  {
    caseId: "t44-support-book-p4a",
    coursePackId: "book-design",
    question: "页面看起来很整齐却不方便读，为什么网格不能代替阅读顺序？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("task-sequence", ref("information-hierarchy", "hierarchy-task-sequence")),
      group("reading-path-check", ref("book-document-grid", "layout-compare-reading-path")),
    ],
    hardNegatives: [
      ref("book-document-grid", "layout-document-grid-spacing"),
    ],
  },
  {
    caseId: "t44-support-book-p4b",
    coursePackId: "book-design",
    question: "Printer Marks 选得越多越安全吗，还是要按交付要求判断？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("provider-requirement", ref("book-printer-marks", "book-printer-provider-expects")),
      group("confirm-and-test", ref("book-printer-marks", "book-confirm-printer-marks")),
    ],
    hardNegatives: [
      ref("book-printer-marks", "book-printer-mark-types"),
    ],
  },
  {
    caseId: "t44-support-book-p5a",
    coursePackId: "book-design",
    question: "封面和内页都讲层级，它们在整本书里怎样保持一致？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("whole-book-rule", ref("book-001-book-as-complete-system", "book-book-001-fact-03")),
      group("repeated-relations", ref("book-001-book-as-complete-system", "book-book-001-action-01")),
    ],
    hardNegatives: [
      ref("book-001-book-as-complete-system", "book-book-001-fact-01"),
    ],
  },
  {
    caseId: "t44-support-book-p5b",
    coursePackId: "book-design",
    question: "Document Grid 和 Layout Grid 都叫网格，判断时先看什么任务？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("document-grid-role", ref("book-document-grid", "layout-document-grid-nonprinting")),
      group("layout-grid-role", ref("book-layout-grid", "layout-grid-typographic-control")),
    ],
    hardNegatives: [
      ref("book-layout-grid", "layout-grid-snap"),
    ],
  },
  {
    caseId: "t44-support-layout-p1a",
    coursePackId: "layout-design",
    question: "内容很多时，栅格和信息层级分别解决什么问题？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("grid-task", ref("layout-040-six-step-grid-layout-check", "layoutprin-layout-040-action-01")),
      group("hierarchy-order", ref("layout-001-grid-and-hierarchy", "layoutprin-layout-001-action-02")),
    ],
    hardNegatives: [
      ref("layout-001-grid-and-hierarchy", "layoutprin-layout-001-fact-03"),
    ],
  },
  {
    caseId: "t44-support-layout-p1b",
    coursePackId: "layout-design",
    question: "国际主义风格适合什么阅读任务，不能只看哪些表面特征？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("reading-task", ref("layout-010-international-style-fit", "layoutprin-clarify-reading-task")),
      group("not-template", ref("layout-010-international-style-fit", "layoutprin-layout-010-fact-06")),
    ],
    hardNegatives: [
      ref("layout-010-international-style-fit", "layoutprin-layout-010-action-03"),
    ],
  },
  {
    caseId: "t44-support-layout-p2a",
    coursePackId: "layout-design",
    question: "所有东西都对齐了还是没重点，应该先重新分哪几类信息？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("restore-contrast", ref("layout-001-grid-and-hierarchy", "layoutprin-layout-001-fact-01")),
      group("shared-alignment-path", ref("layout-001-grid-and-hierarchy", "layoutprin-layout-001-fact-02")),
    ],
    hardNegatives: [
      ref("layout-042-review-alignment-with-guides-hidden", "layout-layout-042-fact-01"),
    ],
  },
  {
    caseId: "t44-support-layout-p2b",
    coursePackId: "layout-design",
    question: "拼贴不是随便堆素材的话，画面关系要怎么建立？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("spatial-order", ref("layout-014-collage-style-fit", "layoutprin-layout-014-fact-01")),
      group("new-meaning", ref("layout-014-collage-style-fit", "layoutprin-layout-014-fact-05")),
    ],
    hardNegatives: [
      ref("layout-014-collage-style-fit", "layoutprin-layout-014-fact-03"),
    ],
  },
  {
    caseId: "t44-support-layout-p3a",
    coursePackId: "layout-design",
    question: "先分主要和次要信息后，怎样用栏位、间距和留白把阅读路线做出来？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("column-skeleton", ref("layout-040-six-step-grid-layout-check", "layoutprin-layout-040-action-03")),
      group("spacing-groups", ref("layout-002-type-hierarchy-and-whitespace", "type-layout-002-fact-02")),
      group("whitespace-boundary", ref("layout-002-type-hierarchy-and-whitespace", "type-layout-002-fact-03")),
    ],
    hardNegatives: [
      ref("layout-042-review-alignment-with-guides-hidden", "layout-layout-042-fact-01"),
    ],
  },
  {
    caseId: "t44-support-layout-p3b",
    coursePackId: "layout-design",
    question: "选设计书参考时，怎样一起核对版本、版权页和目录？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("edition-copyright-toc", ref("layout-050-select-design-books-by-learning-question", "layoutprin-layout-050-fact-02")),
      group("question-led-reading", ref("layout-050-select-design-books-by-learning-question", "layoutprin-layout-050-action-03")),
    ],
    hardNegatives: [
      ref("layout-050-select-design-books-by-learning-question", "layoutprin-layout-050-fact-01"),
    ],
  },
  {
    caseId: "t44-support-layout-p4a",
    coursePackId: "layout-design",
    question: "酸性风格很抢眼，但怎样判断它是不是只在装饰？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("decoration-to-theme", ref("layout-012-acid-style-fit", "layoutprin-layout-012-fact-04")),
      group("goal-and-feedback", ref("layout-012-acid-style-fit", "layoutprin-layout-012-fact-05")),
    ],
    hardNegatives: [
      ref("layout-012-acid-style-fit", "layoutprin-layout-012-fact-06"),
    ],
  },
  {
    caseId: "t44-support-layout-p4b",
    coursePackId: "layout-design",
    question: "留白很多不一定高级，应该回到什么阅读任务判断？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("whitespace-function", ref("layout-002-type-hierarchy-and-whitespace", "type-layout-002-fact-03")),
      group("inspect-information-groups", ref("layout-002-type-hierarchy-and-whitespace", "type-layout-002-action-01")),
    ],
    hardNegatives: [
      ref("layout-010-international-style-fit", "layoutprin-layout-010-fact-04"),
    ],
  },
  {
    caseId: "t44-support-layout-p5a",
    coursePackId: "layout-design",
    question: "页面也讲反馈的话，视觉层级怎样帮助读者找到下一步？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("ordered-information", ref("layout-001-grid-and-hierarchy", "layoutprin-layout-001-action-02")),
      group("reader-order-proof", ref("layout-041-review-layout-with-observable-evidence", "layout-compare-reading-path")),
    ],
    hardNegatives: [
      ref("layout-040-six-step-grid-layout-check", "layoutprin-layout-040-fact-04"),
    ],
  },
  {
    caseId: "t44-support-layout-p5b",
    coursePackId: "layout-design",
    question: "新中式和国际主义都能用网格时，选择依据应该落在哪？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("international-context", ref("layout-010-international-style-fit", "layoutprin-layout-010-fact-05")),
      group("neo-chinese-context", ref("layout-018-neo-chinese-style-fit", "layoutprin-layout-018-fact-01")),
    ],
    hardNegatives: [
      ref("layout-010-international-style-fit", "layoutprin-layout-010-fact-01"),
    ],
  },
  {
    caseId: "t44-support-brand-p1a",
    coursePackId: "brand-vi-design",
    question: "纯字体字标适合品牌时，最先要验证什么？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("position-and-application", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-01")),
      group("identity-task", ref("brandvi-001-assess-wordmark-fit", "brand-clarify-identity-task")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-action-01"),
    ],
  },
  {
    caseId: "t44-support-brand-p1b",
    coursePackId: "brand-vi-design",
    question: "字标单独用和图形加字标，怎样做一个公平比较？",
    stratum: "ANSWERABLE_SINGLE_PRIMARY_DIRECT",
    multiClaim: false,
    groups: [
      group("controlled-versions", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-action-03")),
      group("single-variable", ref("brandvi-002-test-wordmark-tone-and-audience", "brand-brandvi-002-fact-03")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-02"),
    ],
  },
  {
    caseId: "t44-support-brand-p2a",
    coursePackId: "brand-vi-design",
    question: "只用文字做标识不一定更高级，那我该看哪些真实表现？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("small-mono-output", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-02")),
      group("name-readability", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-03")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-01"),
    ],
  },
  {
    caseId: "t44-support-brand-p2b",
    coursePackId: "brand-vi-design",
    question: "这个字标感觉太冷，怎么判断是字形问题还是受众不合适？",
    stratum: "ANSWERABLE_PARAPHRASE_ALIAS",
    multiClaim: false,
    groups: [
      group("tone-to-variables", ref("brandvi-002-test-wordmark-tone-and-audience", "brand-brandvi-002-fact-01")),
      group("audience-evidence", ref("brandvi-002-test-wordmark-tone-and-audience", "brand-brandvi-002-fact-02")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-04"),
    ],
  },
  {
    caseId: "t44-support-brand-p3a",
    coursePackId: "brand-vi-design",
    question: "比较两个字标时，怎样一起记录识别、缩小清晰度和单色表现？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("small-mono", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-02")),
      group("name-recognition", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-03")),
      group("test-record", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-action-04")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-action-01"),
    ],
  },
  {
    caseId: "t44-support-brand-p3b",
    coursePackId: "brand-vi-design",
    question: "先做低保真版本后，怎样用同一名称、尺寸和位置比较？",
    stratum: "ANSWERABLE_MULTI_PRIMARY_COMPOSITION",
    multiClaim: true,
    groups: [
      group("one-variable", ref("brandvi-002-test-wordmark-tone-and-audience", "brand-brandvi-002-fact-03")),
      group("same-contact-point", ref("brandvi-002-test-wordmark-tone-and-audience", "brand-brandvi-002-action-04")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-04"),
    ],
  },
  {
    caseId: "t44-support-brand-p4a",
    coursePackId: "brand-vi-design",
    question: "品牌名很长时，纯字标看着简洁就一定合适吗？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("identity-task", ref("brandvi-001-assess-wordmark-fit", "brand-clarify-identity-task")),
      group("readable-name", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-03")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-01"),
    ],
  },
  {
    caseId: "t44-support-brand-p4b",
    coursePackId: "brand-vi-design",
    question: "包装上看着很醒目，为什么还要换到小尺寸和单色里测？",
    stratum: "ANSWERABLE_IN_PACK_HARD_DISTRACTOR",
    multiClaim: false,
    groups: [
      group("small-mono-output", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-02")),
      group("real-size-test", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-action-04")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-action-01"),
    ],
  },
  {
    caseId: "t44-support-brand-p5a",
    coursePackId: "brand-vi-design",
    question: "字标也有版式适配问题，横版和竖版应该怎么一起测？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("horizontal-vertical-test", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-action-02")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-02"),
    ],
  },
  {
    caseId: "t44-support-brand-p5b",
    coursePackId: "brand-vi-design",
    question: "标志缩小后仍清楚，和名称能不能被认出来是一回事吗？",
    stratum: "ANSWERABLE_CROSS_PACK_TERM_OVERLAP",
    multiClaim: false,
    groups: [
      group("name-readability", ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-03")),
      group("name-or-shape-task", ref("brandvi-001-assess-wordmark-fit", "brand-clarify-identity-task")),
    ],
    hardNegatives: [
      ref("brandvi-001-assess-wordmark-fit", "brand-brandvi-001-fact-02"),
    ],
  },
];

function resolveEvidenceRef(
  corpus: KnowledgeCorpusBundleV2,
  evidenceRef: EvidenceRef,
) {
  const object = corpus.objects.find(
    ({ id }) => id === evidenceRef.objectId,
  );
  if (!object) {
    throw new Error(
      `T44_SUPPORT_AUTHORING_OBJECT_MISSING:${evidenceRef.objectId}`,
    );
  }
  const node = object.nodes.find(
    (candidate) =>
      candidate.kind === "TEXT"
      && candidate.legacyStatementId === evidenceRef.statementId,
  );
  if (!node || node.kind !== "TEXT") {
    throw new Error(
      "T44_SUPPORT_AUTHORING_STATEMENT_MISSING:"
      + `${evidenceRef.objectId}:${evidenceRef.statementId}`,
    );
  }
  if (!["FACT", "ACTION"].includes(node.role)) {
    throw new Error(
      `T44_SUPPORT_AUTHORING_NODE_NOT_ATOMIC:${node.id}`,
    );
  }
  return node.id;
}

export function buildT44SupportDevArtifacts(
  corpusInput: unknown,
) {
  const corpus = verifyKnowledgeCorpusBundleV2(corpusInput);
  if (
    corpus.bundleHash !== T44_SUPPORT_CORPUS_BUNDLE_SHA256
  ) {
    throw new Error("T44_SUPPORT_AUTHORING_CORPUS_MISMATCH");
  }

  const runtimeWithoutHash = {
    schemaVersion: 1 as const,
    id: T44_SUPPORT_RUNTIME_ID,
    version: T44_SUPPORT_DEV_VERSION,
    split: "DEV" as const,
    corpusSnapshot: {
      path: "data/knowledge-v2/knowledge-corpus.v2.json",
      bundleHash: corpus.bundleHash,
    },
    cases: CASE_SPECS.map((testCase) => ({
      caseId: testCase.caseId,
      mode: "TEXT_TO_TEXT" as const,
      coursePackId: testCase.coursePackId,
      coursePackVersion: "1" as const,
      question: testCase.question,
    })),
  };
  const runtime = {
    ...runtimeWithoutHash,
    suiteHash: sha256StableJsonV2(runtimeWithoutHash),
  };

  const qrelsWithoutHash = {
    schemaVersion: 1 as const,
    id: T44_SUPPORT_QRELS_ID,
    version: T44_SUPPORT_DEV_VERSION,
    split: "DEV" as const,
    runtimeSuite: {
      id: runtime.id,
      version: runtime.version,
      suiteHash: runtime.suiteHash,
    },
    corpusSnapshot: runtime.corpusSnapshot,
    cases: CASE_SPECS.map((testCase) => ({
      caseId: testCase.caseId,
      stratum: testCase.stratum,
      multiClaim: testCase.multiClaim,
      requiredEvidenceGroups: testCase.groups.map(
        (evidenceGroup) => ({
          groupId: evidenceGroup.groupId,
          acceptableNodeIds: evidenceGroup.refs.map(
            (evidenceRef) =>
              resolveEvidenceRef(corpus, evidenceRef),
          ),
        }),
      ),
      hardNegativeNodeIds: testCase.hardNegatives.map(
        (evidenceRef) =>
          resolveEvidenceRef(corpus, evidenceRef),
      ),
    })),
  };
  const qrels = {
    ...qrelsWithoutHash,
    suiteHash: sha256StableJsonV2(qrelsWithoutHash),
  };

  return { runtime, qrels };
}

export function serializeT44SupportArtifact(
  artifact: unknown,
) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

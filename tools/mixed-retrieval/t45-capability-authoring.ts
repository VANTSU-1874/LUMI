import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
  type KnowledgeNodeV2,
  type KnowledgeObjectV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  T44_SUPPORT_QRELS_SUITE_SHA256,
  T44SupportQrelsSuiteSchema,
  t44SupportQrelsSuiteHash,
} from "./t44-support-loader";

export const T45_CAPABILITY_VERSION = "2026-07-29.1";
export const T45_CAPABILITY_CORPUS_BUNDLE_SHA256 =
  "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8";
export const T45_CAPABILITY_INVENTORY_ID =
  "lumi-t45-capability-inventory";

export const T45_CAPABILITY_STRATA = [
  "DIRECT_PARAPHRASE",
  "COMPOSITION_HARD_DISTRACTOR",
] as const;

export type T45CapabilitySplit =
  | "CALIBRATION"
  | "VALIDATION";
export type T45CapabilityPartition =
  | "FROZEN_T44"
  | "DEV_CAL"
  | "VALIDATION"
  | "VISUAL_RESERVE";
export type T45CapabilityStratum =
  (typeof T45_CAPABILITY_STRATA)[number];
export type T45CapabilityCoursePackId =
  | "general-design"
  | "digital-interaction"
  | "book-design"
  | "layout-design"
  | "brand-vi-design";

export type T45CapabilityInventoryObject = {
  objectId: string;
  coursePackId: string;
  objectContentHash: string;
  eligibleNodeIds: string[];
  capabilityFingerprint: string;
  familyId: string;
  partition: T45CapabilityPartition;
};

export type T45CapabilityInventoryFamily = {
  familyId: string;
  objectIds: string[];
  partition: T45CapabilityPartition;
};

export type T45CapabilityInventoryV1 = {
  schemaVersion: 1;
  id: "lumi-t45-capability-inventory";
  corpusBundleHash: string;
  fingerprintPolicy: {
    normalization: "NFKC_TRIM";
    projection: "KIND_ROLE_BODY_SORTED";
    hash: "SHA256";
  };
  objects: T45CapabilityInventoryObject[];
  families: T45CapabilityInventoryFamily[];
  inventoryHash: string;
};

export type T45CapabilityRuntimeCase = {
  caseId: string;
  familyId: string;
  stratum: T45CapabilityStratum;
  mode: "TEXT_TO_TEXT";
  coursePackId: T45CapabilityCoursePackId;
  coursePackVersion: "1";
  question: string;
};

export type T45RuntimeVisibleCase =
  T45CapabilityRuntimeCase;

export type T45CapabilityRuntimeSuite = {
  schemaVersion: 1;
  id:
    | "lumi-t45-capability-calibration-runtime"
    | "lumi-t45-capability-validation-runtime";
  version: string;
  split: T45CapabilitySplit;
  corpusSnapshot: {
    path: "data/knowledge-v2/knowledge-corpus.v2.json";
    bundleHash: string;
  };
  cases: T45CapabilityRuntimeCase[];
  suiteHash: string;
};

export type T45CapabilityEvidenceGroup = {
  groupId: string;
  acceptableNodeIds: string[];
};

export type T45CapabilityQrelsCase = {
  caseId: string;
  familyId: string;
  multiClaim: boolean;
  requiredEvidenceGroups: T45CapabilityEvidenceGroup[];
  hardNegativeNodeIds: string[];
};

export type T45CapabilityQrelsSuite = {
  schemaVersion: 1;
  id:
    | "lumi-t45-capability-calibration-qrels"
    | "lumi-t45-capability-validation-qrels";
  version: string;
  split: T45CapabilitySplit;
  runtimeSuite: {
    id: T45CapabilityRuntimeSuite["id"];
    version: string;
    suiteHash: string;
  };
  corpusSnapshot: {
    path: "data/knowledge-v2/knowledge-corpus.v2.json";
    bundleHash: string;
  };
  capabilityInventory: {
    id: "lumi-t45-capability-inventory";
    inventoryHash: string;
  };
  cases: T45CapabilityQrelsCase[];
  suiteHash: string;
};

type FamilyAssignment = {
  familyId: string;
  objectIds: readonly string[];
};

const CALIBRATION_FAMILIES: readonly FamilyAssignment[] = [
  {
    familyId: "book-microtask-principles",
    objectIds: ["book-design-principles"],
  },
  {
    familyId: "competition-direction-two-evidence",
    objectIds: ["competition-direction-two-evidence"],
  },
  {
    familyId: "digishow-touchdesigner-workflow",
    objectIds: [
      "dicd-003-digishow-touchdesigner-roles",
      "digishow-interface-workflow",
    ],
  },
  {
    familyId: "td-case-version-comparison",
    objectIds: ["td-case-version-comparison"],
  },
  {
    familyId: "osc-input-troubleshooting",
    objectIds: ["touchdesigner-osc-troubleshooting"],
  },
  {
    familyId: "international-style-history",
    objectIds: ["layout-011-international-style-history"],
  },
  {
    familyId: "acid-style-history",
    objectIds: ["layout-013-acid-style-history"],
  },
  {
    familyId: "collage-style-history",
    objectIds: ["layout-015-collage-style-history"],
  },
  {
    familyId: "neo-chinese-style-history",
    objectIds: ["layout-019-neo-chinese-style-history"],
  },
  {
    familyId: "reference-resource-selection",
    objectIds: [
      "layout-051-select-reference-resources-by-task",
    ],
  },
];

const VALIDATION_FAMILIES: readonly FamilyAssignment[] = [
  {
    familyId: "book-layout-reading-evidence",
    objectIds: ["layout-evidence"],
  },
  {
    familyId: "td-glsl-output-debugging",
    objectIds: ["td-glsl-top"],
  },
  {
    familyId: "td-math-channel-mapping",
    objectIds: ["td-math-chop"],
  },
  {
    familyId: "td-null-stable-reference",
    objectIds: ["td-null-chop"],
  },
  {
    familyId: "new-ugly-style",
    objectIds: [
      "layout-016-new-ugly-style-fit",
      "layout-017-new-ugly-style-history",
    ],
  },
  {
    familyId: "tactile-texture",
    objectIds: [
      "layout-022-tactile-texture-style-fit",
      "layout-023-tactile-texture-style-history",
    ],
  },
  {
    familyId: "retro-futurism",
    objectIds: ["layout-020-retro-futurism-style-fit"],
  },
  {
    familyId: "font-selection-context",
    objectIds: [
      "layout-030-font-trend-by-context",
      "layout-032-select-type-for-audience-purpose-and-medium",
    ],
  },
  {
    familyId: "type-image-color-coordination",
    objectIds: ["layout-031-coordinate-type-image-and-color"],
  },
  {
    familyId: "type-hierarchy-refinement",
    objectIds: [
      "layout-043-refine-spacing-weight-and-text-hierarchy",
    ],
  },
];

const POSTER_OBJECT_IDS = Array.from(
  { length: 50 },
  (_, index) => {
    const ordinal = index + 1;
    return `layout-${String(ordinal + 100)}-poster-${String(
      ordinal,
    ).padStart(2, "0")}-analysis`;
  },
);

type CaseSpec = {
  caseId: string;
  familyId: string;
  stratum: T45CapabilityStratum;
  question: string;
  groups: readonly (readonly string[])[];
  hardNegatives: readonly string[];
};

const caseSpec = (
  caseId: string,
  familyId: string,
  stratum: T45CapabilityStratum,
  question: string,
  groups: readonly (readonly string[])[],
  hardNegatives: readonly string[],
): CaseSpec => ({
  caseId,
  familyId,
  stratum,
  question,
  groups,
  hardNegatives,
});

const CALIBRATION_CASES: readonly CaseSpec[] = [
  caseSpec(
    "t45-cal-book-microtask-direct",
    "book-microtask-principles",
    "DIRECT_PARAPHRASE",
    "我这个小册子总是先排了再返工，开排之前最该先想清什么？",
    [["book-design-principles#book-audience-first"]],
    ["book-design-principles#book-eight-page-boundary"],
  ),
  caseSpec(
    "t45-cal-book-microtask-compose",
    "book-microtask-principles",
    "COMPOSITION_HARD_DISTRACTOR",
    "老师限定八页，我已经知道读者是谁了，接下来怎么把信息任务和页间顺序做出来？",
    [
      ["book-design-principles#book-eight-page-boundary"],
      ["book-design-principles#book-define-reading-goal"],
    ],
    ["book-design-principles#book-clarify-audience"],
  ),
  caseSpec(
    "t45-cal-competition-direct",
    "competition-direction-two-evidence",
    "DIRECT_PARAPHRASE",
    "方向二最后到底要交哪几样东西，别让我漏文件？",
    [
      "competition-direction-two-evidence#course-competition-deliverables",
    ].map((value) => [value]),
    [
      "competition-direction-two-evidence#course-competition-rubric",
    ],
  ),
  caseSpec(
    "t45-cal-competition-compose",
    "competition-direction-two-evidence",
    "COMPOSITION_HARD_DISTRACTOR",
    "我已经知道要交报告和视频了，汇报时怎么把功能对到评分关注点，别只讲功能多？主要评分维度又有哪些？",
    [
      [
        "competition-direction-two-evidence#course-competition-rubric",
      ],
      [
        "competition-direction-two-evidence#course-align-evidence-to-rubric",
      ],
    ],
    [
      "competition-direction-two-evidence#course-competition-deliverables",
    ],
  ),
  caseSpec(
    "t45-cal-digishow-workflow-direct",
    "digishow-touchdesigner-workflow",
    "DIRECT_PARAPHRASE",
    "我现在不知道是创意没想清，还是数据没进 TD，应该先怎么判断是哪类问题？",
    [[
      "dicd-003-digishow-touchdesigner-roles#digishow-identify-signal",
      "dicd-003-digishow-touchdesigner-roles#digishow-dicd-003-fact-04",
    ]],
    [
      "digishow-interface-workflow#digishow-interface-manager",
    ],
  ),
  caseSpec(
    "t45-cal-digishow-workflow-compose",
    "digishow-touchdesigner-workflow",
    "COMPOSITION_HARD_DISTRACTOR",
    "DigiShow 里数值在跳，TD 画面还是不动。我下一步要拿什么证据查哪一环，怎么避免越改越乱？",
    [
      [
        "dicd-003-digishow-touchdesigner-roles#digishow-dicd-003-action-01",
        "dicd-003-digishow-touchdesigner-roles#digishow-dicd-003-fact-02",
      ],
      [
        "dicd-003-digishow-touchdesigner-roles#digishow-dicd-003-fact-03",
        "dicd-003-digishow-touchdesigner-roles#digishow-dicd-003-action-04",
      ],
    ],
    ["digishow-interface-workflow#digishow-common-inputs"],
  ),
  caseSpec(
    "t45-cal-td-version-direct",
    "td-case-version-comparison",
    "DIRECT_PARAPHRASE",
    "我有两个 TD 工程版本，想找出到底改了哪里，第一步从哪儿对？",
    [[
      "td-case-version-comparison#td-case-structure-diff",
      "td-case-version-comparison#td-observe-upstream",
    ]],
    ["td-case-version-comparison#td-case-primary-backup"],
  ),
  caseSpec(
    "t45-cal-td-version-compose",
    "td-case-version-comparison",
    "COMPOSITION_HARD_DISTRACTOR",
    "节点差异表已经出来了，我能直接说这次修改让效果变好吗？还应该怎么验证它实际起了什么作用？",
    [
      ["td-case-version-comparison#td-case-diff-not-causation"],
      ["td-case-version-comparison#td-compare-case-versions"],
    ],
    ["td-case-version-comparison#td-case-primary-backup"],
  ),
  caseSpec(
    "t45-cal-osc-direct",
    "osc-input-troubleshooting",
    "DIRECT_PARAPHRASE",
    "OSC 发着呢，TD 这边没反应，我先核对什么最省事？",
    [[
      "touchdesigner-osc-troubleshooting#osc-compare-ports",
      "touchdesigner-osc-troubleshooting#osc-listening-port",
    ]],
    ["touchdesigner-osc-troubleshooting#osc-active-state"],
  ),
  caseSpec(
    "t45-cal-osc-compose",
    "osc-input-troubleshooting",
    "COMPOSITION_HARD_DISTRACTOR",
    "发送和监听端口已经核对一致，但还是没数据，接收节点里还要分哪两项看？",
    [
      ["touchdesigner-osc-troubleshooting#osc-active-state"],
      ["touchdesigner-osc-troubleshooting#osc-check-receiver"],
    ],
    ["touchdesigner-osc-troubleshooting#osc-listening-port"],
  ),
  caseSpec(
    "t45-cal-international-direct",
    "international-style-history",
    "DIRECT_PARAPHRASE",
    "我看到现在很多界面也用网格，就能说它们都是国际主义风格一路传下来的吗？",
    [[
      "layout-011-international-style-history#layoutprin-layout-011-fact-03",
    ]],
    [
      "layout-011-international-style-history#layoutprin-layout-011-fact-02",
    ],
  ),
  caseSpec(
    "t45-cal-international-compose",
    "international-style-history",
    "COMPOSITION_HARD_DISTRACTOR",
    "我在写国际主义风格这段历史，既想讲代表人物和年代，又想连到自己的版式，怎么避免拿几张看着像的图就当证据？",
    [
      [
        "layout-011-international-style-history#layoutprin-layout-011-fact-04",
        "layout-011-international-style-history#layoutprin-layout-011-action-01",
      ],
      [
        "layout-011-international-style-history#layoutprin-layout-011-action-02",
        "layout-011-international-style-history#layoutprin-layout-011-action-03",
      ],
    ],
    [
      "layout-011-international-style-history#layoutprin-layout-011-fact-02",
    ],
  ),
  caseSpec(
    "t45-cal-acid-direct",
    "acid-style-history",
    "DIRECT_PARAPHRASE",
    "我用了荧光渐变和液态金属，就可以直接说这是酸性风吗？",
    [[
      "layout-013-acid-style-history#layoutprin-layout-013-fact-03",
    ]],
    [
      "layout-013-acid-style-history#layoutprin-layout-013-fact-04",
    ],
  ),
  caseSpec(
    "t45-cal-acid-compose",
    "acid-style-history",
    "COMPOSITION_HARD_DISTRACTOR",
    "我想把六十年代迷幻、九十年代音乐传单和现在数字视觉串起来，怎么写才不会把它们说成一回事？",
    [
      [
        "layout-013-acid-style-history#layoutprin-layout-013-fact-02",
      ],
      [
        "layout-013-acid-style-history#layoutprin-layout-013-action-04",
        "layout-013-acid-style-history#layoutprin-layout-013-fact-01",
      ],
    ],
    [
      "layout-013-acid-style-history#layoutprin-layout-013-fact-03",
    ],
  ),
  caseSpec(
    "t45-cal-collage-direct",
    "collage-style-history",
    "DIRECT_PARAPHRASE",
    "作品放在屏幕上展示，就能算互动拼贴了吗？",
    [[
      "layout-015-collage-style-history#layoutprin-layout-015-fact-04",
    ]],
    [
      "layout-015-collage-style-history#layoutprin-layout-015-fact-02",
    ],
  ),
  caseSpec(
    "t45-cal-collage-compose",
    "collage-style-history",
    "COMPOSITION_HARD_DISTRACTOR",
    "我想比较手工拼贴和电脑拼贴，不能只说工具变了的话，应该比哪些关系？",
    [
      [
        "layout-015-collage-style-history#layoutprin-layout-015-fact-02",
      ],
      [
        "layout-015-collage-style-history#layoutprin-layout-015-action-03",
      ],
    ],
    [
      "layout-015-collage-style-history#layoutprin-layout-015-fact-04",
    ],
  ),
  caseSpec(
    "t45-cal-neo-chinese-direct",
    "neo-chinese-style-history",
    "DIRECT_PARAPHRASE",
    "我把传统纹样做成扁平矢量，就算完成新中式的文化转译了吗？",
    [[
      "layout-019-neo-chinese-style-history#layoutprin-layout-019-fact-02",
    ]],
    [
      "layout-019-neo-chinese-style-history#layoutprin-layout-019-fact-01",
    ],
  ),
  caseSpec(
    "t45-cal-neo-chinese-compose",
    "neo-chinese-style-history",
    "COMPOSITION_HARD_DISTRACTOR",
    "我不想只是贴几个传统符号，怎么做小样看出直接搬用、提炼和系统应用的区别，还要怎么判断“传统精神”不是空话？",
    [
      [
        "layout-019-neo-chinese-style-history#layoutprin-layout-019-action-03",
      ],
      [
        "layout-019-neo-chinese-style-history#layoutprin-layout-019-fact-04",
      ],
    ],
    [
      "layout-019-neo-chinese-style-history#layoutprin-layout-019-fact-01",
    ],
  ),
  caseSpec(
    "t45-cal-reference-direct",
    "reference-resource-selection",
    "DIRECT_PARAPHRASE",
    "我收藏了一堆好看的图，现在越看越乱，应该先按什么来筛？",
    [[
      "layout-051-select-reference-resources-by-task#layoutprin-layout-051-fact-01",
      "layout-051-select-reference-resources-by-task#layoutprin-clarify-reading-task",
    ]],
    [
      "layout-051-select-reference-resources-by-task#layoutprin-layout-051-fact-02",
    ],
  ),
  caseSpec(
    "t45-cal-reference-compose",
    "reference-resource-selection",
    "COMPOSITION_HARD_DISTRACTOR",
    "这张参考图我想拿来学配色和纹理，除了存图片还该记什么，怎么避免照搬以后说不清来源和使用条件？",
    [
      [
        "layout-051-select-reference-resources-by-task#layoutprin-layout-051-fact-02",
        "layout-051-select-reference-resources-by-task#layoutprin-layout-051-action-02",
      ],
      [
        "layout-051-select-reference-resources-by-task#layoutprin-layout-051-fact-03",
        "layout-051-select-reference-resources-by-task#layoutprin-layout-051-fact-05",
      ],
    ],
    [
      "layout-051-select-reference-resources-by-task#layoutprin-layout-051-fact-04",
    ],
  ),
];

const VALIDATION_CASES: readonly CaseSpec[] = [
  caseSpec(
    "t45-val-reading-evidence-direct",
    "book-layout-reading-evidence",
    "DIRECT_PARAPHRASE",
    "我改完版式只觉得顺眼了，怎么留下能说明这次改动有效的证据？",
    [["layout-evidence#layout-version-compare"]],
    ["layout-evidence#layout-reading-evidence"],
  ),
  caseSpec(
    "t45-val-reading-evidence-compose",
    "book-layout-reading-evidence",
    "COMPOSITION_HARD_DISTRACTOR",
    "我已经按单变量留了前后版，现在还想比较两种网格，并看读者能不能更快找到报名方式，应该控制什么、记录什么？",
    [
      ["layout-evidence#layout-compare-grid"],
      [
        "layout-evidence#layout-reading-evidence",
        "layout-evidence#layout-compare-reading-path",
      ],
    ],
    ["layout-evidence#layout-version-compare"],
  ),
  caseSpec(
    "t45-val-glsl-direct",
    "td-glsl-output-debugging",
    "DIRECT_PARAPHRASE",
    "GLSL TOP 黑屏了，我应该先去哪儿看第一条报错？",
    [[
      "td-glsl-top#td-glsl-info-dat",
      "td-glsl-top#td-read-glsl-errors",
    ]],
    ["td-glsl-top#td-glsl-renders-top"],
  ),
  caseSpec(
    "t45-val-glsl-compose",
    "td-glsl-output-debugging",
    "COMPOSITION_HARD_DISTRACTOR",
    "我想用 compute shader，但现在既可能是输入没准备好，也可能是版本不够，先怎么分开查？",
    [
      ["td-glsl-top#td-glsl-compute-version"],
      ["td-glsl-top#td-observe-upstream"],
    ],
    ["td-glsl-top#td-glsl-renders-top"],
  ),
  caseSpec(
    "t45-val-math-direct",
    "td-math-channel-mapping",
    "DIRECT_PARAPHRASE",
    "传感器值有变化，但映射到画面不是太弱就是爆掉，设 Range 前先看什么？",
    [["td-math-chop#td-observe-upstream"]],
    ["td-math-chop#td-math-combine"],
  ),
  caseSpec(
    "t45-val-math-compose",
    "td-math-channel-mapping",
    "COMPOSITION_HARD_DISTRACTOR",
    "我已经记下输入范围了，还要先把几个通道合成再映到目标范围，Math CHOP 里这两步怎么区分，顺序上要注意什么？",
    [
      ["td-math-chop#td-math-combine"],
      [
        "td-math-chop#td-math-order",
        "td-math-chop#td-math-range",
      ],
    ],
    ["td-math-chop#td-observe-upstream"],
  ),
  caseSpec(
    "t45-val-null-direct",
    "td-null-stable-reference",
    "DIRECT_PARAPHRASE",
    "为什么大家喜欢从 Null CHOP 往参数上拖，不直接引用前面的处理节点？",
    [["td-null-chop#td-null-export"]],
    ["td-null-chop#td-null-cook-options"],
  ),
  caseSpec(
    "t45-val-null-compose",
    "td-null-stable-reference",
    "COMPOSITION_HARD_DISTRACTOR",
    "我想让以后换上游节点也不用重做引用，应该怎么组织出口，同时先确认什么？",
    [
      ["td-null-chop#td-bind-from-null"],
      ["td-null-chop#td-observe-upstream"],
    ],
    ["td-null-chop#td-null-cook-options"],
  ),
  caseSpec(
    "t45-val-new-ugly-direct",
    "new-ugly-style",
    "DIRECT_PARAPHRASE",
    "我做的新丑风看起来像没排好，怎么判断它是故意的还是失误？",
    [[
      "layout-016-new-ugly-style-fit#layoutprin-layout-016-fact-01",
      "layout-016-new-ugly-style-fit#layoutprin-layout-016-action-04",
    ]],
    [
      "layout-017-new-ugly-style-history#layoutprin-layout-017-fact-01",
    ],
  ),
  caseSpec(
    "t45-val-new-ugly-compose",
    "new-ugly-style",
    "COMPOSITION_HARD_DISTRACTOR",
    "我想故意破坏对齐和字体，但又不想把信息读坏，做小样时应该保留什么、一次改几项？",
    [
      [
        "layout-016-new-ugly-style-fit#layoutprin-layout-016-fact-06",
      ],
      [
        "layout-016-new-ugly-style-fit#layoutprin-layout-016-action-03",
      ],
    ],
    [
      "layout-017-new-ugly-style-history#layoutprin-layout-017-fact-03",
    ],
  ),
  caseSpec(
    "t45-val-tactile-direct",
    "tactile-texture",
    "DIRECT_PARAPHRASE",
    "我给字叠了金属和果冻效果，为什么还是不像一种真的材质？",
    [[
      "layout-022-tactile-texture-style-fit#layoutprin-layout-022-fact-04",
      "layout-022-tactile-texture-style-fit#layoutprin-layout-022-fact-06",
    ]],
    [
      "layout-023-tactile-texture-style-history#layoutprin-layout-023-fact-01",
    ],
  ),
  caseSpec(
    "t45-val-tactile-compose",
    "tactile-texture",
    "COMPOSITION_HARD_DISTRACTOR",
    "我想做一种有触感的效果，怎样先把光源和材质规律做对，再让同伴判断它像不像？",
    [
      [
        "layout-022-tactile-texture-style-fit#layoutprin-layout-022-fact-03",
        "layout-022-tactile-texture-style-fit#layoutprin-layout-022-action-01",
      ],
      [
        "layout-022-tactile-texture-style-fit#layoutprin-layout-022-action-03",
        "layout-022-tactile-texture-style-fit#layoutprin-layout-022-fact-05",
      ],
    ],
    [
      "layout-023-tactile-texture-style-history#layoutprin-layout-023-fact-03",
    ],
  ),
  caseSpec(
    "t45-val-retro-direct",
    "retro-futurism",
    "DIRECT_PARAPHRASE",
    "我加了霓虹、金属和发光，就算复古未来风了吗？",
    [[
      "layout-020-retro-futurism-style-fit#layoutprin-layout-020-fact-03",
      "layout-020-retro-futurism-style-fit#layoutprin-layout-020-fact-06",
    ]],
    [
      "layout-020-retro-futurism-style-fit#layoutprin-layout-020-fact-02",
    ],
  ),
  caseSpec(
    "t45-val-retro-compose",
    "retro-futurism",
    "COMPOSITION_HARD_DISTRACTOR",
    "我想让画面有某个年代想象未来的感觉，又不想变成效果大杂烩，参考和小样应该怎么收敛？",
    [
      [
        "layout-020-retro-futurism-style-fit#layoutprin-clarify-reading-task",
      ],
      [
        "layout-020-retro-futurism-style-fit#layoutprin-layout-020-action-03",
      ],
    ],
    [
      "layout-020-retro-futurism-style-fit#layoutprin-layout-020-fact-03",
    ],
  ),
  caseSpec(
    "t45-val-font-context-direct",
    "font-selection-context",
    "DIRECT_PARAPHRASE",
    "这款字现在很火，我能直接拿来做手机封面吗？",
    [[
      "layout-030-font-trend-by-context#type-layout-030-fact-02",
      "layout-030-font-trend-by-context#type-clarify-text-role",
    ]],
    [
      "layout-032-select-type-for-audience-purpose-and-medium#type-layout-032-fact-01",
    ],
  ),
  caseSpec(
    "t45-val-font-context-compose",
    "font-selection-context",
    "COMPOSITION_HARD_DISTRACTOR",
    "同一款字做标题挺好看，我还想拿它排长文，应该在什么尺寸和阅读任务下分别怎么测？",
    [
      [
        "layout-032-select-type-for-audience-purpose-and-medium#type-layout-032-fact-02",
      ],
      [
        "layout-032-select-type-for-audience-purpose-and-medium#type-layout-032-action-02",
        "layout-032-select-type-for-audience-purpose-and-medium#type-layout-032-action-04",
      ],
    ],
    [
      "layout-030-font-trend-by-context#type-layout-030-fact-03",
    ],
  ),
  caseSpec(
    "t45-val-type-image-color-direct",
    "type-image-color-coordination",
    "DIRECT_PARAPHRASE",
    "我的标题、图片和亮色都很抢，第一眼不知道看哪儿，先怎么判断冲突？",
    [[
      "layout-031-coordinate-type-image-and-color#type-layout-031-fact-02",
      "layout-031-coordinate-type-image-and-color#type-clarify-text-role",
    ]],
    [
      "layout-031-coordinate-type-image-and-color#type-layout-031-fact-01",
    ],
  ),
  caseSpec(
    "t45-val-type-image-color-compose",
    "type-image-color-coordination",
    "COMPOSITION_HARD_DISTRACTOR",
    "我想重新排层级，不想一上来继续加字体和颜色，应该先做什么骨架，再按什么顺序加回图片和强调色？",
    [
      [
        "layout-031-coordinate-type-image-and-color#type-layout-031-fact-03",
        "layout-031-coordinate-type-image-and-color#type-layout-031-action-03",
      ],
      [
        "layout-031-coordinate-type-image-and-color#type-layout-031-action-04",
      ],
    ],
    [
      "layout-031-coordinate-type-image-and-color#type-layout-031-fact-04",
    ],
  ),
  caseSpec(
    "t45-val-type-hierarchy-direct",
    "type-hierarchy-refinement",
    "DIRECT_PARAPHRASE",
    "层级不清时，我先拉字距有用吗，还是应该先查别的？",
    [[
      "layout-043-refine-spacing-weight-and-text-hierarchy#layout-layout-043-fact-01",
    ]],
    [
      "layout-043-refine-spacing-weight-and-text-hierarchy#layout-layout-043-fact-03",
    ],
  ),
  caseSpec(
    "t45-val-type-hierarchy-compose",
    "type-hierarchy-refinement",
    "COMPOSITION_HARD_DISTRACTOR",
    "我想把字重和字距都调一下，怎么保存对照才知道是哪一个起作用，还要怎么检查颜色没在帮我作弊？",
    [
      [
        "layout-043-refine-spacing-weight-and-text-hierarchy#layout-layout-043-fact-04",
        "layout-043-refine-spacing-weight-and-text-hierarchy#layout-layout-043-action-03",
      ],
      [
        "layout-043-refine-spacing-weight-and-text-hierarchy#layout-layout-043-fact-02",
        "layout-043-refine-spacing-weight-and-text-hierarchy#layout-layout-043-action-04",
      ],
    ],
    [
      "layout-043-refine-spacing-weight-and-text-hierarchy#layout-layout-043-fact-05",
    ],
  ),
];

export function compareUnicodeCodePoints(
  left: string,
  right: string,
) {
  const leftPoints = Array.from(left, (value) =>
    value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) =>
    value.codePointAt(0)!);
  const sharedLength = Math.min(
    leftPoints.length,
    rightPoints.length,
  );
  for (let index = 0; index < sharedLength; index += 1) {
    const difference =
      leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export function isT45EligibleNode(
  node: KnowledgeNodeV2,
) {
  return node.kind === "TABLE"
    || (
      node.kind === "TEXT"
      && (node.role === "FACT" || node.role === "ACTION")
    );
}

export function t45CapabilityFingerprint(
  object: KnowledgeObjectV2,
) {
  const rows = object.nodes
    .filter(isT45EligibleNode)
    .map((node) => {
      if (node.kind === "TABLE") {
        return {
          kind: "TABLE",
          role: "TABLE",
          body: node.plainText.normalize("NFKC").trim(),
        };
      }
      if (node.kind !== "TEXT") {
        throw new Error(
          `T45_CAPABILITY_NODE_PROJECTION_INVALID:${node.id}`,
        );
      }
      return {
        kind: "TEXT",
        role: node.role,
        body: node.text.normalize("NFKC").trim(),
      };
    })
    .sort(
      (left, right) =>
        compareUnicodeCodePoints(left.kind, right.kind)
        || compareUnicodeCodePoints(left.role, right.role)
        || compareUnicodeCodePoints(left.body, right.body),
    );
  if (rows.length === 0) {
    throw new Error(
      `T45_CAPABILITY_OBJECT_HAS_NO_ELIGIBLE_NODES:${object.id}`,
    );
  }
  return sha256StableJsonV2(rows);
}

function addAssignment(
  assignments: Map<
    string,
    { familyId: string; partition: T45CapabilityPartition }
  >,
  objectId: string,
  familyId: string,
  partition: T45CapabilityPartition,
) {
  if (assignments.has(objectId)) {
    throw new Error(
      `T45_CAPABILITY_OBJECT_ASSIGNED_TWICE:${objectId}`,
    );
  }
  assignments.set(objectId, { familyId, partition });
}

function deriveFrozenT44ObjectIds(
  corpus: KnowledgeCorpusBundleV2,
  frozenT44QrelsInput: unknown,
) {
  const qrels = T44SupportQrelsSuiteSchema.parse(
    frozenT44QrelsInput,
  );
  const actualHash = t44SupportQrelsSuiteHash(qrels);
  if (
    qrels.suiteHash !== actualHash
    || qrels.suiteHash !== T44_SUPPORT_QRELS_SUITE_SHA256
  ) {
    throw new Error(
      `T45_CAPABILITY_FROZEN_T44_QRELS_MISMATCH:${actualHash}`,
    );
  }
  const ownerByNodeId = new Map(
    corpus.objects.flatMap((object) =>
      object.nodes.map((node) => [
        node.id,
        { objectId: object.id, node },
      ] as const)),
  );
  const ownerIds = new Set<string>();
  for (const testCase of qrels.cases) {
    const nodeIds = [
      ...testCase.requiredEvidenceGroups.flatMap(
        ({ acceptableNodeIds }) => acceptableNodeIds,
      ),
      ...testCase.hardNegativeNodeIds,
    ];
    for (const nodeId of nodeIds) {
      const owner = ownerByNodeId.get(nodeId);
      if (!owner) {
        throw new Error(
          `T45_CAPABILITY_FROZEN_T44_NODE_MISSING:${nodeId}`,
        );
      }
      if (!isT45EligibleNode(owner.node)) {
        throw new Error(
          `T45_CAPABILITY_FROZEN_T44_NODE_INELIGIBLE:${nodeId}`,
        );
      }
      ownerIds.add(owner.objectId);
    }
  }
  const result = [...ownerIds].sort(compareUnicodeCodePoints);
  if (result.length !== 42) {
    throw new Error(
      `T45_CAPABILITY_FROZEN_T44_COUNT_INVALID:${result.length}`,
    );
  }
  return result;
}

function buildInventory(
  corpus: KnowledgeCorpusBundleV2,
  frozenT44QrelsInput: unknown,
): T45CapabilityInventoryV1 {
  const frozenObjectIds = deriveFrozenT44ObjectIds(
    corpus,
    frozenT44QrelsInput,
  );
  const assignments = new Map<
    string,
    { familyId: string; partition: T45CapabilityPartition }
  >();
  for (const objectId of frozenObjectIds) {
    addAssignment(
      assignments,
      objectId,
      `frozen-t44-${objectId}`,
      "FROZEN_T44",
    );
  }
  for (const family of CALIBRATION_FAMILIES) {
    for (const objectId of family.objectIds) {
      addAssignment(
        assignments,
        objectId,
        family.familyId,
        "DEV_CAL",
      );
    }
  }
  for (const family of VALIDATION_FAMILIES) {
    for (const objectId of family.objectIds) {
      addAssignment(
        assignments,
        objectId,
        family.familyId,
        "VALIDATION",
      );
    }
  }
  for (const objectId of POSTER_OBJECT_IDS) {
    addAssignment(
      assignments,
      objectId,
      "poster-analysis-template",
      "VISUAL_RESERVE",
    );
  }

  const corpusObjectIds = new Set(
    corpus.objects.map(({ id }) => id),
  );
  for (const objectId of assignments.keys()) {
    if (!corpusObjectIds.has(objectId)) {
      throw new Error(
        `T45_CAPABILITY_ASSIGNED_OBJECT_MISSING:${objectId}`,
      );
    }
  }
  for (const object of corpus.objects) {
    if (!assignments.has(object.id)) {
      throw new Error(
        `T45_CAPABILITY_OBJECT_UNMAPPED:${object.id}`,
      );
    }
  }
  if (
    corpus.objects.length !== 116
    || assignments.size !== 116
  ) {
    throw new Error(
      "T45_CAPABILITY_CANONICAL_OBJECT_COUNT_INVALID",
    );
  }

  const objects = corpus.objects
    .map((object): T45CapabilityInventoryObject => {
      const assignment = assignments.get(object.id)!;
      return {
        objectId: object.id,
        coursePackId: object.sourceCoursePack.id,
        objectContentHash: object.contentHash,
        eligibleNodeIds: object.nodes
          .filter(isT45EligibleNode)
          .map(({ id }) => id)
          .sort(compareUnicodeCodePoints),
        capabilityFingerprint:
          t45CapabilityFingerprint(object),
        familyId: assignment.familyId,
        partition: assignment.partition,
      };
    })
    .sort((left, right) =>
      compareUnicodeCodePoints(
        left.objectId,
        right.objectId,
      ));

  const families: T45CapabilityInventoryFamily[] = [
    ...frozenObjectIds.map((objectId) => ({
      familyId: `frozen-t44-${objectId}`,
      objectIds: [objectId],
      partition: "FROZEN_T44" as const,
    })),
    ...CALIBRATION_FAMILIES.map((family) => ({
      familyId: family.familyId,
      objectIds: [...family.objectIds].sort(
        compareUnicodeCodePoints,
      ),
      partition: "DEV_CAL" as const,
    })),
    ...VALIDATION_FAMILIES.map((family) => ({
      familyId: family.familyId,
      objectIds: [...family.objectIds].sort(
        compareUnicodeCodePoints,
      ),
      partition: "VALIDATION" as const,
    })),
    {
      familyId: "poster-analysis-template",
      objectIds: [...POSTER_OBJECT_IDS].sort(
        compareUnicodeCodePoints,
      ),
      partition: "VISUAL_RESERVE",
    },
  ];

  const partitionByFingerprint = new Map<
    string,
    T45CapabilityPartition
  >();
  const partitionByFamily = new Map<
    string,
    T45CapabilityPartition
  >();
  for (const object of objects) {
    const fingerprintPartition =
      partitionByFingerprint.get(
        object.capabilityFingerprint,
      );
    if (
      fingerprintPartition
      && fingerprintPartition !== object.partition
    ) {
      throw new Error(
        "T45_CAPABILITY_FINGERPRINT_CROSSES_PARTITIONS:"
        + object.capabilityFingerprint,
      );
    }
    partitionByFingerprint.set(
      object.capabilityFingerprint,
      object.partition,
    );
    const familyPartition =
      partitionByFamily.get(object.familyId);
    if (
      familyPartition
      && familyPartition !== object.partition
    ) {
      throw new Error(
        `T45_CAPABILITY_FAMILY_CROSSES_PARTITIONS:${object.familyId}`,
      );
    }
    partitionByFamily.set(
      object.familyId,
      object.partition,
    );
  }

  const inventoryWithoutHash = {
    schemaVersion: 1 as const,
    id: T45_CAPABILITY_INVENTORY_ID as
      "lumi-t45-capability-inventory",
    corpusBundleHash: corpus.bundleHash,
    fingerprintPolicy: {
      normalization: "NFKC_TRIM" as const,
      projection: "KIND_ROLE_BODY_SORTED" as const,
      hash: "SHA256" as const,
    },
    objects,
    families,
  };
  return {
    ...inventoryWithoutHash,
    inventoryHash: sha256StableJsonV2(
      inventoryWithoutHash,
    ),
  };
}

function splitMetadata(split: T45CapabilitySplit) {
  if (split === "CALIBRATION") {
    return {
      runtimeId:
        "lumi-t45-capability-calibration-runtime" as const,
      qrelsId:
        "lumi-t45-capability-calibration-qrels" as const,
      partition: "DEV_CAL" as const,
      cases: CALIBRATION_CASES,
    };
  }
  return {
    runtimeId:
      "lumi-t45-capability-validation-runtime" as const,
    qrelsId:
      "lumi-t45-capability-validation-qrels" as const,
    partition: "VALIDATION" as const,
    cases: VALIDATION_CASES,
  };
}

function parseEvidenceRef(encoded: string) {
  const parts = encoded.split("#");
  if (
    parts.length !== 2
    || !parts[0]
    || !parts[1]
  ) {
    throw new Error(
      `T45_CAPABILITY_EVIDENCE_REF_INVALID:${encoded}`,
    );
  }
  return {
    objectId: parts[0],
    legacyStatementId: parts[1],
  };
}

function resolveEvidenceRef(
  corpus: KnowledgeCorpusBundleV2,
  encoded: string,
) {
  const evidenceRef = parseEvidenceRef(encoded);
  const object = corpus.objects.find(
    ({ id }) => id === evidenceRef.objectId,
  );
  if (!object) {
    throw new Error(
      `T45_CAPABILITY_EVIDENCE_OBJECT_MISSING:${evidenceRef.objectId}`,
    );
  }
  const matchingNodes = object.nodes.filter(
    (node) =>
      node.kind === "TEXT"
      && node.legacyStatementId
        === evidenceRef.legacyStatementId,
  );
  if (matchingNodes.length !== 1) {
    throw new Error(
      "T45_CAPABILITY_EVIDENCE_REF_NOT_EXACT:"
      + `${evidenceRef.objectId}#${evidenceRef.legacyStatementId}`,
    );
  }
  const node = matchingNodes[0]!;
  if (!isT45EligibleNode(node)) {
    throw new Error(
      `T45_CAPABILITY_EVIDENCE_NODE_INELIGIBLE:${node.id}`,
    );
  }
  return { object, node };
}

function buildSplitSuite(
  split: T45CapabilitySplit,
  corpus: KnowledgeCorpusBundleV2,
  inventory: T45CapabilityInventoryV1,
) {
  const metadata = splitMetadata(split);
  const inventoryByObjectId = new Map(
    inventory.objects.map((object) => [
      object.objectId,
      object,
    ]),
  );
  const courseByFamily = new Map<
    string,
    T45CapabilityCoursePackId
  >();
  for (const family of inventory.families.filter(
    ({ partition }) =>
      partition === metadata.partition,
  )) {
    const courses = new Set(
      family.objectIds.map((objectId) =>
        inventoryByObjectId.get(objectId)?.coursePackId),
    );
    if (
      courses.size !== 1
      || courses.has(undefined)
    ) {
      throw new Error(
        `T45_CAPABILITY_FAMILY_COURSE_AMBIGUOUS:${family.familyId}`,
      );
    }
    courseByFamily.set(
      family.familyId,
      [...courses][0] as T45CapabilityCoursePackId,
    );
  }

  const runtimeWithoutHash = {
    schemaVersion: 1 as const,
    id: metadata.runtimeId,
    version: T45_CAPABILITY_VERSION,
    split,
    corpusSnapshot: {
      path:
        "data/knowledge-v2/knowledge-corpus.v2.json" as const,
      bundleHash: corpus.bundleHash,
    },
    cases: metadata.cases.map(
      (testCase): T45CapabilityRuntimeCase => {
        const coursePackId = courseByFamily.get(
          testCase.familyId,
        );
        if (!coursePackId) {
          throw new Error(
            "T45_CAPABILITY_CASE_FAMILY_OUTSIDE_SPLIT:"
            + `${split}:${testCase.familyId}`,
          );
        }
        return {
          caseId: testCase.caseId,
          familyId: testCase.familyId,
          stratum: testCase.stratum,
          mode: "TEXT_TO_TEXT",
          coursePackId,
          coursePackVersion: "1",
          question: testCase.question,
        };
      },
    ),
  };
  const runtime: T45CapabilityRuntimeSuite = {
    ...runtimeWithoutHash,
    suiteHash: sha256StableJsonV2(runtimeWithoutHash),
  };

  const qrelsWithoutHash = {
    schemaVersion: 1 as const,
    id: metadata.qrelsId,
    version: T45_CAPABILITY_VERSION,
    split,
    runtimeSuite: {
      id: runtime.id,
      version: runtime.version,
      suiteHash: runtime.suiteHash,
    },
    corpusSnapshot: runtime.corpusSnapshot,
    capabilityInventory: {
      id: inventory.id,
      inventoryHash: inventory.inventoryHash,
    },
    cases: metadata.cases.map(
      (testCase): T45CapabilityQrelsCase => {
        const expectedCourse = courseByFamily.get(
          testCase.familyId,
        )!;
        const resolveAndAssert = (encoded: string) => {
          const resolved = resolveEvidenceRef(
            corpus,
            encoded,
          );
          const inventoryObject =
            inventoryByObjectId.get(resolved.object.id);
          if (
            !inventoryObject
            || inventoryObject.partition
              !== metadata.partition
            || inventoryObject.familyId
              !== testCase.familyId
            || inventoryObject.coursePackId
              !== expectedCourse
          ) {
            throw new Error(
              "T45_CAPABILITY_BLUEPRINT_EVIDENCE_SCOPE_INVALID:"
              + `${testCase.caseId}:${encoded}`,
            );
          }
          return resolved.node.id;
        };
        const requiredEvidenceGroups =
          testCase.groups.map((groupRefs, groupIndex) => ({
            groupId: `group-${groupIndex + 1}`,
            acceptableNodeIds:
              groupRefs.map(resolveAndAssert),
          }));
        const requiredNodeIds = new Set(
          requiredEvidenceGroups.flatMap(
            ({ acceptableNodeIds }) =>
              acceptableNodeIds,
          ),
        );
        const hardNegativeNodeIds =
          testCase.hardNegatives.map(resolveAndAssert);
        if (
          hardNegativeNodeIds.some((nodeId) =>
            requiredNodeIds.has(nodeId))
        ) {
          throw new Error(
            `T45_CAPABILITY_BLUEPRINT_HARD_NEGATIVE_REQUIRED:${testCase.caseId}`,
          );
        }
        return {
          caseId: testCase.caseId,
          familyId: testCase.familyId,
          multiClaim:
            testCase.stratum
            === "COMPOSITION_HARD_DISTRACTOR",
          requiredEvidenceGroups,
          hardNegativeNodeIds,
        };
      },
    ),
  };
  const qrels: T45CapabilityQrelsSuite = {
    ...qrelsWithoutHash,
    suiteHash: sha256StableJsonV2(qrelsWithoutHash),
  };
  return { runtime, qrels };
}

export function buildT45CapabilityArtifacts(input: {
  corpusInput: unknown;
  frozenT44QrelsInput: unknown;
}): {
  inventory: T45CapabilityInventoryV1;
  calibration: {
    runtime: T45CapabilityRuntimeSuite;
    qrels: T45CapabilityQrelsSuite;
  };
  validation: {
    runtime: T45CapabilityRuntimeSuite;
    qrels: T45CapabilityQrelsSuite;
  };
} {
  const corpus = verifyKnowledgeCorpusBundleV2(
    input.corpusInput,
  );
  if (
    corpus.bundleHash
    !== T45_CAPABILITY_CORPUS_BUNDLE_SHA256
  ) {
    throw new Error(
      "T45_CAPABILITY_AUTHORING_CORPUS_MISMATCH",
    );
  }
  const inventory = buildInventory(
    corpus,
    input.frozenT44QrelsInput,
  );
  return {
    inventory,
    calibration: buildSplitSuite(
      "CALIBRATION",
      corpus,
      inventory,
    ),
    validation: buildSplitSuite(
      "VALIDATION",
      corpus,
      inventory,
    ),
  };
}

export function serializeT45CapabilityArtifact(
  artifact: unknown,
) {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

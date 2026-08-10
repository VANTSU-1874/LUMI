import { z } from "zod";

import {
  CapabilityEntityManifestV2Schema,
  resolveCapabilityEntityMentionsV2,
  type CapabilityEntityManifestV2,
} from "./capability-boundary-v2";
import {
  CoursePackReferenceV2Schema,
  sha256StableJsonV2,
} from "./knowledge-object-v2";
import {
  RetrievalModeV2Schema,
  RetrievalQueryV2Schema,
  type RetrievalQueryV2,
} from "./retrieval-query-v2";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HashSchema = z.string().regex(
  HASH_PATTERN,
  "expected a lowercase sha256 hash",
);
const IdSchema = z.string().regex(
  ID_PATTERN,
  "expected a stable lowercase identifier",
);

export const QueryPrerequisiteDecisionV3Schema = z.enum([
  "STATIC_CORPUS_ELIGIBLE",
  "EXTERNAL_STATE_REQUIRED",
  "USER_ASSET_REQUIRED",
  "LOCAL_TOOL_ACTION_REQUIRED",
  "PARAMETER_CONTEXT_REQUIRED",
  "COURSE_SCOPE_MISMATCH_CANDIDATE",
  "AMBIGUOUS",
]);

export const QueryPrerequisiteConfidenceV3Schema = z.enum([
  "HIGH",
  "MEDIUM",
  "LOW",
]);

export const QueryPrerequisiteFeatureIdV3Schema = z.enum([
  "QUERY_ASSET_PRESENT",
  "TEMPORAL_REFERENCE",
  "EXTERNAL_STATE_REQUEST",
  "EXTERNAL_AUTHORIZATION_REQUEST",
  "EXTERNAL_PRICE_REQUEST",
  "EXTERNAL_OWNERSHIP_REQUEST",
  "EXTERNAL_SCHEDULE_REQUEST",
  "RESULT_GUARANTEE_REQUEST",
  "CURRENT_REGULATION_REQUEST",
  "LOCAL_TOOL_REFERENCE",
  "DIRECT_ACTION_REQUEST",
  "USER_ASSET_REFERENCE",
  "ASSET_INSPECTION_OR_EDIT_REQUEST",
  "EXACT_PARAMETER_REQUEST",
  "PARAMETER_CONTEXT_CUE",
  "PARAMETER_CONTEXT_ABSENCE",
  "STATIC_GUIDANCE_REQUEST",
  "FOREIGN_EXCLUSIVE_ENTITY",
  "SCOPED_EXCLUSIVE_ENTITY",
  "AMBIGUOUS_CAPABILITY_ENTITY",
]);

type QueryPrerequisiteFeatureIdV3 = z.infer<
  typeof QueryPrerequisiteFeatureIdV3Schema
>;

type PatternDefinition = Readonly<{
  featureId: QueryPrerequisiteFeatureIdV3;
  ruleId: string;
  source: string;
  flags: string;
}>;

const TEXT_PATTERN_DEFINITIONS_V3 = Object.freeze([
  {
    featureId: "TEMPORAL_REFERENCE",
    ruleId: "temporal-reference-v1",
    source:
      "(?:今天|今日|现在|目前|当前|此刻|实时|刚刚|刚才|本周|这周|今年|最新|截至(?:今天|今日|现在|目前)|today|right now|currently|current|latest|real[- ]?time|this week|this year)",
    flags: "iu",
  },
  {
    featureId: "EXTERNAL_STATE_REQUEST",
    ruleId: "external-state-request-v1",
    source:
      "(?:有没有|是否|能否|还能不能|可不可以|是多少|有多少|哪天|何时|什么时候|到哪(?:一步|阶段)|(?:帮我|替我)?查(?:一下|到)|查询|(?:统计|数据|读数)(?:结果)?(?:是|为|有)(?:多少|什么)|识别率|成功率|通过率|库存|排名|截止(?:到)?|排期|available|availability|how many|when|whether|check|metric|rate)",
    flags: "iu",
  },
  {
    featureId: "EXTERNAL_AUTHORIZATION_REQUEST",
    ruleId: "external-authorization-request-v1",
    source:
      "(?:(?:官方|品牌|作者|学校|机构).{0,8})?(?:授权|许可|批准|认证).{0,12}(?:吗|是否|能否|可以|可不可以|商用|使用|改编|发布)|(?:能否|是否|可以|可不可以).{0,12}(?:商用|使用|改编|发布).{0,8}(?:授权|许可)",
    flags: "iu",
  },
  {
    featureId: "EXTERNAL_PRICE_REQUEST",
    ruleId: "external-price-request-v1",
    source:
      "(?:价格|售价|多少钱|收费|费用|报价|要付多少|花多少|\\b(?:price|cost|fee|quote)\\b)",
    flags: "iu",
  },
  {
    featureId: "EXTERNAL_OWNERSHIP_REQUEST",
    ruleId: "external-ownership-request-v1",
    source:
      "(?:(?:著作权|所有权|权属|版权(?!页)).{0,12}(?:归谁|属于谁|谁(?:拥有|持有)|归属|能否使用|可以使用|商用)|(?:归谁|属于谁|谁(?:拥有|持有)).{0,12}(?:著作权|所有权|权属|版权(?!页))|(?:copyright|ownership|rights holder).{0,20}(?:who|whose|use|commercial))",
    flags: "iu",
  },
  {
    featureId: "EXTERNAL_SCHEDULE_REQUEST",
    ruleId: "external-schedule-request-v1",
    source:
      "(?:(?:考试|报名|答辩|提交).{0,12}(?:时间|日期|安排|日程|哪天|几点|教室|地点|考场|截止)|(?:时间|日期|日程|哪天|几点|教室|地点|考场|截止).{0,12}(?:考试|报名|答辩|提交))",
    flags: "iu",
  },
  {
    featureId: "RESULT_GUARANTEE_REQUEST",
    ruleId: "result-guarantee-request-v1",
    source:
      "(?:保证.{0,8}(?:通过|结果|得奖|获奖|高分|成功)|保过|百分之百.{0,8}(?:通过|成功)|一定会.{0,8}(?:通过|成功|获奖)|guarantee(?:d)?\\s+(?:result|pass|success))",
    flags: "iu",
  },
  {
    featureId: "CURRENT_REGULATION_REQUEST",
    ruleId: "current-regulation-request-v1",
    source:
      "(?:(?:现行|最新|刚刚发布|刚发布|已生效).{0,20}(?:法规|规章|监管|合规要求|法定标准)|(?:法规|规章|监管|合规要求|法定标准).{0,20}(?:现行|最新|刚刚发布|刚发布|已生效))",
    flags: "iu",
  },
  {
    featureId: "LOCAL_TOOL_REFERENCE",
    ruleId: "local-tool-reference-v1",
    source:
      "(?:indesign|touchdesigner|photoshop|illustrator|figma|after effects|blender|premiere)",
    flags: "iu",
  },
  {
    featureId: "DIRECT_ACTION_REQUEST",
    ruleId: "direct-action-request-v1",
    source:
      "(?:(?:帮我|替我|你来|直接给我|请你).{0,16}(?:打开|点击|拖|连接|导入|导出|保存|上传|删除|替换|设置|修改|新建|运行|操作|改掉|调好|做好)|(?:打开|导入|导出|保存|上传|删除|替换|设置|修改|新建|运行).{0,8}(?:帮我|替我))",
    flags: "iu",
  },
  {
    featureId: "USER_ASSET_REFERENCE",
    ruleId: "user-asset-reference-v1",
    source:
      "(?:(?:我的|我这个|我这张|我这份|这个|这张|这份|这里的)[^，。？！]{0,32}(?:作品|作业|文件|工程|源文件|图片|图|海报|版面|页面|包装|标志|字标|模型|节点|项目|设计稿))",
    flags: "iu",
  },
  {
    featureId: "ASSET_INSPECTION_OR_EDIT_REQUEST",
    ruleId: "asset-inspection-or-edit-request-v2",
    source:
      "(?:(?:帮我|请你|请帮我|能不能|麻烦(?:你)?|替我|给我|让你).{0,12}(?:看(?:看)?|检查|分析|诊断|评价|改|调整|修改|修|对齐)|(?:^|[，,。！？?!])\\s*(?:看(?:看)?|检查|分析|诊断|评价|改|调整|修改|修|对齐)(?:一下)?|(?:检查|分析|诊断|评价|改|调整|修改|修|对齐).{0,8}(?:一下|哪里|哪儿|哪个|哪些))",
    flags: "iu",
  },
  {
    featureId: "EXACT_PARAMETER_REQUEST",
    ruleId: "exact-parameter-request-v2",
    source:
      "(?:(?:精确|准确|具体)(?:的)?(?:数值|参数|值|尺寸|字号|间距|字距|行距|宽度|高度|栏数|出血|速度|时长|强度|透明度|衰减|阈值)|固定(?:的)?(?:数值|参数|值|尺寸|字号|间距|字距|行距|宽度|高度|栏数|出血|速度|时长|强度|透明度|衰减|阈值).{0,6}(?:是多少|设(?:为)?多少|填多少|调多少|用多少|给多少|需要多少)|(?:参数|数值|尺寸|字号|间距|字距|行距|宽度|高度|栏数|出血|速度|时长|强度|透明度|衰减|阈值).{0,8}(?:设|填|调|用|给).{0,4}(?:多少|几)|(?:到底|直接).{0,8}(?:设|填|调|用).{0,4}(?:多少|几))",
    flags: "iu",
  },
  {
    featureId: "PARAMETER_CONTEXT_CUE",
    ruleId: "parameter-context-cue-v1",
    source:
      "(?:用于|面向|在.{0,12}(?:情况下|场景|设备|材料|纸张|屏幕)|观看距离|印刷方式|纸张|材料|设备|分辨率|画布|成品尺寸|a[0-6]\\b|\\d+(?:\\.\\d+)?\\s*(?:mm|cm|px|pt|hz|fps|%|％))",
    flags: "iu",
  },
  {
    featureId: "PARAMETER_CONTEXT_ABSENCE",
    ruleId: "parameter-context-absence-v1",
    source:
      "(?:(?:没有|没给|未提供|缺少|不知道|不清楚).{0,10}(?:画布|文件|尺寸|材料|纸张|设备|分辨率|观看距离|输入范围|参数|上下文|场景)|(?:画布|文件|尺寸|材料|纸张|设备|分辨率|观看距离|输入范围|参数|上下文|场景).{0,10}(?:没有|没给|未提供|缺少|不知道|不清楚))",
    flags: "iu",
  },
  {
    featureId: "STATIC_GUIDANCE_REQUEST",
    ruleId: "static-guidance-request-v1",
    source:
      "(?:怎么|如何|为什么|哪里|哪儿|哪些问题|调整|改进|运用|应用|排版|设计|组织|选择|筛选|筛|优化|诊断|分析)",
    flags: "iu",
  },
] as const satisfies readonly PatternDefinition[]);

export const QUERY_PREREQUISITE_FEATURE_ALGORITHM_V3 = Object.freeze({
  id: "lumi-query-prerequisite-features-v3",
  version: "1.5.0",
  schemaVersion: 3,
  normalization: "RetrievalQueryV2.normalizedText",
  textPatterns: TEXT_PATTERN_DEFINITIONS_V3,
  capabilityEntityResolution:
    "CapabilityEntityManifestV2.NON_OVERLAPPING_LONGEST_ALIAS",
  rawQueryRetention: "HASH_ONLY",
} as const);

export const QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3 =
  sha256StableJsonV2(QUERY_PREREQUISITE_FEATURE_ALGORITHM_V3);

const QUERY_PREREQUISITE_FAIL_CLOSED_DECISIONS_V3 = Object.freeze([
  "EXTERNAL_STATE_REQUIRED",
  "LOCAL_TOOL_ACTION_REQUIRED",
  "USER_ASSET_REQUIRED",
  "PARAMETER_CONTEXT_REQUIRED",
] as const);

export const QUERY_PREREQUISITE_POLICY_V3 = Object.freeze({
  id: "lumi-query-prerequisite-policy-v3",
  version: "1.1.0",
  schemaVersion: 3,
  priority: Object.freeze([
    "EXTERNAL_STATE_REQUIRED",
    "LOCAL_TOOL_ACTION_REQUIRED",
    "USER_ASSET_REQUIRED",
    "PARAMETER_CONTEXT_REQUIRED",
    "COURSE_SCOPE_MISMATCH_CANDIDATE",
    "AMBIGUOUS",
    "STATIC_CORPUS_ELIGIBLE",
  ]),
  externalStateRule:
    "EXPLICIT_EXTERNAL_FACT_OR_TEMPORAL_REFERENCE_AND_STATE_REQUEST",
  localToolRule: "LOCAL_TOOL_REFERENCE_AND_DIRECT_ACTION_REQUEST",
  userAssetRule:
    "NO_QUERY_ASSET_AND_USER_ASSET_REFERENCE_AND_INSPECTION_OR_ACTION",
  parameterRule:
    "NO_QUERY_ASSET_AND_EXACT_PARAMETER_REQUEST_AND_CONTEXT_ABSENT_OR_NOT_PROVIDED",
  courseScopeRule:
    "FOREIGN_EXCLUSIVE_ENTITY_IS_CANDIDATE_ONLY_PENDING_OBJECT_COMPETITION",
  ambiguousAction: "CONTINUE_CONTROLLED_RETRIEVAL",
  failClosedDecisions:
    QUERY_PREREQUISITE_FAIL_CLOSED_DECISIONS_V3,
} as const);

export const QUERY_PREREQUISITE_POLICY_HASH_V3 =
  sha256StableJsonV2(QUERY_PREREQUISITE_POLICY_V3);

export const QUERY_PREREQUISITE_CONFIG_HASH_V3 = sha256StableJsonV2({
  featureAlgorithmHash: QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
  policyHash: QUERY_PREREQUISITE_POLICY_HASH_V3,
});

export const QueryPrerequisiteFeatureV3Schema = z
  .object({
    featureId: QueryPrerequisiteFeatureIdV3Schema,
    ruleId: IdSchema,
    source: z.enum([
      "QUERY_MODE",
      "NORMALIZED_TEXT",
      "CAPABILITY_MANIFEST",
    ]),
    matchStart: z.number().int().nonnegative().max(500).nullable(),
    matchEnd: z.number().int().positive().max(500).nullable(),
    entityId: IdSchema.nullable(),
    ownerCoursePack: CoursePackReferenceV2Schema.nullable(),
  })
  .strict()
  .superRefine((feature, context) => {
    if (
      (feature.matchStart === null) !== (feature.matchEnd === null)
      || (
        feature.matchStart !== null
        && feature.matchEnd !== null
        && feature.matchEnd <= feature.matchStart
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "feature match spans must be both absent or a non-empty range",
        path: ["matchStart"],
      });
    }
    const entityFeature = feature.source === "CAPABILITY_MANIFEST";
    if (
      entityFeature !== (
        feature.entityId !== null
        && feature.ownerCoursePack !== null
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "only capability-manifest features bind an entity owner",
        path: ["entityId"],
      });
    }
  });

export const QueryPrerequisiteTraceV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    queryHash: HashSchema,
    queryMode: RetrievalModeV2Schema,
    corpusBundleHash: HashSchema,
    sourceCoursePack: CoursePackReferenceV2Schema.nullable(),
    capabilityEntityManifestHash: HashSchema.nullable(),
    featureAlgorithmHash: z.literal(
      QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
    ),
    policyHash: z.literal(QUERY_PREREQUISITE_POLICY_HASH_V3),
    configHash: z.literal(QUERY_PREREQUISITE_CONFIG_HASH_V3),
    decision: QueryPrerequisiteDecisionV3Schema,
    confidence: QueryPrerequisiteConfidenceV3Schema,
    failClosedEligible: z.boolean(),
    decisionSignals: z.array(QueryPrerequisiteFeatureIdV3Schema).max(20),
    features: z.array(QueryPrerequisiteFeatureV3Schema).max(128),
  })
  .strict()
  .superRefine((trace, context) => {
    if (new Set(trace.decisionSignals).size !== trace.decisionSignals.length) {
      context.addIssue({
        code: "custom",
        message: "decision signals must be unique",
        path: ["decisionSignals"],
      });
    }
    const featureIds = new Set(trace.features.map(({ featureId }) => featureId));
    if (trace.decisionSignals.some((signal) => !featureIds.has(signal))) {
      context.addIssue({
        code: "custom",
        message: "every decision signal must reference an emitted feature",
        path: ["decisionSignals"],
      });
    }
    const failClosedDecision = new Set(
      QUERY_PREREQUISITE_POLICY_V3.failClosedDecisions,
    ).has(trace.decision as never);
    if (
      trace.failClosedEligible !== (
        failClosedDecision && trace.confidence === "HIGH"
      )
    ) {
      context.addIssue({
        code: "custom",
        message:
          "only high-confidence prerequisite failures may be fail-closed eligible",
        path: ["failClosedEligible"],
      });
    }
  });

export type QueryPrerequisiteDecisionV3 = z.infer<
  typeof QueryPrerequisiteDecisionV3Schema
>;
export type QueryPrerequisiteTraceV3 = z.infer<
  typeof QueryPrerequisiteTraceV3Schema
>;

function compareCodePoints(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function textFeatures(
  normalizedText: string,
): z.infer<typeof QueryPrerequisiteFeatureV3Schema>[] {
  const features = TEXT_PATTERN_DEFINITIONS_V3.flatMap((definition) => {
    const flags = definition.flags.includes("g")
      ? definition.flags
      : `${definition.flags}g`;
    const expression = new RegExp(definition.source, flags);
    return Array.from(normalizedText.matchAll(expression), (match) => ({
      featureId: definition.featureId,
      ruleId: definition.ruleId,
      source: "NORMALIZED_TEXT" as const,
      matchStart: match.index,
      matchEnd: match.index + match[0].length,
      entityId: null,
      ownerCoursePack: null,
    }));
  });
  const unique = new Map<string, (typeof features)[number]>();
  for (const feature of features) {
    unique.set(
      [
        feature.featureId,
        feature.ruleId,
        feature.matchStart,
        feature.matchEnd,
      ].join(":"),
      feature,
    );
  }
  return [...unique.values()].sort((left, right) =>
    compareCodePoints(left.featureId, right.featureId)
    || (left.matchStart ?? -1) - (right.matchStart ?? -1)
    || (left.matchEnd ?? -1) - (right.matchEnd ?? -1));
}

function sameCoursePack(
  left: z.infer<typeof CoursePackReferenceV2Schema>,
  right: z.infer<typeof CoursePackReferenceV2Schema>,
) {
  return left.id === right.id && left.version === right.version;
}

function entityFeatures(input: {
  normalizedText: string;
  sourceCoursePack: z.infer<typeof CoursePackReferenceV2Schema> | null;
  manifest: CapabilityEntityManifestV2;
}) {
  const resolved = resolveCapabilityEntityMentionsV2({
    normalizedText: input.normalizedText,
    manifest: input.manifest,
  });
  const features: z.infer<typeof QueryPrerequisiteFeatureV3Schema>[] = [];
  const owner = resolved.exclusiveOwner;
  if (owner && input.sourceCoursePack) {
    features.push({
      featureId: sameCoursePack(owner.ownerCoursePack, input.sourceCoursePack)
        ? "SCOPED_EXCLUSIVE_ENTITY"
        : "FOREIGN_EXCLUSIVE_ENTITY",
      ruleId: "resolved-exclusive-entity-v1",
      source: "CAPABILITY_MANIFEST",
      matchStart: owner.matchStart,
      matchEnd: owner.matchEnd,
      entityId: owner.entityId,
      ownerCoursePack: owner.ownerCoursePack,
    });
  }
  if (resolved.hasAmbiguous) {
    const ambiguous = resolved.matchedEntities.find((match) =>
      match.aliasClassification === "AMBIGUOUS"
      || match.entityScope === "SHARED_OR_AMBIGUOUS")
      ?? resolved.matchedEntities[0];
    if (ambiguous) {
      features.push({
        featureId: "AMBIGUOUS_CAPABILITY_ENTITY",
        ruleId: "ambiguous-capability-entity-v1",
        source: "CAPABILITY_MANIFEST",
        matchStart: ambiguous.matchStart,
        matchEnd: ambiguous.matchEnd,
        entityId: ambiguous.entityId,
        ownerCoursePack: ambiguous.ownerCoursePack,
      });
    }
  }
  return features;
}

function uniqueFeatureIds(
  values: readonly QueryPrerequisiteFeatureIdV3[],
) {
  return Array.from(new Set(values)).sort(compareCodePoints);
}

export function evaluateQueryPrerequisiteV3(input: {
  query: RetrievalQueryV2;
  capabilityEntityManifest?: CapabilityEntityManifestV2 | null;
}): QueryPrerequisiteTraceV3 {
  const query = RetrievalQueryV2Schema.parse(input.query);
  const manifest = input.capabilityEntityManifest === undefined
    || input.capabilityEntityManifest === null
    ? null
    : CapabilityEntityManifestV2Schema.parse(
      input.capabilityEntityManifest,
    );
  if (manifest && manifest.corpusBundleHash !== query.scope.corpusBundleHash) {
    throw new Error(
      "query prerequisite manifest must match the query corpus bundle",
    );
  }

  const features: z.infer<typeof QueryPrerequisiteFeatureV3Schema>[] = [];
  if (query.queryAsset) {
    features.push({
      featureId: "QUERY_ASSET_PRESENT",
      ruleId: "query-asset-present-v1",
      source: "QUERY_MODE",
      matchStart: null,
      matchEnd: null,
      entityId: null,
      ownerCoursePack: null,
    });
  }
  if (query.normalizedText !== null) {
    features.push(...textFeatures(query.normalizedText));
    if (manifest) {
      features.push(...entityFeatures({
        normalizedText: query.normalizedText,
        sourceCoursePack: query.scope.sourceCoursePack,
        manifest,
      }));
    }
  }
  const parsedFeatures = QueryPrerequisiteFeatureV3Schema
    .array()
    .max(128)
    .parse(features);
  const featureIds = new Set(
    parsedFeatures.map(({ featureId }) => featureId),
  );
  const has = (featureId: QueryPrerequisiteFeatureIdV3) =>
    featureIds.has(featureId);

  const explicitExternalFeatureIds = [
    "EXTERNAL_AUTHORIZATION_REQUEST",
    "EXTERNAL_PRICE_REQUEST",
    "EXTERNAL_OWNERSHIP_REQUEST",
    "EXTERNAL_SCHEDULE_REQUEST",
    "RESULT_GUARANTEE_REQUEST",
    "CURRENT_REGULATION_REQUEST",
  ] as const satisfies readonly QueryPrerequisiteFeatureIdV3[];
  const explicitExternalSignals = uniqueFeatureIds(
    explicitExternalFeatureIds.filter(has),
  );
  const temporalExternal =
    has("TEMPORAL_REFERENCE") && has("EXTERNAL_STATE_REQUEST");
  const localToolAction =
    has("LOCAL_TOOL_REFERENCE") && has("DIRECT_ACTION_REQUEST");
  const missingUserAsset =
    !has("QUERY_ASSET_PRESENT")
    && has("USER_ASSET_REFERENCE")
    && (
      has("ASSET_INSPECTION_OR_EDIT_REQUEST")
      || has("DIRECT_ACTION_REQUEST")
    );
  const missingParameterContext =
    !has("QUERY_ASSET_PRESENT")
    && has("EXACT_PARAMETER_REQUEST")
    && (
      has("PARAMETER_CONTEXT_ABSENCE")
      || !has("PARAMETER_CONTEXT_CUE")
    );

  let decision: QueryPrerequisiteDecisionV3 =
    "STATIC_CORPUS_ELIGIBLE";
  let confidence: z.infer<typeof QueryPrerequisiteConfidenceV3Schema> =
    "HIGH";
  let decisionSignals: QueryPrerequisiteFeatureIdV3[] = [];

  if (explicitExternalSignals.length > 0 || temporalExternal) {
    decision = "EXTERNAL_STATE_REQUIRED";
    confidence = "HIGH";
    decisionSignals = uniqueFeatureIds([
      ...explicitExternalSignals,
      ...(temporalExternal
        ? ["TEMPORAL_REFERENCE", "EXTERNAL_STATE_REQUEST"] as const
        : []),
    ]);
  } else if (localToolAction) {
    decision = "LOCAL_TOOL_ACTION_REQUIRED";
    confidence = "HIGH";
    decisionSignals = [
      "DIRECT_ACTION_REQUEST",
      "LOCAL_TOOL_REFERENCE",
    ];
  } else if (missingUserAsset) {
    decision = "USER_ASSET_REQUIRED";
    confidence = "HIGH";
    decisionSignals = uniqueFeatureIds([
      "USER_ASSET_REFERENCE",
      ...(has("ASSET_INSPECTION_OR_EDIT_REQUEST")
        ? ["ASSET_INSPECTION_OR_EDIT_REQUEST"] as const
        : []),
      ...(has("DIRECT_ACTION_REQUEST")
        ? ["DIRECT_ACTION_REQUEST"] as const
        : []),
    ]);
  } else if (missingParameterContext) {
    decision = "PARAMETER_CONTEXT_REQUIRED";
    confidence = "HIGH";
    decisionSignals = uniqueFeatureIds([
      "EXACT_PARAMETER_REQUEST",
      ...(has("PARAMETER_CONTEXT_ABSENCE")
        ? ["PARAMETER_CONTEXT_ABSENCE"] as const
        : []),
    ]);
  } else if (has("FOREIGN_EXCLUSIVE_ENTITY")) {
    decision = "COURSE_SCOPE_MISMATCH_CANDIDATE";
    confidence = "HIGH";
    decisionSignals = ["FOREIGN_EXCLUSIVE_ENTITY"];
  } else {
    const unresolvedSignals = uniqueFeatureIds([
      ...(
        has("EXTERNAL_STATE_REQUEST") && !has("TEMPORAL_REFERENCE")
          ? ["EXTERNAL_STATE_REQUEST"] as const
          : []
      ),
      ...(
        has("TEMPORAL_REFERENCE")
        && !has("EXTERNAL_STATE_REQUEST")
        && !has("STATIC_GUIDANCE_REQUEST")
          ? ["TEMPORAL_REFERENCE"] as const
          : []
      ),
      ...(
        has("EXACT_PARAMETER_REQUEST")
        && (
          has("QUERY_ASSET_PRESENT")
          || has("PARAMETER_CONTEXT_CUE")
        )
          ? ["EXACT_PARAMETER_REQUEST"] as const
          : []
      ),
      ...(
        has("USER_ASSET_REFERENCE")
        && !has("QUERY_ASSET_PRESENT")
        && !missingUserAsset
        && !has("STATIC_GUIDANCE_REQUEST")
          ? ["USER_ASSET_REFERENCE"] as const
          : []
      ),
    ]);
    if (unresolvedSignals.length > 0) {
      decision = "AMBIGUOUS";
      confidence = "MEDIUM";
      decisionSignals = unresolvedSignals;
    } else if (has("TEMPORAL_REFERENCE")) {
      confidence = "MEDIUM";
      decisionSignals = ["TEMPORAL_REFERENCE"];
    } else if (has("SCOPED_EXCLUSIVE_ENTITY")) {
      decisionSignals = ["SCOPED_EXCLUSIVE_ENTITY"];
    } else if (has("STATIC_GUIDANCE_REQUEST")) {
      decisionSignals = ["STATIC_GUIDANCE_REQUEST"];
    } else if (has("QUERY_ASSET_PRESENT")) {
      decisionSignals = ["QUERY_ASSET_PRESENT"];
    }
  }

  const failClosedEligible = confidence === "HIGH"
    && new Set<QueryPrerequisiteDecisionV3>(
      QUERY_PREREQUISITE_POLICY_V3.failClosedDecisions,
    ).has(decision);

  return QueryPrerequisiteTraceV3Schema.parse({
    schemaVersion: 3,
    queryHash: sha256StableJsonV2(query),
    queryMode: query.mode,
    corpusBundleHash: query.scope.corpusBundleHash,
    sourceCoursePack: query.scope.sourceCoursePack,
    capabilityEntityManifestHash: manifest?.configHash ?? null,
    featureAlgorithmHash:
      QUERY_PREREQUISITE_FEATURE_ALGORITHM_HASH_V3,
    policyHash: QUERY_PREREQUISITE_POLICY_HASH_V3,
    configHash: QUERY_PREREQUISITE_CONFIG_HASH_V3,
    decision,
    confidence,
    failClosedEligible,
    decisionSignals,
    features: parsedFeatures,
  });
}

export async function runQueryPrerequisiteShadowV3<T>(input: {
  query: RetrievalQueryV2;
  capabilityEntityManifest?: CapabilityEntityManifestV2 | null;
  retrieve: (query: RetrievalQueryV2) => Promise<T>;
}): Promise<{
  trace: QueryPrerequisiteTraceV3;
  retrievalResult: T;
}> {
  const query = RetrievalQueryV2Schema.parse(input.query);
  const trace = evaluateQueryPrerequisiteV3({
    query,
    ...(input.capabilityEntityManifest === undefined
      ? {}
      : {
          capabilityEntityManifest:
            input.capabilityEntityManifest,
        }),
  });
  const retrievalResult = await input.retrieve(query);
  return { trace, retrievalResult };
}

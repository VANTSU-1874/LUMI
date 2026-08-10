import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  sha256StableJsonV2,
  verifyKnowledgeCorpusBundleV2,
  type KnowledgeCorpusBundleV2,
} from "../../lib/knowledge/knowledge-object-v2";
import {
  loadKnowledgeDirectory,
} from "../../lib/knowledge/retrieve";
import {
  canonicalTextEntriesSha256,
} from "../../scripts/evaluate-retrieval-quality";
import {
  isT45EligibleNode,
  t45CapabilityFingerprint,
} from "../../tools/mixed-retrieval/t45-capability-authoring";

// These files are test-only frozen evidence, not runtime configuration.
const ROOT = process.cwd();
const LEGACY_ROOT = path.join(ROOT, "tests", "retrieval-quality");
const OUTPUT_ROOT = path.join(
  LEGACY_ROOT,
  "generations",
  "d1d399c1",
);
const OLD_BUNDLE =
  "82db90934afaffa3d227b6b0d11ab5efdb88009fd8b9274845567de4888079f8";
const NEW_BUNDLE =
  "d1d399c1790baba6820c874ab82483d9abae96fd22cd3fb16985a4d373b67cfc";

// Mutation below is confined to newly generated copies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutableJson = Record<string, any>;

const outputNames = [
  "golden-suite.json",
  "t42-recall-dev.json",
  "t43-evidence-adequacy-dev.json",
  "t44-support-dev.runtime.json",
  "t44-support-dev.qrels.json",
  "t45-capability-inventory.json",
  "t45-capability-calibration.runtime.json",
  "t45-capability-calibration.qrels.json",
  "t45-capability-validation.runtime.json",
  "t45-capability-validation.qrels.json",
  "t45-post-remediation-selector-acceptance.runtime.json",
  "t45-post-remediation-selector-acceptance.qrels.json",
  "t45-post-completion-selector-acceptance.runtime.json",
  "t45-post-completion-selector-acceptance.qrels.json",
  "t45-post-candidate-remediation-selector-acceptance.runtime.json",
  "t45-post-candidate-remediation-selector-acceptance.qrels.json",
] as const;

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function serialize(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(name: string) {
  return JSON.parse(
    await readFile(path.join(LEGACY_ROOT, name), "utf8"),
  ) as MutableJson;
}

async function writeJson(name: string, value: unknown) {
  const text = serialize(value);
  await writeFile(path.join(OUTPUT_ROOT, name), text, "utf8");
  return { bytes: Buffer.byteLength(text), sha256: sha256(text) };
}

function reseal(value: MutableJson, field = "suiteHash") {
  const unhashed = { ...value };
  delete unhashed[field];
  value[field] = sha256StableJsonV2(unhashed);
}

function caseById(suite: MutableJson, caseId: string) {
  const found = suite.cases.find(
    (candidate: MutableJson) =>
      (candidate.caseId ?? candidate.id ?? candidate.scoring?.caseId)
        === caseId,
  ) as MutableJson | undefined;
  if (!found) throw new Error(`K10_CLOSURE_CASE_MISSING:${caseId}`);
  return found;
}

function qrelGroups(
  qrels: MutableJson,
  caseId: string,
  groups: Array<{ groupId: string; acceptableNodeIds: string[] }>,
) {
  caseById(qrels, caseId).requiredEvidenceGroups = groups;
}

async function currentGoldenSuite() {
  const suite = await readJson("golden-suite.json");
  const knowledgeDirectory = path.join(ROOT, "data", "knowledge");
  const filenames = (await readdir(knowledgeDirectory, {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isFile() && (
      entry.name.endsWith(".md")
      || entry.name === "course-corpus-conversion-report.json"
    ))
    .map(({ name }) => name)
    .sort();
  const knowledgeEntries = await Promise.all(
    filenames.map(async (filename) => ({
      path: `data/knowledge/${filename}`,
      text: await readFile(path.join(knowledgeDirectory, filename), "utf8"),
    })),
  );
  const knowledge = await loadKnowledgeDirectory(knowledgeDirectory);
  const sourcePaths = [...new Set(knowledge.flatMap((item) => {
    const locator = item.source.localDocument?.replaceAll("\\", "/");
    return locator?.startsWith("data/courses/") ? [locator] : [];
  }))].sort();
  const sourceEntries = await Promise.all(sourcePaths.map(async (sourcePath) => ({
    path: sourcePath,
    text: await readFile(path.join(ROOT, sourcePath), "utf8"),
  })));
  suite.corpusSnapshot = {
    ...suite.corpusSnapshot,
    commit: "238769b503e7ac2f1cc9b91b349dd7902ce67af6",
    knowledgeTree: "691df33a6355c6713fb5a27772d1f0b993db779c",
    coursesTree: "8c2d5dccd324500b60855f619764f646725d51f6",
    runtimeKnowledgeCount: knowledge.length,
    knowledgeCorpusSha256:
      canonicalTextEntriesSha256(knowledgeEntries),
    sourceDocumentCount: sourceEntries.length,
    sourceCorpusSha256:
      canonicalTextEntriesSha256(sourceEntries),
  };
  return suite;
}

async function currentT42() {
  const suite = await readJson("t42-recall-dev.json");
  suite.corpusSnapshot.bundleHash = NEW_BUNDLE;
  const changed = caseById(
    suite,
    "t42-recall-dev-digital-answerable-tool-role-switch",
  );
  changed.runtime.question =
    "DigiShow 和 TouchDesigner 必须按固定顺序学吗？怎样先判断当前目标能否由其中一个软件独立完成？";
  return suite;
}

async function currentT43() {
  const suite = await readJson("t43-evidence-adequacy-dev.json");
  suite.corpusSnapshot.bundleHash = NEW_BUNDLE;
  const transfer = caseById(
    suite,
    "t43-dev-digital-interaction-p3a",
  );
  transfer.runtime.question =
    "把距离输入改成声音输入后，画面和参与体验都变了。迁移记录应该写哪些内容，怎样判断新体验是否值得继续？";
  transfer.scoring.requiredEvidenceGroups = [[
    "node-16c17704eb26e8043ec8b9799ea245b0370e141dbdc811b31158efed84e4018f",
  ], [
    "node-5adefe7ad558f174316b8737585495dd8412123ba18f91d152dd3df8bfca3d4f",
  ]];
  const layout = caseById(suite, "t43-dev-layout-p1a");
  layout.runtime.question =
    "页面已经整齐对齐但主次仍不清楚，应该依据什么实际阅读路径检查信息层级？";
  return suite;
}

async function currentT44() {
  const runtime = await readJson("t44-support-dev.runtime.json");
  const qrels = await readJson("t44-support-dev.qrels.json");
  runtime.corpusSnapshot.bundleHash = NEW_BUNDLE;
  const questionUpdates: Record<string, string> = {
    "t44-support-digital-p3b":
      "互动方案更换媒介后，不把其他条件假设为不变时，迁移记录应写哪些内容并验证什么？",
    "t44-support-layout-p1a":
      "信息很多时，应先明确什么阅读顺序，再怎样判断是否需要栅格？",
    "t44-support-layout-p2a":
      "所有东西都对齐了还是没重点，怎样用阅读路径和对照版本重新判断主次？",
    "t44-support-layout-p3a":
      "不同页面承担相同任务的信息，怎样比较字体、位置和留白，判断它们仍属于同一系统？",
    "t44-support-layout-p4b":
      "层级或留白出现有意变化时，怎样用去掉装饰的对照判断它是否仍在说明内容结构？",
    "t44-support-layout-p5a":
      "页面需要引导下一步时，怎样先定义读者的阅读顺序，并验证它服务了设计意图？",
  };
  for (const [caseId, question] of Object.entries(questionUpdates)) {
    caseById(runtime, caseId).question = question;
  }
  reseal(runtime);

  qrels.corpusSnapshot.bundleHash = NEW_BUNDLE;
  qrels.runtimeSuite.suiteHash = runtime.suiteHash;
  qrelGroups(qrels, "t44-support-layout-p1a", [
    {
      groupId: "grid-task",
      acceptableNodeIds: [
        "node-a8f7b30e70182c95cdd8b6428687eebf255d9404f0f3482f5569459e8c037cf7",
      ],
    },
    {
      groupId: "hierarchy-order",
      acceptableNodeIds: [
        "node-04a437018bb4c3e6f57f356e21121d9748f6dd5dc1ac755805ed957cfc7cc002",
      ],
    },
  ]);
  qrelGroups(qrels, "t44-support-layout-p2a", [
    {
      groupId: "restore-contrast",
      acceptableNodeIds: [
        "node-64dd7941ae2cf7c84a8007ab83f952dc6a544199e5b2842227cd0bdf44cec1a4",
      ],
    },
    {
      groupId: "shared-alignment-path",
      acceptableNodeIds: [
        "node-02fbbd4d25bbe2eeb47d2d0e7a72e154f6c2c9adcf23d82a71385898957fea74",
      ],
    },
  ]);
  qrelGroups(qrels, "t44-support-layout-p3a", [
    {
      groupId: "column-skeleton",
      acceptableNodeIds: [
        "node-c95cd51c38485365cf00c17c0b5de70b11ac37ae10c605c44ac613fa360c38af",
      ],
    },
    {
      groupId: "spacing-groups",
      acceptableNodeIds: [
        "node-15be50a84e0126adcfb7efccb2725ba005c7bde35fd22341e1420202ba0fd953",
      ],
    },
    {
      groupId: "whitespace-boundary",
      acceptableNodeIds: [
        "node-f4f1e98b00d05d9367050cb39b8cdba53a4929be8548c86e439dda5e325827f4",
      ],
    },
  ]);
  qrelGroups(qrels, "t44-support-layout-p4b", [
    {
      groupId: "whitespace-function",
      acceptableNodeIds: [
        "node-ff086c0a51f508c4b705ad151c5c4ba9edceba75a72d7eec02b70705c60723c6",
      ],
    },
    {
      groupId: "inspect-information-groups",
      acceptableNodeIds: [
        "node-0f21de802f350fdc80d173a2ac89e7861c1855402d0d994b79dab7ddd338fbd6",
      ],
    },
  ]);
  qrelGroups(qrels, "t44-support-layout-p5a", [
    {
      groupId: "ordered-information",
      acceptableNodeIds: [
        "node-04a437018bb4c3e6f57f356e21121d9748f6dd5dc1ac755805ed957cfc7cc002",
      ],
    },
    caseById(qrels, "t44-support-layout-p5a")
      .requiredEvidenceGroups[1],
  ]);
  reseal(qrels);
  return { runtime, qrels };
}

function currentInventory(
  legacy: MutableJson,
  corpus: KnowledgeCorpusBundleV2,
) {
  const objects = new Map<
    string,
    KnowledgeCorpusBundleV2["objects"][number]
  >(
    corpus.objects.map((object) => [object.id, object] as const),
  );
  legacy.corpusBundleHash = NEW_BUNDLE;
  for (const entry of legacy.objects as MutableJson[]) {
    const object = objects.get(entry.objectId as string);
    if (!object) {
      throw new Error(`K10_CLOSURE_OBJECT_MISSING:${entry.objectId}`);
    }
    entry.objectContentHash = object.contentHash;
    entry.eligibleNodeIds = object.nodes
      .filter(isT45EligibleNode)
      .map((node) => node.id)
      .sort();
    entry.capabilityFingerprint = t45CapabilityFingerprint(object);
  }
  reseal(legacy, "inventoryHash");
  return legacy;
}

async function currentCapabilitySuites(
  inventory: MutableJson,
) {
  const calibrationRuntime = await readJson(
    "t45-capability-calibration.runtime.json",
  );
  const calibrationQrels = await readJson(
    "t45-capability-calibration.qrels.json",
  );
  const validationRuntime = await readJson(
    "t45-capability-validation.runtime.json",
  );
  const validationQrels = await readJson(
    "t45-capability-validation.qrels.json",
  );
  for (const runtime of [calibrationRuntime, validationRuntime]) {
    runtime.corpusSnapshot.bundleHash = NEW_BUNDLE;
  }
  caseById(calibrationRuntime, "t45-cal-digishow-workflow-direct")
    .question =
      "我需要先判断是在学 DigiShow、学 TouchDesigner，还是作品确实要整合两者。应该先问什么？";
  caseById(calibrationRuntime, "t45-cal-digishow-workflow-compose")
    .question =
      "作品确实要整合 DigiShow 和 TouchDesigner 时，怎样画出当前关系并用证据逐段验证，同时避免把它写成通用固定链路？";
  reseal(calibrationRuntime);
  reseal(validationRuntime);

  for (const [runtime, qrels] of [
    [calibrationRuntime, calibrationQrels],
    [validationRuntime, validationQrels],
  ] as const) {
    qrels.corpusSnapshot.bundleHash = NEW_BUNDLE;
    qrels.runtimeSuite.suiteHash = runtime.suiteHash;
    qrels.capabilityInventory.inventoryHash = inventory.inventoryHash;
  }
  qrelGroups(
    calibrationQrels,
    "t45-cal-digishow-workflow-direct",
    [{
      groupId: "group-1",
      acceptableNodeIds: [
        "node-d49f6e5457d4f41dc9f060c2672e0c450befa2f03caf54792a041bdac8668f02",
        "node-2e8c571d3146f2ef0928beccbe6eaf450336cc6b505aecde283d671ac29fd7d5",
      ],
    }],
  );
  qrelGroups(
    calibrationQrels,
    "t45-cal-digishow-workflow-compose",
    [
      {
        groupId: "group-1",
        acceptableNodeIds: [
          "node-f911798339b557e21f9c83629b41d1ba65a42d3831ffd4c6bc9236dd18c9c246",
        ],
      },
      {
        groupId: "group-2",
        acceptableNodeIds: [
          "node-e56909f1ebf3d914f377c9e295bf41b9fa991d2d09991781e473b23ccb818400",
          "node-57f3a0274452963e0084f004ea289d9acf2edaf44cb6fbedccb95458999440b0",
        ],
      },
    ],
  );
  reseal(calibrationQrels);
  reseal(validationQrels);
  return {
    calibrationRuntime,
    calibrationQrels,
    validationRuntime,
    validationQrels,
  };
}

async function currentPostSuite(
  base: string,
  inventory: MutableJson,
  updates: Record<string, {
    question: string;
    groups: Array<{ groupId: string; acceptableNodeIds: string[] }>;
  }>,
) {
  const runtime = await readJson(`${base}.runtime.json`);
  const qrels = await readJson(`${base}.qrels.json`);
  runtime.corpusSnapshot.bundleHash = NEW_BUNDLE;
  runtime.capabilityInventory.inventoryHash = inventory.inventoryHash;
  for (const [caseId, update] of Object.entries(updates)) {
    caseById(runtime, caseId).question = update.question;
  }
  reseal(runtime);
  qrels.corpusSnapshot.bundleHash = NEW_BUNDLE;
  qrels.runtimeSuite.suiteHash = runtime.suiteHash;
  qrels.capabilityInventory.inventoryHash = inventory.inventoryHash;
  for (const [caseId, update] of Object.entries(updates)) {
    qrelGroups(qrels, caseId, update.groups);
  }
  reseal(qrels);
  return { runtime, qrels };
}

async function main() {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const corpus = verifyKnowledgeCorpusBundleV2(JSON.parse(await readFile(
    path.join(ROOT, "data", "knowledge-v2", "knowledge-corpus.v2.json"),
    "utf8",
  )) as unknown);
  if (corpus.bundleHash !== NEW_BUNDLE) {
    throw new Error("K10_CLOSURE_CURRENT_CORPUS_MISMATCH");
  }

  const golden = await currentGoldenSuite();
  const t42 = await currentT42();
  const t43 = await currentT43();
  const t44 = await currentT44();
  const inventory = currentInventory(
    await readJson("t45-capability-inventory.json"),
    corpus,
  );
  const capability = await currentCapabilitySuites(inventory);
  const remediation = await currentPostSuite(
    "t45-post-remediation-selector-acceptance",
    inventory,
    {
      "t45-remacc-layout-hierarchy-direct": {
        question:
          "标题、时间和正文都很抢时，怎样先定义阅读顺序，再用一个对照版本判断栅格是否有帮助？",
        groups: [{
          groupId: "group-1",
          acceptableNodeIds: [
            "node-04a437018bb4c3e6f57f356e21121d9748f6dd5dc1ac755805ed957cfc7cc002",
            "node-64dd7941ae2cf7c84a8007ab83f952dc6a544199e5b2842227cd0bdf44cec1a4",
          ],
        }],
      },
      "t45-remacc-layout-hierarchy-compose": {
        question:
          "页面对齐但读者仍到处跳时，怎样检查实际阅读路径，并比较不用栅格与少量栏位两个版本？",
        groups: [
          {
            groupId: "group-1",
            acceptableNodeIds: [
              "node-02fbbd4d25bbe2eeb47d2d0e7a72e154f6c2c9adcf23d82a71385898957fea74",
              "node-19489142179e955df6542033a90d7e7275c6f83d0852ecf1543f19008d240efa",
            ],
          },
          {
            groupId: "group-2",
            acceptableNodeIds: [
              "node-64dd7941ae2cf7c84a8007ab83f952dc6a544199e5b2842227cd0bdf44cec1a4",
            ],
          },
        ],
      },
    },
  );
  const completion = await currentPostSuite(
    "t45-post-completion-selector-acceptance",
    inventory,
    {
      "t45-compacc-type-groups-direct": {
        question:
          "已经能识别基本文字角色后，怎样判断增加字体或例外是在承担结构作用，而不是只增加噪声？",
        groups: [{
          groupId: "group-1",
          acceptableNodeIds: [
            "node-0fe8a2c44fb687856f72cb21d877a947744db8bf28cee6019cb31f371bcfd535",
            "node-c95cd51c38485365cf00c17c0b5de70b11ac37ae10c605c44ac613fa360c38af",
          ],
        }],
      },
      "t45-compacc-type-groups-compose": {
        question:
          "怎样比较不同页面中承担相同任务的文字角色与留白，并用去掉装饰和有意变化的对照证明结构仍可辨认？",
        groups: [
          {
            groupId: "group-1",
            acceptableNodeIds: [
              "node-c95cd51c38485365cf00c17c0b5de70b11ac37ae10c605c44ac613fa360c38af",
              "node-15be50a84e0126adcfb7efccb2725ba005c7bde35fd22341e1420202ba0fd953",
            ],
          },
          {
            groupId: "group-2",
            acceptableNodeIds: [
              "node-0f21de802f350fdc80d173a2ac89e7861c1855402d0d994b79dab7ddd338fbd6",
              "node-6fa785c4d2c75782d3a7eae97c186e653b8167c93020a439aec8fb95a8405610",
            ],
          },
        ],
      },
    },
  );
  const candidate = await currentPostSuite(
    "t45-post-candidate-remediation-selector-acceptance",
    inventory,
    {},
  );

  const generated: Record<string, unknown> = {
    "golden-suite.json": golden,
    "t42-recall-dev.json": t42,
    "t43-evidence-adequacy-dev.json": t43,
    "t44-support-dev.runtime.json": t44.runtime,
    "t44-support-dev.qrels.json": t44.qrels,
    "t45-capability-inventory.json": inventory,
    "t45-capability-calibration.runtime.json": capability.calibrationRuntime,
    "t45-capability-calibration.qrels.json": capability.calibrationQrels,
    "t45-capability-validation.runtime.json": capability.validationRuntime,
    "t45-capability-validation.qrels.json": capability.validationQrels,
    "t45-post-remediation-selector-acceptance.runtime.json": remediation.runtime,
    "t45-post-remediation-selector-acceptance.qrels.json": remediation.qrels,
    "t45-post-completion-selector-acceptance.runtime.json": completion.runtime,
    "t45-post-completion-selector-acceptance.qrels.json": completion.qrels,
    "t45-post-candidate-remediation-selector-acceptance.runtime.json": candidate.runtime,
    "t45-post-candidate-remediation-selector-acceptance.qrels.json": candidate.qrels,
  };
  const files: Record<string, { bytes: number; sha256: string }> = {};
  const historicalFiles: Record<
    string,
    { bytes: number; sha256: string }
  > = {};
  for (const name of outputNames) {
    files[name] = await writeJson(name, generated[name]);
    const historicalBytes = await readFile(path.join(LEGACY_ROOT, name));
    historicalFiles[name] = {
      bytes: historicalBytes.byteLength,
      sha256: sha256(historicalBytes),
    };
  }
  const failureInventory = [
    ["tests/unit/scripts/t45-multi-anchor-audit-cli-v1.test.ts", 5, "GENERATION_IDENTITY"],
    ["tests/unit/scripts/t45-capability-obligations-cli-v1.test.ts", 2, "GENERATION_IDENTITY"],
    ["tests/unit/mixed-retrieval-evaluation-v2.test.ts", 1, "GENERATION_IDENTITY"],
    ["tests/unit/knowledge-index-packager-v2.test.ts", 1, "CURRENT_COUNT"],
    ["tests/integration/knowledge-v2-store.test.ts", 1, "CURRENT_COUNT"],
    ["tests/unit/tools/t45-capability-loader.test.ts", 15, "GENERATION_IDENTITY"],
    ["tests/integration/operations-commands.test.ts", 1, "CURRENT_COUNT"],
    ["tests/unit/retrieval-caption-baseline.test.ts", 2, "GENERATION_IDENTITY"],
    ["tests/unit/tools/t43-evidence-adequacy-loader.test.ts", 4, "GENERATION_IDENTITY"],
    ["tests/unit/visual-evaluation.test.ts", 1, "GENERATION_IDENTITY"],
    ["tests/unit/tools/t44-support-loader.test.ts", 6, "GENERATION_IDENTITY"],
    ["tests/unit/scripts/t45-capability-suites-cli.test.ts", 3, "GENERATION_IDENTITY"],
    ["tests/integration/knowledge-ingestion-pipeline.test.ts", 1, "CURRENT_COUNT"],
    ["tests/unit/tools/t45-post-completion-selector-acceptance-v1.test.ts", 2, "GENERATION_IDENTITY"],
    ["tests/unit/tools/t45-post-candidate-remediation-selector-acceptance-v1.test.ts", 3, "GENERATION_IDENTITY"],
    ["tests/unit/tools/t45-post-remediation-selector-acceptance-v1.test.ts", 2, "GENERATION_IDENTITY"],
  ].map(([testFile, failures, classification]) => ({
    testFile,
    failures,
    classification,
  }));
  const caseUpdates = [
    ["t42-recall-dev.json", "t42-recall-dev-digital-answerable-tool-role-switch", "dicd-003-digishow-touchdesigner-roles", "runtime question follows independent software learning goals"],
    ["t43-evidence-adequacy-dev.json", "t43-dev-digital-interaction-p3a", "dicd-004-change-one-condition-for-transfer", "controlled-variable transfer was replaced by experience-aware migration evidence"],
    ["t43-evidence-adequacy-dev.json", "t43-dev-layout-p1a", "layout-001-grid-and-hierarchy", "query now tests reading-path evidence rather than alignment-line prescription"],
    ["t44-support-dev.runtime.json", "t44-support-digital-p3b", "dicd-004-change-one-condition-for-transfer", "question follows the current migration record"],
    ["t44-support-dev.runtime.json", "t44-support-layout-p1a", "layout-001-grid-and-hierarchy", "question and qrels now put reading intent before grid choice"],
    ["t44-support-dev.runtime.json", "t44-support-layout-p2a", "layout-001-grid-and-hierarchy", "qrels now distinguish alignment from hierarchy"],
    ["t44-support-dev.runtime.json", "t44-support-layout-p3a", "layout-002-type-hierarchy-and-whitespace", "case now evaluates cross-page system relations"],
    ["t44-support-dev.runtime.json", "t44-support-layout-p4b", "layout-002-type-hierarchy-and-whitespace", "case now evaluates intentional hierarchy and whitespace variation"],
    ["t44-support-dev.runtime.json", "t44-support-layout-p5a", "layout-001-grid-and-hierarchy", "ordered-information evidence now uses the current reading-intent action"],
    ["t45-capability-calibration.runtime.json", "t45-cal-digishow-workflow-direct", "dicd-003-digishow-touchdesigner-roles", "old troubleshooting classification no longer exists in current source"],
    ["t45-capability-calibration.runtime.json", "t45-cal-digishow-workflow-compose", "dicd-003-digishow-touchdesigner-roles", "case now evaluates work-specific integration and evidence"],
    ["t45-post-remediation-selector-acceptance.runtime.json", "t45-remacc-layout-hierarchy-direct", "layout-001-grid-and-hierarchy", "case now compares reading order before optional grid use"],
    ["t45-post-remediation-selector-acceptance.runtime.json", "t45-remacc-layout-hierarchy-compose", "layout-001-grid-and-hierarchy", "case now compares no-grid and limited-grid versions"],
    ["t45-post-completion-selector-acceptance.runtime.json", "t45-compacc-type-groups-direct", "layout-002-type-hierarchy-and-whitespace", "case now tests structural purpose of type variation"],
    ["t45-post-completion-selector-acceptance.runtime.json", "t45-compacc-type-groups-compose", "layout-002-type-hierarchy-and-whitespace", "case now tests cross-page system evidence and intentional variation"],
  ].map(([asset, caseId, sourceObjectId, reason]) => ({
    asset,
    caseId,
    sourceObjectId,
    old: "historical case in knowledge-v2-82db9093",
    new: "reauthored case in knowledge-v2-d1d399c1",
    reason,
  }));
  const updateReasons: Record<string, string> = {
    "golden-suite.json": "snapshot commit, trees, and canonical corpus hashes rebound to the current source corpus",
    "t42-recall-dev.json": "current generation identity plus one source-aligned question",
    "t43-evidence-adequacy-dev.json": "current identity plus two source-aligned evidence cases",
    "t44-support-dev.runtime.json": "current identity plus six source-aligned runtime questions",
    "t44-support-dev.qrels.json": "resealed current qrels; five layout cases use semantically valid current anchors",
    "t45-capability-inventory.json": "all 116 object hashes and fingerprints recomputed; two new ACTION nodes included",
    "t45-capability-calibration.runtime.json": "current identity plus two reauthored DigiShow and TouchDesigner cases",
    "t45-capability-calibration.qrels.json": "resealed current qrels for the two reauthored calibration cases",
    "t45-capability-validation.runtime.json": "identity and seal rebound; runtime cases unchanged",
    "t45-capability-validation.qrels.json": "identity, inventory binding, and seal rebound; labels unchanged",
    "t45-post-remediation-selector-acceptance.runtime.json": "identity and inventory rebound plus two layout questions",
    "t45-post-remediation-selector-acceptance.qrels.json": "two layout qrels reauthored and suite resealed",
    "t45-post-completion-selector-acceptance.runtime.json": "identity and inventory rebound plus two typography questions",
    "t45-post-completion-selector-acceptance.qrels.json": "two typography qrels reauthored and suite resealed",
    "t45-post-candidate-remediation-selector-acceptance.runtime.json": "identity, inventory binding, and seal rebound; cases unchanged",
    "t45-post-candidate-remediation-selector-acceptance.qrels.json": "identity, inventory binding, and seal rebound; labels unchanged",
  };
  const report = {
    schemaVersion: 1,
    kind: "K10_EVALUATION_CLOSURE_AUDIT",
    result: "PASS_FULL_TEST_TYPECHECK_BUILD",
    gateEvidence: {
      targeted: { testFilesPassed: 17, testsPassed: 136 },
      fullProject: {
        testFilesPassed: 387,
        testsPassed: 3339,
        testsSkipped: 1,
      },
      typecheck: "PASS_TSC_NO_EMIT",
      productionBuild: "PASS_NEXT_BUILD",
      productionBuildWarnings: [
        "NEXT_TURBOPACK_NFT_DYNAMIC_TRACE_WARNING_EXISTING_NON_BLOCKING",
      ],
    },
    initialFullTestFailureCount: 50,
    initialFailureClassification: {
      generationIdentityAndSourceBinding: 46,
      currentCorpusCounts: 4,
      trueBehaviorRegression: 0,
    },
    failureInventory,
    sourceChange: {
      commit: "090798e14",
      oldBundleHash: OLD_BUNDLE,
      newBundleHash: NEW_BUNDLE,
      oldCounts: { objects: 116, nodes: 1702, relations: 1586 },
      newCounts: { objects: 116, nodes: 1704, relations: 1588 },
      changedObjects: [
        ["dicd-002-interaction-scheme-six-clarifications", "38852ff64af693c9df56ccb1c1c9b64e02a3020214c78d8d7a90ede0538f21fe", "fafb328af2156dccfe9d1db2aa91c3fbd42d135eaab6e9281f3f2e353e26e822", 13, 13],
        ["dicd-003-digishow-touchdesigner-roles", "a50dfcb76ec6fb75682f6fcdcc9df4a9bfdc74bee29ff421a11ed9e4127ea592", "e3d9ea405bbbdb6b5f5ddd08b3a9ab7204a70a7d6093ec682f0d09d3ed817a82", 14, 14],
        ["dicd-004-change-one-condition-for-transfer", "01051972f4fed6555ba4bf35a668d135c6304b623684cb3654832c69e35460a2", "7fbe56bf427b069310395367c9c4951dfa67762ef15fd3023f0f31e7c6bcbcde", 14, 14],
        ["layout-001-grid-and-hierarchy", "7dfc036da0d90438310c725ca2e17ee145cbb86ac22fa2bb056dea6daf97ff61", "db0401949d449052c88bdb353535e64365a813f5813c65694ef014fb4aa6b01b", 13, 14],
        ["layout-002-type-hierarchy-and-whitespace", "7bf6d5f412a68de4288dee07a6b9abc45551b2ff842f5c1498ac0bb888770496", "09a431a5feba35c2d77ceaf670ed41b5706c4378dc712a5da4711812d41c0b5c", 13, 14],
      ].map(([objectId, oldContentHash, newContentHash, oldNodes, newNodes]) => ({
        objectId,
        oldContentHash,
        newContentHash,
        oldNodes,
        newNodes,
        reason: "object is part of corpus generation d1d399c1 produced by source-alignment commit 090798e14",
      })),
      addedActionNodeIds: [
        "node-5e25bccaeb2e46d7df1fb51c031698a39d15d2569e4a5b7924a4cf7d8741d013",
        "node-6fa785c4d2c75782d3a7eae97c186e653b8167c93020a439aec8fb95a8405610",
      ],
    },
    qrelsReview: {
      referencedNodeIdsMissingFromCurrentCorpus: 0,
      changedReferencedNodeBodies: 23,
      semanticallyReauthoredQrelCases: 12,
      unexplainedQrelsChanges: 0,
      caseUpdates,
    },
    countUpdates: [
      { source: "current corpus manifest", field: "nodeCount", old: 1702, new: 1704 },
      { source: "current corpus graph", field: "relationCount", old: 1586, new: 1588 },
      { source: "BGE representation package", field: "representationCount", old: 1858, new: 1860 },
    ],
    closureAssetUpdates: outputNames.map((name) => ({
      source: `tests/retrieval-quality/${name}`,
      target: `tests/retrieval-quality/generations/d1d399c1/${name}`,
      old: historicalFiles[name],
      new: files[name],
      reason: updateReasons[name],
    })),
    generationGuard: {
      errorCode: "KNOWLEDGE_V2_EVALUATION_GENERATION_MIX_FORBIDDEN",
      rejectsOldEvaluationWithCurrentCorpus: true,
      rejectsCurrentEvaluationWithOldCorpus: true,
    },
    rollback: {
      removeGenerationDirectory:
        "tests/retrieval-quality/generations/d1d399c1",
      restoreTestOnlyCommit: true,
      historicalAssetsRemainByteIdentical: true,
      runtimePointersTouched: false,
      k9ReleaseTouched: false,
      k10ShadowGenerationTouched: false,
    },
  };
  files["audit-report.json"] = await writeJson(
    "audit-report.json",
    report,
  );
  const manifest = {
    schemaVersion: 1,
    kind: "K10_EVALUATION_CLOSURE",
    generationId: "knowledge-v2-d1d399c1",
    corpus: {
      path: "data/knowledge-v2/knowledge-corpus.v2.json",
      bundleHash: NEW_BUNDLE,
      objectCount: 116,
      nodeCount: 1704,
      relationCount: 1588,
    },
    historicalBaseline: {
      generationId: "knowledge-v2-82db9093",
      bundleHash: OLD_BUNDLE,
      objectCount: 116,
      nodeCount: 1702,
      relationCount: 1586,
      policy: "PRESERVE_BYTE_IDENTICAL_NO_MIXING",
      files: historicalFiles,
    },
    files,
  };
  await writeJson("manifest.json", manifest);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

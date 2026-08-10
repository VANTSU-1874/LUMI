// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  CURRENT_TUTOR_QUALITY_RUBRIC_VERSION,
  CURRENT_TUTOR_QUALITY_SUITE_HASH,
  CURRENT_TUTOR_QUALITY_SUITE_VERSION,
  loadTutorQualitySuite,
  TUTOR_QUALITY_CASE_COUNT,
  TUTOR_QUALITY_CATEGORIES,
  TUTOR_QUALITY_DIMENSION_IDS,
  TUTOR_QUALITY_HARD_FAILURE_IDS,
  TutorQualitySuiteSchema,
} from "@/lib/agent/tutor-quality-suite";

const qualitySuitePath = path.resolve("tests/tutor-quality/golden-suite.json");
const structuralSuitePath = path.resolve("data/evals/agent-core.json");
const EXPECTED_STRUCTURAL_CASE_IDS = [
  "di-explore-goal",
  "di-understand-chain",
  "di-build-audio-first-step",
  "di-debug-audio-value-no-motion",
  "di-debug-osc-no-data",
  "di-understand-chop-top",
  "di-transfer-mic-to-sensor",
  "di-reflect-evidence",
  "di-boundary-after-effects",
  "di-clarify-vague-goal",
  "di-understand-digishow-signal-types",
  "di-build-digishow-mapping",
  "book-explore-audience",
  "book-build-eight-pages",
  "book-debug-reading-route",
  "book-transfer-residents",
  "book-boundary-accordion-craft",
  "book-build-grid",
  "book-debug-font-legibility",
  "di-context-second-step",
  "book-evidence-reading-path",
  "book-safety-submit-grade",
  "general-poster-cool-start",
  "general-ip-character-start",
  "general-packaging-fuzzy-follow-up",
  "cross-switch-book-to-digital",
] as const;

describe("V3 tutor quality golden suite", () => {
  it("loads the stable expanded suite with a content hash and unique lineage", () => {
    const { suite, suiteHash } = loadTutorQualitySuite(qualitySuitePath);

    expect(suite).toMatchObject({
      schemaVersion: 1,
      version: CURRENT_TUTOR_QUALITY_SUITE_VERSION,
      rubricVersion: CURRENT_TUTOR_QUALITY_RUBRIC_VERSION,
    });
    expect(suite.cases).toHaveLength(TUTOR_QUALITY_CASE_COUNT);
    expect(suiteHash).toBe(CURRENT_TUTOR_QUALITY_SUITE_HASH);
    expect(new Set(suite.cases.map(({ id }) => id))).toHaveProperty("size", TUTOR_QUALITY_CASE_COUNT);
    expect(suite.cases.filter(({ origin }) => origin === "EXISTING_STRUCTURAL_EVAL")).toHaveLength(26);
    expect(suite.cases.filter(({ origin }) => origin === "EXISTING_RUNTIME_BENCHMARK")).toHaveLength(11);
    expect(suite.cases.filter(({ origin }) => origin === "SIMULATED_STUDENT")).toHaveLength(15);
  });

  it("reuses existing questions without coupling quality judgments to keyword expectations", () => {
    const { suite } = loadTutorQualitySuite(qualitySuitePath);
    const structural = JSON.parse(readFileSync(structuralSuitePath, "utf8")) as {
      cases: Array<{
        id: string;
        message: string;
        view: string;
        prelude: Array<{ message: string; view: string }>;
      }>;
    };
    const structuralById = new Map(structural.cases.map((item) => [item.id, item]));
    const reused = suite.cases.filter(({ origin }) => origin === "EXISTING_STRUCTURAL_EVAL");

    for (const qualityCase of reused) {
      const source = structuralById.get(qualityCase.sourceCaseId!);
      expect(source, qualityCase.id).toBeDefined();
      expect(qualityCase.question, qualityCase.id).toBe(source?.message);
      expect(qualityCase.view, qualityCase.id).toBe(source?.view);
      expect(qualityCase.prelude, qualityCase.id).toEqual(source?.prelude);
    }
    expect(reused).toHaveLength(26);
    expect(new Set(reused.map(({ sourceCaseId }) => sourceCaseId))).toEqual(
      new Set(EXPECTED_STRUCTURAL_CASE_IDS),
    );

    const runtime = JSON.parse(readFileSync(path.resolve("data/evals/agent-runtime-benchmark.json"), "utf8")) as {
      designCases: Array<{ id: string; message: string }>;
    };
    const runtimeById = new Map(runtime.designCases.map((item) => [item.id, item]));
    const benchmarkCases = suite.cases.filter(({ origin }) => origin === "EXISTING_RUNTIME_BENCHMARK");
    for (const qualityCase of benchmarkCases) {
      const source = runtimeById.get(qualityCase.sourceCaseId!);
      expect(source, qualityCase.id).toBeDefined();
      expect(qualityCase.question, qualityCase.id).toBe(source?.message);
      expect(qualityCase.view, qualityCase.id).toBe("AGENT");
      expect(qualityCase.prelude, qualityCase.id).toEqual([]);
    }
    expect(new Set(benchmarkCases.map(({ sourceCaseId }) => sourceCaseId))).toEqual(
      new Set(runtime.designCases.map(({ id }) => id)),
    );
  });

  it("covers every required question type, all course contexts and broad design specialties", () => {
    const { suite } = loadTutorQualitySuite(qualitySuitePath);
    const categories = new Set(suite.cases.map(({ category }) => category));
    const coursePacks = new Set(suite.cases.map(({ coursePackId }) => coursePackId));
    const specialties = new Set(suite.cases.flatMap(({ specialties: values }) => values));

    expect(categories).toEqual(new Set(TUTOR_QUALITY_CATEGORIES));
    expect(coursePacks).toEqual(new Set([
      "general-design",
      "digital-interaction",
      "book-design",
      "layout-design",
      "brand-vi-design",
    ]));
    expect(Object.fromEntries(
      [...coursePacks].map((coursePackId) => [
        coursePackId,
        suite.cases.filter((qualityCase) => qualityCase.coursePackId === coursePackId).length,
      ]),
    )).toEqual({
      "general-design": 19,
      "digital-interaction": 12,
      "book-design": 9,
      "layout-design": 9,
      "brand-vi-design": 3,
    });
    expect(specialties.size).toBeGreaterThanOrEqual(12);
    expect(suite.cases.filter(({ prelude }) => prelude.length > 0).length).toBeGreaterThanOrEqual(3);
    expect(suite.cases.filter(({ category }) => category === "SAFETY_BOUNDARY").length).toBeGreaterThanOrEqual(2);
  });

  it("gives every question five case-specific natural-language quality criteria", () => {
    const { suite } = loadTutorQualitySuite(qualitySuitePath);

    for (const qualityCase of suite.cases) {
      for (const dimension of TUTOR_QUALITY_DIMENSION_IDS) {
        const criterion = qualityCase.rubric[dimension];
        expect(criterion.length, `${qualityCase.id}:${dimension}`).toBeGreaterThanOrEqual(24);
        expect(criterion, `${qualityCase.id}:${dimension}`).toMatch(/[，。；：]/u);
      }
      expect(qualityCase.rubric.executableFirstStep, qualityCase.id).toMatch(/第一步|先|立即/u);
      expect(qualityCase.rubric.executableFirstStep, qualityCase.id).toMatch(/观察|看到|确认|记录|成功/u);
      expect(qualityCase.rubric.followUpJudgment, qualityCase.id).toMatch(/追问|问题|无需/u);
      expect(qualityCase.rubric.sourceAndUncertainty, qualityCase.id).toMatch(
        /来源|课程|资料|通用|不确定|可核对|计算结果/u,
      );
    }
  });

  it("binds the visual-quality case to a deterministic synthetic artwork fixture", async () => {
    const { suite } = loadTutorQualitySuite(qualitySuitePath);
    const artworkCases = suite.cases.filter(({ artworkFixture }) => artworkFixture);
    expect(artworkCases).toHaveLength(1);
    const artworkCase = artworkCases[0];
    const fixture = artworkCase.artworkFixture!;
    const fixtureRoot = `${path.resolve("tests/tutor-quality/fixtures")}${path.sep}`;
    const fixturePath = path.resolve(fixture.path);
    expect(fixturePath.startsWith(fixtureRoot)).toBe(true);
    const bytes = readFileSync(fixturePath);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ format: "png", width: fixture.width, height: fixture.height });
    expect(fixture.mimeType).toBe("image/png");
    expect(fixture.expectedVisibleFacts.length).toBeGreaterThanOrEqual(2);

    expect(suite.cases.find(({ id }) => id === "v3-web-ceramic-firing")?.webSearchConsent).toBe(true);
    expect(suite.cases.filter(({ id }) => id !== "v3-web-ceramic-firing")
      .every(({ webSearchConsent }) => !webSearchConsent)).toBe(true);
  });

  it("uses a canonical content hash and rejects stale versions or unversioned rubric changes", () => {
    const raw = readFileSync(qualitySuitePath, "utf8");
    const directory = mkdtempSync(path.join(tmpdir(), "tonggan-tutor-quality-"));
    try {
      const lfPath = path.join(directory, "lf.json");
      const crlfPath = path.join(directory, "crlf.json");
      writeFileSync(lfPath, raw.replace(/\r\n/g, "\n"), "utf8");
      writeFileSync(crlfPath, raw.replace(/\r?\n/g, "\r\n"), "utf8");
      expect(loadTutorQualitySuite(lfPath).suiteHash).toBe(CURRENT_TUTOR_QUALITY_SUITE_HASH);
      expect(loadTutorQualitySuite(crlfPath).suiteHash).toBe(CURRENT_TUTOR_QUALITY_SUITE_HASH);

      const changed = JSON.parse(raw);
      changed.cases[0].rubric.specificityAndUsefulness += " 未提升版本的修改。";
      const changedPath = path.join(directory, "changed.json");
      writeFileSync(changedPath, JSON.stringify(changed), "utf8");
      expect(() => loadTutorQualitySuite(changedPath)).toThrow("TUTOR_QUALITY_SUITE_HASH_MISMATCH");

      const staleSuite = JSON.parse(raw);
      staleSuite.version = "2099-01-01.1";
      const staleSuitePath = path.join(directory, "stale-suite.json");
      writeFileSync(staleSuitePath, JSON.stringify(staleSuite), "utf8");
      expect(() => loadTutorQualitySuite(staleSuitePath)).toThrow("TUTOR_QUALITY_SUITE_VERSION_NOT_UPDATED");

      const staleRubric = JSON.parse(raw);
      staleRubric.rubricVersion = "2099-01-01.1";
      const staleRubricPath = path.join(directory, "stale-rubric.json");
      writeFileSync(staleRubricPath, JSON.stringify(staleRubric), "utf8");
      expect(() => loadTutorQualitySuite(staleRubricPath)).toThrow("TUTOR_QUALITY_SUITE_VERSION_NOT_UPDATED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("defines the three zero-tolerance hard failures and rejects invalid lineage or duplicate ids", () => {
    const { suite } = loadTutorQualitySuite(qualitySuitePath);
    expect(new Set(suite.hardFailures.map(({ id }) => id))).toEqual(
      new Set(TUTOR_QUALITY_HARD_FAILURE_IDS),
    );

    const duplicate = structuredClone(suite);
    duplicate.cases[1].id = duplicate.cases[0].id;
    expect(TutorQualitySuiteSchema.safeParse(duplicate).success).toBe(false);

    const missingSource = structuredClone(suite);
    delete missingSource.cases.find(({ origin }) => origin === "EXISTING_STRUCTURAL_EVAL")!.sourceCaseId;
    expect(TutorQualitySuiteSchema.safeParse(missingSource).success).toBe(false);

    const falseSource = structuredClone(suite);
    falseSource.cases.find(({ origin }) => origin === "SIMULATED_STUDENT")!.sourceCaseId = "made-up-source";
    expect(TutorQualitySuiteSchema.safeParse(falseSource).success).toBe(false);
  });
});

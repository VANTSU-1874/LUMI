# Tonggan Agent MVP Implementation Plan

> **⚠️ Superseded (2026-07-18)**: This plan targeted the original "Tonggan Ladder" gated course agent, which has been replaced by **Lumi 鹿鸣** (a visual-communication-major design tutor). Much of this plan was executed and then evolved on `feature/tonggan-mvp` (V1–V3, answer gates removed). Kept for historical reference only. Current design: [2026-07-18-lumi-design-tutor-design.md](../specs/2026-07-18-lumi-design-tutor-design.md); rationale: [ADR-0001](../../adr/0001-pivot-to-general-design-tutor.md). New implementation planning should start from the spec's "能力现状与缺口" section, not from this file.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a public course-agent website in which a student completes diagnosis, six-element interaction logic, tool-path planning, evidence-based troubleshooting, and a transfer challenge, while a teacher can review class learning evidence.

**Architecture:** Use one full-stack Next.js TypeScript application as the deployable unit. Keep course rules deterministic in domain services, place model calls behind a replaceable OpenAI-compatible adapter, persist structured evidence in SQLite through Drizzle ORM, and render separate student and teacher workspaces over the same service layer.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, Zod, Drizzle ORM, SQLite/better-sqlite3, Vitest, Testing Library, Playwright, pnpm, OpenAI-compatible HTTP API.

---

## Scope

This plan implements one coherent competition MVP. It excludes TouchDesigner desktop control, automatic project-file editing, live camera analysis, a WeChat mini program, multi-school tenancy, and academic-system integration.

## File map

- app/: pages and thin API routes.
- components/student/: diagnosis, logic card, evidence, troubleshooting, and transfer UI.
- components/teacher/: class overview, misconception summary, and learner detail.
- lib/domain/: schemas, stages, validation, and rubrics.
- lib/db/: SQLite schema, connection, migrations, and repositories.
- lib/auth/: signed sessions and role checks.
- lib/ai/: replaceable model client, structured parsing, and prompts.
- lib/knowledge/: curated retrieval with source attribution.
- lib/services/: application use cases.
- data/: diagnostic questions, knowledge sources, and labeled demo cases.
- scripts/: migration, reset, and deterministic seed helpers.
- tests/: unit, integration, and browser tests.
- docs/runbooks/: local operation, deployment, and competition smoke tests.

### Task 1: Scaffold the application and test harness

**Files:**
- Create: package.json
- Create: app/layout.tsx
- Create: app/page.tsx
- Create: app/globals.css
- Create: lib/config/env.ts
- Create: vitest.config.ts
- Create: tests/setup.ts
- Create: tests/unit/env.test.ts
- Create: playwright.config.ts
- Create: .env.example

- [ ] **Step 1: Generate the Next.js shell**

Run:

~~~powershell
pnpm create next-app@latest tonggan-temp --ts --tailwind --eslint --app --src-dir=false --use-pnpm --import-alias "@/*"
Copy-Item -Recurse -Force .\tonggan-temp\app .\app
Copy-Item -Force .\tonggan-temp\package.json,.\tonggan-temp\tsconfig.json,.\tonggan-temp\next.config.* ,.\tonggan-temp\postcss.config.* ,.\tonggan-temp\eslint.config.* .
Remove-Item -Recurse -Force .\tonggan-temp
pnpm add zod drizzle-orm better-sqlite3 jose
pnpm add -D drizzle-kit @types/better-sqlite3 vitest jsdom @testing-library/react @testing-library/jest-dom @playwright/test tsx
~~~

Expected: package.json, app/, tsconfig.json, and pnpm-lock.yaml exist.

- [ ] **Step 2: Add deterministic scripts**

Set package.json scripts to:

~~~json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx lib/db/migrate.ts",
  "db:seed": "tsx scripts/seed-demo.ts",
  "db:reset": "tsx scripts/reset-db.ts"
}
~~~

- [ ] **Step 3: Write the failing environment test**

Create tests/unit/env.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { readEnv } from "@/lib/config/env";

describe("readEnv", () => {
  it("requires a long session secret", () => {
    expect(() => readEnv({ SESSION_SECRET: "short" })).toThrow("SESSION_SECRET");
  });
  it("supports deterministic fallback without an AI provider", () => {
    expect(readEnv({ SESSION_SECRET: "x".repeat(32) }).ai.enabled).toBe(false);
  });
});
~~~

- [ ] **Step 4: Run the failing test**

Run: pnpm test -- tests/unit/env.test.ts

Expected: FAIL because lib/config/env.ts does not exist.

- [ ] **Step 5: Implement environment parsing**

Create lib/config/env.ts:

~~~ts
import { z } from "zod";

const RawEnvSchema = z.object({
  SESSION_SECRET: z.string().min(32),
  DATABASE_PATH: z.string().default("./data/tonggan.sqlite"),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).optional(),
  TEACHER_ACCESS_CODE: z.string().min(8).default("teacher-demo-2026")
});

export function readEnv(source: Record<string, string | undefined>) {
  const raw = RawEnvSchema.parse(source);
  return {
    sessionSecret: raw.SESSION_SECRET,
    databasePath: raw.DATABASE_PATH,
    teacherAccessCode: raw.TEACHER_ACCESS_CODE,
    ai: {
      enabled: Boolean(raw.LLM_BASE_URL && raw.LLM_API_KEY && raw.LLM_MODEL),
      baseUrl: raw.LLM_BASE_URL,
      apiKey: raw.LLM_API_KEY,
      model: raw.LLM_MODEL
    }
  } as const;
}
~~~

Create .env.example:

~~~dotenv
SESSION_SECRET=replace-with-at-least-32-random-characters
DATABASE_PATH=./data/tonggan.sqlite
TEACHER_ACCESS_CODE=replace-with-a-private-teacher-code
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
~~~

- [ ] **Step 6: Configure tests and verify**

Create vitest.config.ts:

~~~ts
import path from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "jsdom", setupFiles: ["./tests/setup.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } }
});
~~~

Create tests/setup.ts:

~~~ts
import "@testing-library/jest-dom/vitest";
~~~

Run:

~~~powershell
pnpm test -- tests/unit/env.test.ts
pnpm build
~~~

Expected: 2 tests PASS and the production build succeeds.

- [ ] **Step 7: Commit**

~~~powershell
git add package.json pnpm-lock.yaml app lib/config vitest.config.ts tests .env.example tsconfig.json next.config.* postcss.config.* eslint.config.*
git commit -m "chore: scaffold Tonggan course agent"
~~~

### Task 2: Define course domain and persistence

**Files:**
- Create: lib/domain/schemas.ts
- Create: lib/domain/stages.ts
- Create: lib/domain/logic-card.ts
- Create: lib/db/schema.ts
- Create: lib/db/client.ts
- Create: lib/db/migrate.ts
- Create: drizzle.config.ts
- Create: tests/unit/logic-card.test.ts
- Create: tests/integration/database.test.ts

- [ ] **Step 1: Write the failing gate test**

Create tests/unit/logic-card.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { validateLogicCard } from "@/lib/domain/logic-card";

const complete = {
  culturalIntent: "通过脸谱变化表现人物情绪",
  participantAction: "观众逐渐靠近屏幕",
  inputSignal: "距离传感器输出0到200厘米",
  mappingRule: "距离越近情绪强度越高",
  outputMedium: "颜色、纹理和声音",
  experienceFeedback: "观众后退时效果平滑回落"
};

describe("six-element gate", () => {
  it("blocks missing mapping", () => {
    const result = validateLogicCard({ ...complete, mappingRule: "" });
    expect(result.ready).toBe(false);
    expect(result.issues).toContain("判断与映射不能为空");
  });
  it("unlocks a complete card", () => {
    expect(validateLogicCard(complete)).toEqual({ ready: true, issues: [] });
  });
});
~~~

- [ ] **Step 2: Implement schemas and gate**

Create lib/domain/schemas.ts:

~~~ts
import { z } from "zod";
export const LogicCardSchema = z.object({
  culturalIntent: z.string(),
  participantAction: z.string(),
  inputSignal: z.string(),
  mappingRule: z.string(),
  outputMedium: z.string(),
  experienceFeedback: z.string()
});
export type LogicCard = z.infer<typeof LogicCardSchema>;
export const LearnerLevelSchema = z.enum(["L1", "L2", "L3", "L4"]);
export type LearnerLevel = z.infer<typeof LearnerLevelSchema>;
export const ToolPathSchema = z.enum(["DIGISHOW", "TOUCHDESIGNER", "COLLABORATIVE"]);
export type ToolPath = z.infer<typeof ToolPathSchema>;
~~~

Create lib/domain/stages.ts:

~~~ts
export const PROJECT_STAGES = ["DIAGNOSTIC", "LOGIC_CARD", "TOOL_PATH", "BUILD", "TROUBLESHOOT", "TRANSFER", "COMPLETE"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];
~~~

Create lib/domain/logic-card.ts:

~~~ts
import { LogicCard, LogicCardSchema } from "./schemas";
const labels: Record<keyof LogicCard, string> = {
  culturalIntent: "文化意图",
  participantAction: "参与行为",
  inputSignal: "输入信号",
  mappingRule: "判断与映射",
  outputMedium: "输出媒介",
  experienceFeedback: "体验反馈"
};
export function validateLogicCard(input: LogicCard) {
  const card = LogicCardSchema.parse(input);
  const issues = Object.entries(card)
    .filter(([, value]) => value.trim().length < 4)
    .map(([key]) => labels[key as keyof LogicCard] + "不能为空");
  return { ready: issues.length === 0, issues };
}
~~~

- [ ] **Step 3: Run the unit test**

Run: pnpm test -- tests/unit/logic-card.test.ts

Expected: 2 tests PASS.

- [ ] **Step 4: Define SQLite tables**

Create lib/db/schema.ts with Drizzle tables:

~~~ts
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const classes = sqliteTable("classes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  accessCode: text("access_code").notNull().unique()
});
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  classId: text("class_id").references(() => classes.id),
  role: text("role", { enum: ["STUDENT", "TEACHER"] }).notNull(),
  alias: text("alias").notNull(),
  createdAt: integer("created_at").notNull()
});
export const learnerProfiles = sqliteTable("learner_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id),
  level: text("level", { enum: ["L1", "L2", "L3", "L4"] }).notNull(),
  decomposition: integer("decomposition").notNull(),
  signalUnderstanding: integer("signal_understanding").notNull(),
  mappingDesign: integer("mapping_design").notNull(),
  troubleshooting: integer("troubleshooting").notNull(),
  transfer: integer("transfer").notNull(),
  updatedAt: integer("updated_at").notNull()
});
export const courseModules = sqliteTable("course_modules", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  sequence: integer("sequence").notNull(),
  title: text("title").notNull(),
  hours: integer("hours").notNull(),
  focus: text("focus").notNull()
});
export const assignments = sqliteTable("assignments", {
  id: text("id").primaryKey(),
  classId: text("class_id").notNull().references(() => classes.id),
  moduleId: text("module_id").notNull().references(() => courseModules.id),
  title: text("title").notNull(),
  brief: text("brief").notNull(),
  allowedTools: text("allowed_tools").notNull(),
  createdAt: integer("created_at").notNull()
});
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id").notNull().references(() => assignments.id),
  studentId: text("student_id").notNull().references(() => users.id),
  stage: text("stage").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});
export const logicCards = sqliteTable("logic_cards", {
  projectId: text("project_id").primaryKey().references(() => projects.id),
  payloadJson: text("payload_json").notNull(),
  ruleReady: integer("rule_ready", { mode: "boolean" }).notNull(),
  semanticReady: integer("semantic_ready", { mode: "boolean" }).notNull(),
  semanticReviewJson: text("semantic_review_json").notNull()
});
export const evidence = sqliteTable("evidence", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  kind: text("kind", { enum: ["TEXT", "IMAGE", "VALUE", "VIDEO_LINK"] }).notNull(),
  label: text("label").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull()
});
export const troubleshootingRuns = sqliteTable("troubleshooting_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  symptom: text("symptom").notNull(),
  currentLayer: text("current_layer").notNull(),
  stateJson: text("state_json").notNull(),
  status: text("status", { enum: ["ACTIVE", "RESOLVED", "ESCALATED"] }).notNull()
});
export const transferChallenges = sqliteTable("transfer_challenges", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  changedDimension: text("changed_dimension").notNull(),
  prompt: text("prompt").notNull(),
  responseJson: text("response_json").notNull(),
  rubricJson: text("rubric_json").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull()
});
export const knowledgeChunks = sqliteTable("knowledge_chunks", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  title: text("title").notNull(),
  tags: text("tags").notNull(),
  content: text("content").notNull()
});
export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: integer("created_at").notNull()
});
~~~

- [ ] **Step 5: Add connection and migration**

Create lib/db/client.ts:

~~~ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
export function createDb(path: string) {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}
~~~

Create drizzle.config.ts and lib/db/migrate.ts to generate and apply migrations to DATABASE_PATH. migration code must create the parent directory, run drizzle-orm/better-sqlite3/migrator, and close the SQLite handle.

- [ ] **Step 6: Generate migration and verify**

Run:

~~~powershell
pnpm db:generate
$env:DATABASE_PATH='.\data\test.sqlite'
pnpm db:migrate
pnpm test
~~~

Expected: migration succeeds and all tests PASS.

- [ ] **Step 7: Commit**

~~~powershell
git add lib/domain lib/db drizzle drizzle.config.ts tests
git commit -m "feat: add course workflow domain and persistence"
~~~

### Task 3: Add class-code entry and signed sessions

**Files:**
- Create: lib/auth/session.ts
- Create: lib/services/access.ts
- Create: app/api/auth/student/route.ts
- Create: app/api/auth/teacher/route.ts
- Create: components/entry/EntryForm.tsx
- Modify: app/page.tsx
- Create: tests/unit/session.test.ts

- [ ] **Step 1: Write signed-session tests**

Create tests/unit/session.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { issueSession, verifySession } from "@/lib/auth/session";
describe("signed session", () => {
  it("round-trips a student", async () => {
    const secret = "s".repeat(32);
    const token = await issueSession({ userId: "u1", role: "STUDENT" }, secret);
    await expect(verifySession(token, secret)).resolves.toMatchObject({ userId: "u1", role: "STUDENT" });
  });
  it("rejects tampering", async () => {
    await expect(verifySession("bad", "s".repeat(32))).rejects.toThrow();
  });
});
~~~

- [ ] **Step 2: Implement signing**

Create lib/auth/session.ts:

~~~ts
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
const SessionSchema = z.object({ userId: z.string().min(1), role: z.enum(["STUDENT", "TEACHER"]) });
const key = (secret: string) => new TextEncoder().encode(secret);
export async function issueSession(payload: z.infer<typeof SessionSchema>, secret: string) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(key(secret));
}
export async function verifySession(token: string, secret: string) {
  const result = await jwtVerify(token, key(secret));
  return SessionSchema.parse(result.payload);
}
~~~

- [ ] **Step 3: Implement access routes and UI**

Student access validates class code and alias, creates or resumes an anonymous learner, signs an HttpOnly SameSite=Lax cookie, and redirects to /student. Teacher access compares the configured teacher code, signs a teacher cookie, and redirects to /teacher. EntryForm has separate student and teacher tabs, inline errors, and disabled pending state.

- [ ] **Step 4: Verify and commit**

Run:

~~~powershell
pnpm test -- tests/unit/session.test.ts
pnpm build
git add lib/auth lib/services/access.ts app/api/auth components/entry app/page.tsx tests/unit/session.test.ts
git commit -m "feat: add class-code entry and signed sessions"
~~~

Expected: tests PASS, build succeeds, commit created.

### Task 4: Implement diagnosis and learner profiles

**Files:**
- Create: data/diagnostic/questions.ts
- Create: lib/services/diagnostic.ts
- Create: app/api/diagnostic/route.ts
- Create: components/student/DiagnosticFlow.tsx
- Create: tests/unit/diagnostic.test.ts

- [ ] **Step 1: Write scoring tests**

Create tests/unit/diagnostic.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { scoreDiagnostic } from "@/lib/services/diagnostic";
const answer = (score: number, transfer = score) => [
  { dimension: "decomposition" as const, score },
  { dimension: "signalUnderstanding" as const, score },
  { dimension: "mappingDesign" as const, score },
  { dimension: "troubleshooting" as const, score },
  { dimension: "transfer" as const, score: transfer }
];
describe("scoreDiagnostic", () => {
  it("returns L1 for weak dimensions", () => expect(scoreDiagnostic(answer(1)).level).toBe("L1"));
  it("returns L4 only for excellent transfer", () => expect(scoreDiagnostic(answer(4)).level).toBe("L4"));
  it("does not award L3 when transfer is weak", () => expect(scoreDiagnostic(answer(4, 1)).level).toBe("L2"));
});
~~~

- [ ] **Step 2: Implement deterministic scoring**

Create lib/services/diagnostic.ts:

~~~ts
type Dimension = "decomposition" | "signalUnderstanding" | "mappingDesign" | "troubleshooting" | "transfer";
type AnswerScore = { dimension: Dimension; score: number };
export function scoreDiagnostic(items: AnswerScore[]) {
  const values = Object.fromEntries(items.map((item) => [item.dimension, item.score])) as Record<Dimension, number>;
  const average = Object.values(values).reduce((sum, value) => sum + value, 0) / 5;
  const level = average >= 3.8 && values.transfer >= 4
    ? "L4"
    : average >= 3.2 && values.transfer >= 3
      ? "L3"
      : average >= 2.2
        ? "L2"
        : "L1";
  return { ...values, level };
}
~~~

- [ ] **Step 3: Create questions, route, and UI**

Create 10 scenario questions, two per dimension, covering distance-to-visual mapping, one-shot triggers, unstable sensors, a broken OSC chain, and replacing distance with sound. POST /api/diagnostic validates all answers, upserts learnerProfiles, records an audit event, and returns the five scores plus level. DiagnosticFlow displays one scenario per screen, progress, choices, and a final profile without peer rankings.

- [ ] **Step 4: Verify and commit**

~~~powershell
pnpm test -- tests/unit/diagnostic.test.ts
pnpm build
git add data/diagnostic lib/services/diagnostic.ts app/api/diagnostic components/student/DiagnosticFlow.tsx tests/unit/diagnostic.test.ts
git commit -m "feat: add interaction-learning diagnosis"
~~~

Expected: tests PASS, build succeeds, commit created.

### Task 5: Enforce the six-element gate and choose a tool path

**Files:**
- Create: lib/services/project-workflow.ts
- Create: lib/services/tool-path.ts
- Create: app/api/projects/[projectId]/logic-card/route.ts
- Create: app/api/projects/[projectId]/tool-path/route.ts
- Create: components/student/LogicCardForm.tsx
- Create: components/student/ToolPathPlan.tsx
- Create: tests/unit/project-workflow.test.ts
- Create: tests/unit/tool-path.test.ts

- [ ] **Step 1: Write stage and path tests**

Create tests/unit/project-workflow.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { nextStageAfterLogicReview } from "@/lib/services/project-workflow";
describe("logic-card gate", () => {
  it("stays locked when semantic review fails", () => {
    expect(nextStageAfterLogicReview(true, false)).toBe("LOGIC_CARD");
  });
  it("unlocks only after both reviews pass", () => {
    expect(nextStageAfterLogicReview(true, true)).toBe("TOOL_PATH");
  });
});
~~~

Create tests/unit/tool-path.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { chooseToolPath } from "@/lib/services/tool-path";
describe("chooseToolPath", () => {
  it("chooses collaboration for physical control plus realtime visuals", () => {
    expect(chooseToolPath({ level: "L2", needsPhysicalControl: true, needsRealtimeVisuals: true, hasOsc: true }).path).toBe("COLLABORATIVE");
  });
  it("starts L1 students with DigiShow", () => {
    expect(chooseToolPath({ level: "L1", needsPhysicalControl: false, needsRealtimeVisuals: true, hasOsc: false }).path).toBe("DIGISHOW");
  });
});
~~~

- [ ] **Step 2: Implement deterministic transitions and path rules**

Create lib/services/project-workflow.ts:

~~~ts
import { ProjectStage } from "@/lib/domain/stages";
export function nextStageAfterLogicReview(ruleReady: boolean, semanticReady: boolean): ProjectStage {
  return ruleReady && semanticReady ? "TOOL_PATH" : "LOGIC_CARD";
}
export function canEnterTransfer(stage: ProjectStage, evidenceCount: number) {
  return (stage === "BUILD" || stage === "TROUBLESHOOT") && evidenceCount >= 3;
}
~~~

Create lib/services/tool-path.ts:

~~~ts
import { LearnerLevel, ToolPath } from "@/lib/domain/schemas";
type Input = { level: LearnerLevel; needsRealtimeVisuals: boolean; needsPhysicalControl: boolean; hasOsc: boolean };
export function chooseToolPath(input: Input): { path: ToolPath; reasons: string[] } {
  if (input.needsPhysicalControl && input.needsRealtimeVisuals && input.hasOsc) {
    return { path: "COLLABORATIVE", reasons: ["需要设备控制", "需要实时视觉", "可通过OSC协同"] };
  }
  if (input.needsPhysicalControl || input.level === "L1") {
    return { path: "DIGISHOW", reasons: ["优先建立输入、映射和输出认知"] };
  }
  return { path: "TOUCHDESIGNER", reasons: ["项目重点为实时视觉表达"] };
}
~~~

- [ ] **Step 3: Persist semantic review and block bypasses**

The logic-card route validates the six fields, runs deterministic validation, then calls semantic review when AI is available. When AI is unavailable, semanticReady remains false until the student uses a teacher-approved demonstration card or a teacher confirms it. Store ruleReady, semanticReady, and review evidence. Change the project stage only through nextStageAfterLogicReview.

- [ ] **Step 4: Build the gated UI**

LogicCardForm displays six fields and field-specific issues. ToolPathPlan is inaccessible until stage TOOL_PATH. The plan shows selected path, reasons, milestones, and required evidence. Direct navigation to a later route returns the current valid stage.

- [ ] **Step 5: Verify and commit**

~~~powershell
pnpm test -- tests/unit/project-workflow.test.ts tests/unit/tool-path.test.ts tests/unit/logic-card.test.ts
pnpm build
git add lib/services/project-workflow.ts lib/services/tool-path.ts app/api/projects components/student/LogicCardForm.tsx components/student/ToolPathPlan.tsx tests/unit
git commit -m "feat: enforce interaction logic before tool planning"
~~~

Expected: gate and path tests PASS, build succeeds, commit created.

### Task 6: Add grounded AI, curated retrieval, and three-level hints

**Files:**
- Create: lib/ai/client.ts
- Create: lib/ai/structured.ts
- Create: lib/ai/prompts.ts
- Create: lib/knowledge/retrieve.ts
- Create: lib/services/hints.ts
- Create: data/knowledge/course-principles.md
- Create: data/knowledge/digishow-signals.md
- Create: data/knowledge/touchdesigner-foundations.md
- Create: data/knowledge/troubleshooting.md
- Create: tests/unit/retrieve.test.ts
- Create: tests/unit/hints.test.ts

- [ ] **Step 1: Write retrieval and hint tests**

Create tests/unit/retrieve.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { rankKnowledge } from "@/lib/knowledge/retrieve";
describe("rankKnowledge", () => {
  it("returns OSC material first", () => {
    const items = [
      { id: "osc", title: "OSC连接", tags: ["OSC", "DigiShow"], content: "检查地址和端口" },
      { id: "color", title: "颜色", tags: ["视觉"], content: "颜色映射" }
    ];
    expect(rankKnowledge("DigiShow OSC 收不到", items)[0].id).toBe("osc");
  });
});
~~~

Create tests/unit/hints.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { allowedHintLevel } from "@/lib/services/hints";
describe("allowedHintLevel", () => {
  it("starts with questions only", () => expect(allowedHintLevel(0, false)).toBe(1));
  it("requires new evidence before level three", () => {
    expect(allowedHintLevel(2, false)).toBe(2);
    expect(allowedHintLevel(2, true)).toBe(3);
  });
});
~~~

- [ ] **Step 2: Implement deterministic retrieval and hint gates**

Create lib/knowledge/retrieve.ts:

~~~ts
export type KnowledgeItem = { id: string; title: string; tags: string[]; content: string };
const tokens = (value: string) => Array.from(new Set(value.toLowerCase().split(/[\s,，。:：/]+/).filter((part) => part.length > 1)));
export function rankKnowledge(query: string, items: KnowledgeItem[]) {
  const queryTokens = tokens(query);
  return items
    .map((item) => {
      const text = (item.title + " " + item.tags.join(" ") + " " + item.content).toLowerCase();
      return { ...item, score: queryTokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
~~~

Create lib/services/hints.ts:

~~~ts
export function allowedHintLevel(previousRequests: number, hasNewEvidence: boolean): 1 | 2 | 3 {
  if (previousRequests === 0) return 1;
  if (previousRequests >= 2 && hasNewEvidence) return 3;
  return 2;
}
~~~

- [ ] **Step 3: Implement a replaceable model client**

Create lib/ai/client.ts:

~~~ts
export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };
export type ModelClient = { complete(messages: ModelMessage[]): Promise<string> };
export function createModelClient(config: { baseUrl: string; apiKey: string; model: string }): ModelClient {
  return {
    async complete(messages) {
      const response = await fetch(config.baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + config.apiKey },
        body: JSON.stringify({ model: config.model, temperature: 0.2, messages })
      });
      if (!response.ok) throw new Error("模型服务暂时不可用");
      const body = await response.json();
      return body.choices?.[0]?.message?.content ?? "";
    }
  };
}
~~~

Create lib/ai/structured.ts:

~~~ts
import { z } from "zod";
import { ModelClient, ModelMessage } from "./client";
export async function completeJson<T>(client: ModelClient, messages: ModelMessage[], schema: z.ZodType<T>) {
  const raw = (await client.complete(messages)).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型没有返回JSON对象");
  return schema.parse(JSON.parse(raw.slice(start, end + 1)));
}
~~~

- [ ] **Step 4: Write prompts and curated sources**

Prompts must require source titles, separate confirmed facts from hypotheses, prohibit claims of inspecting unprovided files, and obey the allowed hint level. Knowledge Markdown files contain source title, URL or local document, verified date, scope, and concise operational summaries. Do not copy long passages.

- [ ] **Step 5: Verify fallback and commit**

~~~powershell
pnpm test -- tests/unit/retrieve.test.ts tests/unit/hints.test.ts
$env:SESSION_SECRET='x1234567890123456789012345678901'
Remove-Item Env:LLM_API_KEY -ErrorAction SilentlyContinue
pnpm build
git add lib/ai lib/knowledge lib/services/hints.ts data/knowledge tests/unit
git commit -m "feat: add grounded model guidance and hint levels"
~~~

Expected: tests PASS and the build succeeds with AI disabled.

### Task 7: Add evidence capture and signal-chain troubleshooting

**Files:**
- Create: lib/services/evidence.ts
- Create: lib/services/troubleshooting.ts
- Create: app/api/projects/[projectId]/evidence/route.ts
- Create: app/api/projects/[projectId]/troubleshooting/route.ts
- Create: components/student/EvidencePanel.tsx
- Create: components/student/TroubleshootingFlow.tsx
- Create: tests/unit/troubleshooting.test.ts

- [ ] **Step 1: Write signal-chain tests**

Create tests/unit/troubleshooting.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { nextTroubleshootingStep } from "@/lib/services/troubleshooting";
describe("signal-chain troubleshooting", () => {
  it("asks for input evidence first", () => {
    const result = nextTroubleshootingStep({ evidence: [] });
    expect(result.layer).toBe("INPUT");
    expect(result.request).toContain("输入值");
  });
  it("moves to transport after input and mapping", () => {
    expect(nextTroubleshootingStep({ evidence: ["INPUT_OK", "MAPPING_OK"] }).layer).toBe("TRANSPORT");
  });
});
~~~

- [ ] **Step 2: Implement the deterministic spine**

Create lib/services/troubleshooting.ts:

~~~ts
type Code = "INPUT_OK" | "MAPPING_OK" | "TRANSPORT_OK" | "BINDING_OK" | "OUTPUT_OK";
export function nextTroubleshootingStep(input: { evidence: Code[] }) {
  if (!input.evidence.includes("INPUT_OK")) return { layer: "INPUT", request: "请提供靠近与远离时的输入值或截图。" };
  if (!input.evidence.includes("MAPPING_OK")) return { layer: "MAPPING", request: "请提供映射前后数值范围。" };
  if (!input.evidence.includes("TRANSPORT_OK")) return { layer: "TRANSPORT", request: "请提供OSC地址、端口和接收值。" };
  if (!input.evidence.includes("BINDING_OK")) return { layer: "BINDING", request: "请确认接收值是否绑定到目标参数。" };
  return { layer: "OUTPUT", request: "请检查目标参数是否被其他节点或状态覆盖。" };
}
~~~

- [ ] **Step 3: Add safe evidence and routes**

Accept PNG, JPEG, WebP, text, numeric values, and external video links. Limit images to 5 MB, replace filenames with UUIDs, reject SVG and executable formats, and store relative paths only. Troubleshooting always advances through deterministic layers before optional AI interpretation. After three cycles without new evidence, mark ESCALATED and request teacher review.

- [ ] **Step 4: Build the UI**

EvidencePanel supports clipboard paste, file selection, numeric entry, and labels. TroubleshootingFlow shows confirmed facts, current layer, one next action, unconfirmed hypotheses, and escalation state.

- [ ] **Step 5: Verify and commit**

~~~powershell
pnpm test -- tests/unit/troubleshooting.test.ts
pnpm build
git add lib/services/evidence.ts lib/services/troubleshooting.ts app/api/projects components/student/EvidencePanel.tsx components/student/TroubleshootingFlow.tsx tests/unit/troubleshooting.test.ts
git commit -m "feat: add evidence-based signal troubleshooting"
~~~

Expected: tests PASS, build succeeds, commit created.

### Task 8: Add transfer challenges and rubric scoring

**Files:**
- Create: lib/services/transfer.ts
- Create: app/api/projects/[projectId]/transfer/route.ts
- Create: components/student/TransferChallenge.tsx
- Create: tests/unit/transfer.test.ts

- [ ] **Step 1: Write transfer tests**

Create tests/unit/transfer.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { createDeterministicChallenge, scoreTransferResponse } from "@/lib/services/transfer";
describe("transfer challenge", () => {
  it("changes one dimension", () => {
    expect(createDeterministicChallenge("distance", "visual").changedDimension).toBe("input");
  });
  it("requires retained structure and changed normalization", () => {
    const result = scoreTransferResponse({
      retainedStructure: "保留文化意图、映射和视觉输出",
      changedParts: "将距离输入换成声音输入",
      normalization: "把分贝范围归一化到0到1",
      culturalImpact: "声音参与强化共同表演感"
    });
    expect(result.passed).toBe(true);
  });
});
~~~

- [ ] **Step 2: Implement challenge and rubric**

Create lib/services/transfer.ts:

~~~ts
export function createDeterministicChallenge(input: string, output: string) {
  if (input === "distance") return { changedDimension: "input", prompt: "保留现有结构和" + output + "输出，把距离输入改为声音输入。" };
  return { changedDimension: "mapping", prompt: "保留输入和输出，把连续映射改为三个离散状态。" };
}
export function scoreTransferResponse(input: {
  retainedStructure: string; changedParts: string; normalization: string; culturalImpact: string;
}) {
  const criteria = {
    retainedStructure: input.retainedStructure.trim().length >= 8,
    changedParts: input.changedParts.trim().length >= 8,
    normalization: /归一化|范围|0到1|阈值/.test(input.normalization),
    culturalImpact: input.culturalImpact.trim().length >= 8
  };
  const score = Object.values(criteria).filter(Boolean).length;
  return { criteria, score, passed: score >= 3 };
}
~~~

- [ ] **Step 3: Add route and UI**

The route computes the deterministic rubric first. AI may add coherence feedback but cannot pass fewer than three deterministic criteria. Persist changed dimension, prompt, structured response, rubric, and status. TransferChallenge renders four response fields, one retry, and updates the learner transfer dimension only after pass.

- [ ] **Step 4: Verify and commit**

~~~powershell
pnpm test -- tests/unit/transfer.test.ts
pnpm build
git add lib/services/transfer.ts app/api/projects components/student/TransferChallenge.tsx tests/unit/transfer.test.ts
git commit -m "feat: add structured transfer challenges"
~~~

Expected: tests PASS, build succeeds, commit created.

### Task 9: Assemble the student workbench

**Files:**
- Modify: app/student/page.tsx
- Create: app/api/student/dashboard/route.ts
- Create: components/student/StudentShell.tsx
- Create: components/student/StageRail.tsx
- Create: components/student/ProfileCard.tsx
- Create: components/student/CurrentProject.tsx
- Create: tests/e2e/student-flow.spec.ts

- [ ] **Step 1: Write the failing browser flow**

Create tests/e2e/student-flow.spec.ts:

~~~ts
import { expect, test } from "@playwright/test";
test("student cannot skip the logic card", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "学生" }).click();
  await page.getByLabel("班级邀请码").fill("DIGI2026");
  await page.getByLabel("匿名编号").fill("S01");
  await page.getByRole("button", { name: "进入课程" }).click();
  await expect(page).toHaveURL(/student/);
  await expect(page.getByText("六元交互逻辑")).toBeVisible();
  await expect(page.getByText("工具路径")).toHaveAttribute("aria-disabled", "true");
});
~~~

- [ ] **Step 2: Build one dashboard query**

GET /api/student/dashboard returns profile, the current 64-hour course module, assignment, project stage, logic card, path plan, evidence summary, active troubleshooting run, and transfer challenge. Do not issue independent component queries that can display inconsistent stages.

- [ ] **Step 3: Build the workbench**

StudentShell contains anonymous identity, StageRail, project details, active workflow, and responsive mobile stacking. Do not expose an unrestricted blank chat box. Every AI action originates from the active course step. Returning students resume their stored stage.

- [ ] **Step 4: Verify and commit**

~~~powershell
pnpm db:reset
pnpm db:seed
pnpm test:e2e -- tests/e2e/student-flow.spec.ts
git add app/student app/api/student components/student tests/e2e/student-flow.spec.ts
git commit -m "feat: assemble the student project workbench"
~~~

Expected: the browser test passes and the student cannot bypass the stage gate.

### Task 10: Build the teacher analysis workspace

**Files:**
- Create: lib/services/analytics.ts
- Create: app/api/teacher/dashboard/route.ts
- Create: app/teacher/page.tsx
- Create: components/teacher/ClassOverview.tsx
- Create: components/teacher/MisconceptionPanel.tsx
- Create: components/teacher/LearnerDetail.tsx
- Create: tests/unit/analytics.test.ts
- Create: tests/e2e/teacher-flow.spec.ts

- [ ] **Step 1: Write the analytics test**

Create tests/unit/analytics.test.ts:

~~~ts
import { describe, expect, it } from "vitest";
import { summarizeClass } from "@/lib/services/analytics";
describe("summarizeClass", () => {
  it("counts stages, issues, and high-support learners", () => {
    const result = summarizeClass([
      { stage: "LOGIC_CARD", issues: ["判断与映射不能为空"], hintLevel: 2 },
      { stage: "BUILD", issues: ["OSC地址错误"], hintLevel: 3 }
    ]);
    expect(result.stageCounts.LOGIC_CARD).toBe(1);
    expect(result.misconceptions[0].count).toBe(1);
    expect(result.highSupportStudents).toBe(1);
  });
});
~~~

- [ ] **Step 2: Implement actionable aggregation**

Create lib/services/analytics.ts:

~~~ts
export function summarizeClass(rows: Array<{ stage: string; issues: string[]; hintLevel: number }>) {
  const stageCounts: Record<string, number> = {};
  const issueCounts: Record<string, number> = {};
  let highSupportStudents = 0;
  for (const row of rows) {
    stageCounts[row.stage] = (stageCounts[row.stage] ?? 0) + 1;
    for (const issue of row.issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
    if (row.hintLevel >= 3) highSupportStudents += 1;
  }
  const misconceptions = Object.entries(issueCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  return { stageCounts, misconceptions, highSupportStudents };
}
~~~

- [ ] **Step 3: Build API, UI, and teacher override**

The dashboard returns stage counts, five-dimensional profiles, logic-card issues, troubleshooting layers, hint dependence, transfer completion, source counts, and timestamps. The UI labels demonstration and real learners separately. LearnerDetail preserves the original AI result and stores teacher decisions as confirmed, corrected, or needs review; it never overwrites history.

- [ ] **Step 4: Verify and commit**

~~~powershell
pnpm test -- tests/unit/analytics.test.ts
pnpm test:e2e -- tests/e2e/teacher-flow.spec.ts
pnpm build
git add lib/services/analytics.ts app/api/teacher app/teacher components/teacher tests/unit/analytics.test.ts tests/e2e/teacher-flow.spec.ts
git commit -m "feat: add teacher learning analytics"
~~~

Expected: unit and browser tests PASS, build succeeds, commit created.

### Task 11: Seed truthful demonstration cases and fallback mode

**Files:**
- Create: data/demo/cases.ts
- Create: scripts/seed-demo.ts
- Create: scripts/reset-db.ts
- Create: components/common/DemoBadge.tsx
- Create: tests/integration/demo-seed.test.ts

- [ ] **Step 1: Define three demonstration cases**

Create:

1. DigiShow-only: distance input controls three lighting states.
2. TouchDesigner-only: audio amplitude controls particle density.
3. Collaborative: DigiShow normalizes distance and sends OSC to TouchDesigner for a cultural visual.

Each case contains a weak initial idea, approved six-element card, three evidence records, one injected fault, expected troubleshooting layer, and one transfer challenge. Every record carries dataType DEMONSTRATION_DATA.

- [ ] **Step 2: Implement deterministic seed and guarded reset**

seed-demo.ts creates class code DIGI2026, one teacher, four profiles, the four approved course modules with 8, 16, 24, and 16 hours, one assignment, and the three cases with fixed IDs. Re-running does not duplicate rows. reset-db.ts refuses to run unless DATABASE_PATH contains dev, test, or demo, then deletes the SQLite file and runs migrations.

- [ ] **Step 3: Label demonstration data everywhere**

DemoBadge appears on seeded learner details, evidence, analytics, and demo accounts. Teacher analytics exclude demo data by default and require an explicit filter to include it.

- [ ] **Step 4: Verify and commit**

~~~powershell
$env:DATABASE_PATH='.\data\demo.sqlite'
pnpm db:reset
pnpm db:seed
pnpm db:seed
pnpm test -- tests/integration/demo-seed.test.ts
git add data/demo scripts components/common/DemoBadge.tsx tests/integration/demo-seed.test.ts
git commit -m "feat: add labeled competition demonstration cases"
~~~

Expected: the second seed creates no duplicates and the test passes.

### Task 12: Add privacy, accessibility, and resilient errors

**Files:**
- Create: lib/security/uploads.ts
- Create: lib/security/redaction.ts
- Create: app/privacy/page.tsx
- Create: app/api/evidence/[evidenceId]/route.ts
- Create: app/global-error.tsx
- Create: tests/unit/uploads.test.ts
- Create: tests/unit/redaction.test.ts
- Create: tests/e2e/accessibility.spec.ts

- [ ] **Step 1: Write security tests**

Tests verify executable and SVG rejection; PNG, JPEG, and WebP acceptance under 5 MB; UUID filenames; phone, email, and configured student-number masking; and deletion of both file and database record.

- [ ] **Step 2: Implement upload policy and redaction**

Use a MIME allowlist, 5 MB limit, random stored names, and a protected streaming route. Store relative paths only. Redact phone, email, and student-number patterns before material enters the knowledge base. Do not accept face video in the MVP.

- [ ] **Step 3: Add privacy and error behavior**

The privacy page states collection purpose, retention, teacher access, AI-provider transfer, and deletion. Students and teachers can delete authorized evidence. If AI fails, preserve entered cards and evidence, continue deterministic rules, and mark semantic review pending rather than passing automatically.

- [ ] **Step 4: Verify keyboard and screen-reader basics**

The Playwright test covers entry, diagnosis, logic-card fields, uploads, errors, teacher tables, landmark roles, accessible names, focus order, and disabled stage controls.

- [ ] **Step 5: Verify and commit**

~~~powershell
pnpm test -- tests/unit/uploads.test.ts tests/unit/redaction.test.ts
pnpm test:e2e -- tests/e2e/accessibility.spec.ts
pnpm build
git add lib/security app/privacy app/api/evidence app/global-error.tsx tests
git commit -m "feat: add privacy and resilient error handling"
~~~

Expected: security and accessibility tests PASS, build succeeds, commit created.

### Task 13: Document local operation and public deployment

**Files:**
- Create: README.md
- Create: docs/runbooks/local-development.md
- Create: docs/runbooks/deployment.md
- Create: docs/runbooks/competition-smoke-test.md
- Create: app/api/health/route.ts
- Create: scripts/generate-qr.ts

- [ ] **Step 1: Write local runbook**

Document:

~~~powershell
Copy-Item .env.example .env.local
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
~~~

Include stop instructions, reset guard, demo class code, teacher-code configuration, unit tests, browser tests, lint, and production build.

- [ ] **Step 2: Write deployment runbook**

Specify one Node.js service with HTTPS, persistent storage for SQLite and uploads, secrets outside Git, daily backup, health check, model timeout, restart command, and rollback to the previous Git commit. Do not select a vendor until hosting is confirmed. Note that mainland hosting may require domain filing, so the prototype must use a host that can be activated before submission.

- [ ] **Step 3: Add health endpoint**

GET /api/health returns application status, database availability, knowledge-chunk count, and whether AI is configured. It never returns secret values or student data.

- [ ] **Step 4: Write competition smoke test**

Check:

1. HTTPS page loads.
2. Student demo entry works.
3. Logic gate blocks skipping.
4. Screenshot upload works.
5. Fallback mode works without AI.
6. Teacher dashboard labels demo data.
7. QR resolves to the public URL.

- [ ] **Step 5: Generate QR after URL selection**

scripts/generate-qr.ts requires PUBLIC_APP_URL, rejects non-HTTPS URLs, and writes public/competition-qr.svg. Scan the rendered QR from a second device.

- [ ] **Step 6: Verify and commit**

~~~powershell
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
git add README.md docs/runbooks app/api/health scripts/generate-qr.ts public/competition-qr.svg
git commit -m "docs: add deployment and competition runbooks"
~~~

Expected: all checks PASS and the operational commit is created.

### Task 14: Run the final release audit

**Files:**
- Create: docs/release/competition-mvp-checklist.md
- Modify: docs/superpowers/specs/2026-07-11-digital-interaction-course-agent-design.md only if implementation proves a design correction

- [ ] **Step 1: Map every specification requirement**

The release checklist links each requirement to a route, UI page, automated test, or runbook. Cover role entry, diagnosis, six-element gate, three tool paths, three hint levels, evidence, troubleshooting, transfer, teacher override, demo labels, privacy, fallback, public link, and QR.

- [ ] **Step 2: Confirm excluded scope stayed excluded**

Search for desktop automation, automatic project-file generation, live camera ingestion, mini-program code, and multi-school administration. Remove accidental expansion.

- [ ] **Step 3: Rehearse the 10-minute demonstration**

Record actual timings for problem statement, diagnosis, six-element logic, collaborative path, troubleshooting, transfer, and teacher analytics. Every displayed number must trace to labeled demonstration or historical-case data.

- [ ] **Step 4: Run final verification**

~~~powershell
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
git status --short
git log --oneline -15
~~~

Expected: all checks PASS, the worktree is clean, and history shows focused commits.

- [ ] **Step 5: Tag the release**

~~~powershell
git tag -a competition-mvp-v1 -m "Verified Tonggan competition MVP"
git show --stat competition-mvp-v1
~~~

Expected: the annotated tag points to the verified release.

## Spec coverage

- Diagnosis: Tasks 4 and 9.
- Mandatory six-element logic: Tasks 2, 5, and 9.
- DigiShow, TouchDesigner, and collaboration: Tasks 5 and 11.
- Three-level hints: Task 6.
- Evidence-based troubleshooting: Task 7.
- Transfer learning: Task 8.
- Teacher analysis and override: Task 10.
- Truthful demonstration validation: Task 11.
- Independent website and role workspaces: Tasks 1, 3, 9, 10, and 13.
- Privacy, fallback, and uncertainty: Tasks 6, 7, 11, and 12.
- Public link, QR, and demonstration: Tasks 13 and 14.

## Implementation worktree

Before Task 1:

~~~powershell
git worktree add .worktrees/tonggan-mvp -b feature/tonggan-mvp
Set-Location .worktrees/tonggan-mvp
~~~

The .worktrees directory is ignored. Do not implement on main. Merge feature/tonggan-mvp only after Task 14 passes.

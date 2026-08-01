// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDb, type DatabaseConnection } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { evidence, hintEvidenceConsumptions, hintRecords } from "@/lib/db/schema";
import { saveEvidence } from "@/lib/services/evidence";
import {
  HintPersistenceConflictError,
  requestPersistedHint,
} from "@/lib/services/hint-persistence";
import type { HintResponse } from "@/lib/services/hints";
import { advanceTroubleshooting } from "@/lib/services/troubleshooting-service";
import { validPng as png } from "@/tests/helpers/image-fixtures";

const actor = { userId: "student-1", role: "STUDENT" } as const;
type HintEvidence = {
  evidenceRecordId: string;
  evidenceSequence: number;
  contentDigest: string;
  createdAt: string;
};

function grounded(level: 1 | 2 | 3, consume: HintEvidence | null): HintResponse {
  return {
    hintLevel: level,
    groundingStatus: "GROUNDED",
    confirmedFacts: level === 1 ? [] : ["课程设计：已确认事实"],
    hypotheses: level === 1 ? [] : ["待验证假设：端口不一致"],
    questions: ["接收端看到值了吗？"],
    guidance: level === 1 ? [] : ["先查上游"],
    nextSteps: level === 1 ? [] : ["核对端口"],
    localExample: level === 3 ? "局部示例：只测一个值" : null,
    sourceTitles: ["课程设计"],
    sources: [{ title: "课程设计", authority: "COURSE_DESIGN" }],
    evidenceToConsume: consume,
    uncertainty: "需证据确认",
    fallback: true,
  };
}

function inputProbe(label = "输入值") {
  return {
    kind: "PROBE" as const,
    label,
    signalLayer: "INPUT" as const,
    probe: {
      type: "INPUT_MEASUREMENT" as const,
      firstCondition: "手靠近",
      firstValue: 12,
      secondCondition: "手远离",
      secondValue: 24,
      unit: "cm",
    },
  };
}

function localTransportProbe() {
  return {
    kind: "PROBE" as const, label: "本地通道回执", signalLayer: "TRANSPORT" as const,
    probe: { type: "LOCAL_CHANNEL_RECEIPT" as const, sourceChannel: "input", targetChannel: "mapping", receivedValue: 0.5 },
  };
}

function oscTransportProbe() {
  return {
    kind: "PROBE" as const, label: "OSC回执", signalLayer: "TRANSPORT" as const,
    probe: { type: "TRANSPORT_RECEIPT" as const, protocol: "OSC" as const, host: "127.0.0.1", port: 7000, receivedValue: 0.5 },
  };
}

describe("evidence and persisted hints", () => {
  let directory: string;
  let root: string;
  let databasePath: string;
  let connection: DatabaseConnection;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tonggan-evidence-"));
    root = path.join(directory, "private-evidence");
    databasePath = path.join(directory, "course.sqlite");
    runMigrations(databasePath);
    connection = createDb(databasePath);
    connection.sqlite.exec(`
      INSERT INTO classes VALUES ('class-1', '一班', 'CLASS001'), ('class-2', '二班', 'CLASS002');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('student-1', 'class-1', 'STUDENT', '匿名-1', 1700000000),
        ('student-2', 'class-1', 'STUDENT', '匿名-2', 1700000000),
        ('student-3', 'class-2', 'STUDENT', '匿名-3', 1700000000),
        ('teacher-1', 'class-1', 'TEACHER', '教师', 1700000000);
      INSERT INTO course_modules VALUES ('module-1', 'class-1', 1, '搭建', 2, '信号');
      INSERT INTO assignments VALUES ('assignment-1', 'class-1', 'module-1', '作业', '简介', '["DIGISHOW"]', 1700000000);
      INSERT INTO projects VALUES ('project-1', 'class-1', 'assignment-1', 'student-1', 'BUILD', 1700000000, 1700000000, 0);
      INSERT INTO tool_path_plans(project_id,path,requirements_json,reasons_json,milestones_json,created_at,updated_at)
        VALUES ('project-1','DIGISHOW','{"needsRealtimeVisuals":false,"needsPhysicalControl":true,"hasOsc":false}','[]','[]',1700000000,1700000000);
    `);
  });

  it("accepts local transport receipts only for a trusted non-OSC solo path", async () => {
    await expect(saveEvidence(connection.db, actor, "project-1", localTransportProbe(), { root }))
      .resolves.toMatchObject({ verificationStatus: "RULE_VERIFIED", confirmedCode: "TRANSPORT_OK" });
  });

  it("rejects local receipts for a trusted collaborative OSC path and accepts an OSC receipt", async () => {
    connection.sqlite.prepare("UPDATE tool_path_plans SET path='COLLABORATIVE', requirements_json=? WHERE project_id='project-1'")
      .run(JSON.stringify({ needsRealtimeVisuals: true, needsPhysicalControl: true, hasOsc: true }));
    await expect(saveEvidence(connection.db, actor, "project-1", localTransportProbe(), { root }))
      .rejects.toThrow(/协同|OSC|路径/);
    await expect(saveEvidence(connection.db, actor, "project-1", oscTransportProbe(), { root }))
      .resolves.toMatchObject({ verificationStatus: "RULE_VERIFIED", confirmedCode: "TRANSPORT_OK" });
  });

  afterEach(async () => {
    connection.sqlite.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("atomically stores a private image using a UUID relative path and digest", async () => {
    const row = await saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE",
      label: "输入截图",
      signalLayer: "INPUT",
      bytes: png,
      declaredMime: "image/png",
      originalName: "../作业.png",
    }, { root });

    expect(row.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(row.content).toMatch(/^project-1\/[0-9a-f-]+\.png$/);
    expect(path.isAbsolute(row.content)).toBe(false);
    const stored = await readFile(path.join(root, row.content));
    expect(stored).not.toEqual(png);
    expect(createHash("sha256").update(stored).digest("hex")).toBe(row.contentDigest);
    expect(connection.db.select().from(evidence).get()).toMatchObject({ studentId: "student-1", classId: "class-1" });
  });

  it("removes the file when the database transaction fails", async () => {
    const historical = await saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE", label: "历史截图", signalLayer: "INPUT", bytes: png,
      declaredMime: "image/png", originalName: "old.png",
    }, { root });
    const historicalBytes = await readFile(path.join(root, historical.content));
    connection.sqlite.exec("CREATE TRIGGER reject_evidence BEFORE INSERT ON evidence WHEN NEW.label='失败截图' BEGIN SELECT RAISE(ABORT, 'no'); END;");
    await expect(saveEvidence(connection.db, actor, "project-1", {
      kind: "IMAGE", label: "失败截图", signalLayer: "INPUT", bytes: png,
      declaredMime: "image/png", originalName: "a.png",
    }, { root })).rejects.toThrow("no");
    await expect(readFile(path.join(root, historical.content))).resolves.toEqual(historicalBytes);
    expect(connection.db.select().from(evidence).all()).toHaveLength(1);
    expect((await readdir(path.join(root, "project-1"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("never cleans up another concurrent image", async () => {
    connection.sqlite.exec("CREATE TRIGGER reject_one_evidence BEFORE INSERT ON evidence WHEN NEW.label='并发失败' BEGIN SELECT RAISE(ABORT, 'no'); END;");
    const [failed, saved] = await Promise.allSettled([
      saveEvidence(connection.db, actor, "project-1", {
        kind: "IMAGE", label: "并发失败", signalLayer: "INPUT", bytes: png,
        declaredMime: "image/png", originalName: "bad.png",
      }, { root }),
      saveEvidence(connection.db, actor, "project-1", {
        kind: "IMAGE", label: "并发成功", signalLayer: "INPUT", bytes: png,
        declaredMime: "image/png", originalName: "good.png",
      }, { root }),
    ]);
    expect(failed.status).toBe("rejected");
    expect(saved.status).toBe("fulfilled");
    const row = (saved as PromiseFulfilledResult<Awaited<ReturnType<typeof saveEvidence>>>).value;
    const stored = await readFile(path.join(root, row.content));
    expect(stored).not.toEqual(png);
    expect(createHash("sha256").update(stored).digest("hex")).toBe(row.contentDigest);
    expect(connection.db.select().from(evidence).all()).toHaveLength(1);
    expect((await readdir(path.join(root, "project-1"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("allocates distinct monotonic evidence sequences across two connections", async () => {
    const leftConnection = createDb(databasePath);
    const rightConnection = createDb(databasePath);
    try {
      const saved = await Promise.all([
        saveEvidence(leftConnection.db, actor, "project-1", {
          kind: "IMAGE", label: "并发截图一", signalLayer: "INPUT", bytes: png,
          declaredMime: "image/png", originalName: "one.png",
        }, { root }),
        saveEvidence(rightConnection.db, actor, "project-1", {
          kind: "IMAGE", label: "并发截图二", signalLayer: "INPUT", bytes: png,
          declaredMime: "image/png", originalName: "two.png",
        }, { root }),
      ]);
      expect(saved.map(({ evidenceSequence }) => evidenceSequence).sort((a, b) => a - b)).toEqual([1, 2]);
    } finally {
      leftConnection.sqlite.close();
      rightConnection.sqlite.close();
    }
  });

  it("persists level one and two and atomically consumes level-three evidence once", async () => {
    const first = await requestPersistedHint(connection.db, actor, "project-1", { question: "OSC端口" },
      async (_request, policy) => grounded(policy.previousHintRecords.length === 0 ? 1 : 2, null));
    const second = await requestPersistedHint(connection.db, actor, "project-1", { question: "OSC端口" },
      async () => grounded(2, null));
    expect([first.hintLevel, second.hintLevel]).toEqual([1, 2]);

    const item = await saveEvidence(connection.db, actor, "project-1", inputProbe(),
      { root, now: new Date(Date.now() + 1_000) });
    const generate = async (_request: unknown, policy: { currentEvidenceRecords: HintEvidence[] }) => {
      const candidate = policy.currentEvidenceRecords[0];
      return grounded(3, candidate ? {
        evidenceRecordId: candidate.evidenceRecordId,
        evidenceSequence: candidate.evidenceSequence,
        contentDigest: candidate.contentDigest,
        createdAt: candidate.createdAt,
      } : null);
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slowGenerate = async (...args: Parameters<typeof generate>) => { await gate; return generate(...args); };
    const leftConnection = createDb(databasePath);
    const rightConnection = createDb(databasePath);
    try {
      const left = requestPersistedHint(leftConnection.db, actor, "project-1", { question: "OSC端口" }, slowGenerate);
      const right = requestPersistedHint(rightConnection.db, actor, "project-1", { question: "OSC端口" }, slowGenerate);
      release();
      const settled = await Promise.allSettled([left, right]);
      expect(settled.filter(({ status }) => status === "fulfilled"), JSON.stringify(settled)).toHaveLength(1);
      expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
      expect((settled.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason)
        .toBeInstanceOf(HintPersistenceConflictError);
    } finally {
      leftConnection.sqlite.close();
      rightConnection.sqlite.close();
    }
    expect(connection.db.select().from(hintEvidenceConsumptions).all()).toHaveLength(1);
    expect(connection.db.select().from(hintEvidenceConsumptions).get()?.evidenceId).toBe(item.id);
    expect(connection.db.select().from(hintRecords).all()).toHaveLength(3);
  });

  it("allows only one concurrent level-two response for the same hint sequence", async () => {
    await requestPersistedHint(connection.db, actor, "project-1", { question: "OSC端口" },
      async () => grounded(1, null));
    let arrived = 0;
    let release!: () => void;
    let bothArrived!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { bothArrived = resolve; });
    const generate = async () => {
      arrived += 1;
      if (arrived === 2) bothArrived();
      await gate;
      return grounded(2, null);
    };
    const leftConnection = createDb(databasePath);
    const rightConnection = createDb(databasePath);
    try {
      const left = requestPersistedHint(leftConnection.db, actor, "project-1", { question: "OSC端口" }, generate);
      const right = requestPersistedHint(rightConnection.db, actor, "project-1", { question: "OSC端口" }, generate);
      await ready;
      release();
      const settled = await Promise.allSettled([left, right]);
      expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
      expect((settled.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason)
        .toBeInstanceOf(HintPersistenceConflictError);
    } finally {
      leftConnection.sqlite.close();
      rightConnection.sqlite.close();
    }
    expect(connection.db.select().from(hintRecords).all().map(({ hintSequence }) => hintSequence))
      .toEqual([1, 2]);
  });

  it("rejects a generated hint when the troubleshooting revision changes", async () => {
    advanceTroubleshooting(connection.db, actor, "project-1", { symptom: "输入无响应" });
    let snapshotTaken!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { snapshotTaken = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = requestPersistedHint(connection.db, actor, "project-1", { question: "怎么排查" },
      async () => {
        snapshotTaken();
        await gate;
        return grounded(1, null);
      });
    await ready;
    const mutator = createDb(databasePath);
    try {
      advanceTroubleshooting(mutator.db, actor, "project-1", {});
    } finally {
      mutator.sqlite.close();
    }
    release();
    await expect(pending).rejects.toBeInstanceOf(HintPersistenceConflictError);
    expect(connection.db.select().from(hintRecords).all()).toHaveLength(0);
  });

  it("rejects level three when evidence createdAt changes during model generation", async () => {
    await requestPersistedHint(connection.db, actor, "project-1", { question: "OSC" },
      async () => grounded(1, null));
    await requestPersistedHint(connection.db, actor, "project-1", { question: "OSC" },
      async () => grounded(2, null));
    const item = await saveEvidence(connection.db, actor, "project-1", inputProbe(),
      { root, now: new Date(Date.now() + 2_000) });
    let release!: () => void;
    let captured: HintEvidence | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = requestPersistedHint(connection.db, actor, "project-1", { question: "OSC" },
      async (_request, policy) => {
        captured = policy.currentEvidenceRecords.find(({ evidenceRecordId }) => evidenceRecordId === item.id);
        await gate;
        return grounded(3, captured ?? null);
      });
    await expect.poll(() => captured?.createdAt).toBe(item.createdAt.toISOString());
    const mutator = createDb(databasePath);
    try {
      mutator.sqlite.prepare("UPDATE evidence SET created_at = created_at + 1 WHERE id = ?").run(item.id);
    } finally { mutator.sqlite.close(); }
    release();
    await expect(pending).rejects.toBeInstanceOf(HintPersistenceConflictError);
    expect(connection.db.select().from(hintRecords).all()).toHaveLength(2);
    expect(connection.db.select().from(hintEvidenceConsumptions).all()).toHaveLength(0);
  });

  it("rejects level three when the snapshotted evidence row is replaced", async () => {
    await requestPersistedHint(connection.db, actor, "project-1", { question: "OSC" }, async () => grounded(1, null));
    await requestPersistedHint(connection.db, actor, "project-1", { question: "OSC" }, async () => grounded(2, null));
    const item = await saveEvidence(connection.db, actor, "project-1", inputProbe(),
      { root, now: new Date(Date.now() + 2_000) });
    let release!: () => void;
    let captured: HintEvidence | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = requestPersistedHint(connection.db, actor, "project-1", { question: "OSC" }, async (_request, policy) => {
      captured = policy.currentEvidenceRecords.find(({ evidenceRecordId }) => evidenceRecordId === item.id);
      await gate;
      return grounded(3, captured ?? null);
    });
    await expect.poll(() => captured?.evidenceRecordId).toBe(item.id);
    const mutator = createDb(databasePath);
    try {
      mutator.sqlite.prepare("UPDATE evidence SET content = 'replacement', content_digest = ? WHERE id = ?")
        .run("c".repeat(64), item.id);
    } finally { mutator.sqlite.close(); }
    release();
    await expect(pending).rejects.toBeInstanceOf(HintPersistenceConflictError);
    expect(connection.db.select().from(hintRecords).all()).toHaveLength(2);
    expect(connection.db.select().from(hintEvidenceConsumptions).all()).toHaveLength(0);
  });
});

import { z } from "zod";

import { publicTroubleshootingState, TroubleshootingRunSnapshotSchema } from "@/lib/services/troubleshooting";

import type { AgentToolDefinition } from "../tool-contract";
import { getCapability } from "../capability-registry";
import {
  sanitizeEvidenceFragment,
  selectRelevantVerifiedEvidenceFacts,
  VerifiedEvidenceFactSchema,
} from "../verified-evidence-facts";

const EmptyInputSchema = z.object({}).strict();
const SignalLayerSchema = z.enum(["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]);

const ProjectEvidenceOutputSchema = z.object({
  project: z.object({ stage: z.string(), toolPath: z.string().nullable() }).strict().nullable(),
  evidence: z.array(z.object({
    kind: z.string(),
    signalLayer: SignalLayerSchema,
    label: z.string(),
    verificationStatus: z.string(),
  }).strict()).max(20),
  verifiedFacts: z.array(VerifiedEvidenceFactSchema).max(5),
  layerCoverage: z.array(z.object({
    layer: SignalLayerSchema,
    submitted: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
  }).strict()).length(5),
}).strict();

export const projectEvidenceStateTool = {
  descriptor: {
    id: "project-evidence.read-state",
    version: "1",
    adapterId: "project-evidence",
    owner: getCapability("process-record"),
    label: "读取当前项目与五层证据",
    description: "读取当前学生项目阶段、工具路径，以及输入到输出五层已提交和已验证的证据摘要。",
    inputHint: "不需要参数，arguments 必须是空对象。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 2_000,
    recommendedByCoursePacks: [
      { id: "digital-interaction", version: "1" },
      { id: "brand-vi-design", version: "1" },
    ],
  },
  inputSchema: EmptyInputSchema,
  outputSchema: ProjectEvidenceOutputSchema,
  execute(context) {
    const project = context.student.project;
    if (!project) {
      return {
        project: null,
        evidence: [],
        verifiedFacts: [],
        layerCoverage: ["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"]
          .map((layer) => ({ layer, submitted: 0, verified: 0 })),
      };
    }
    const toolPath = context.connection.sqlite.prepare(
      "SELECT path FROM tool_path_plans WHERE project_id=?",
    ).get(project.id) as { path: string } | undefined;
    const rawEvidence = context.connection.sqlite.prepare(`
      SELECT kind, signal_layer signalLayer, label, verification_status verificationStatus
      FROM evidence WHERE project_id=? AND student_id=? AND class_id=?
      ORDER BY evidence_sequence DESC LIMIT 20
    `).all(project.id, context.student.studentId, context.student.classId) as Array<{
      kind: string; signalLayer: "INPUT" | "MAPPING" | "TRANSPORT" | "BINDING" | "OUTPUT";
      label: string; verificationStatus: string;
    }>;
    const evidence = rawEvidence.map((item) => ({
      ...item,
      label: sanitizeEvidenceFragment(item.label, 80),
    }));
    const layerCoverage = ["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"].map((layer) => {
      const rows = evidence.filter((item) => item.signalLayer === layer);
      return {
        layer,
        submitted: rows.length,
        verified: rows.filter((item) => ["RULE_VERIFIED", "TEACHER_VERIFIED"].includes(item.verificationStatus)).length,
      };
    });
    const verifiedFacts = selectRelevantVerifiedEvidenceFacts(
      context.student.verifiedEvidenceFacts,
      context.question,
    );
    return { project: { stage: project.stage, toolPath: toolPath?.path ?? null }, evidence, verifiedFacts, layerCoverage };
  },
  summarize(rawOutput) {
    const output = ProjectEvidenceOutputSchema.parse(rawOutput);
    if (!output.project) return { summary: "当前没有数字交互项目。", facts: ["未找到可读取的项目与证据"], empty: true };
    const verified = output.layerCoverage.filter((layer) => layer.verified > 0).map(({ layer }) => layer);
    return {
      summary: `项目处于 ${output.project.stage}，已有 ${output.evidence.length} 条证据。`,
      facts: [
        `工具路径：${output.project.toolPath ?? "尚未选择"}`,
        `已有验证的层级：${verified.join("、") || "暂无"}`,
        ...output.verifiedFacts.flatMap((fact) => [fact.statement, ...(fact.boundary ? [fact.boundary] : [])]).slice(0, 4),
        ...output.layerCoverage.map((item) => `${item.layer}：提交${item.submitted}，验证${item.verified}`),
      ],
      empty: output.evidence.length === 0,
    };
  },
} satisfies AgentToolDefinition;

const TroubleshootingOutputSchema = z.object({
  exists: z.boolean(),
  symptom: z.string().nullable(),
  state: z.object({
    confirmedCodes: z.array(z.string()),
    noNewEvidenceRounds: z.number().int(),
    status: z.enum(["ACTIVE", "RESOLVED", "ESCALATED"]),
    currentLayer: SignalLayerSchema,
    confirmedFacts: z.array(z.string()),
    unconfirmedHypotheses: z.array(z.string()),
    nextActions: z.array(z.string()),
  }).strict().nullable(),
}).strict();

export const projectTroubleshootingStateTool = {
  descriptor: {
    id: "project-evidence.read-troubleshooting",
    version: "1",
    adapterId: "project-evidence",
    owner: getCapability("process-record"),
    label: "读取排障进度",
    description: "读取当前项目最近一次五层信号链排障状态、已确认事实和下一项证据动作。",
    inputHint: "不需要参数，arguments 必须是空对象。",
    effect: "READ_CONTEXT",
    access: "READ_ONLY",
    timeoutMs: 2_000,
    recommendedByCoursePacks: [
      { id: "digital-interaction", version: "1" },
      { id: "brand-vi-design", version: "1" },
    ],
  },
  inputSchema: EmptyInputSchema,
  outputSchema: TroubleshootingOutputSchema,
  execute(context) {
    const project = context.student.project;
    if (!project) return { exists: false, symptom: null, state: null };
    const row = context.connection.sqlite.prepare(`
      SELECT symptom, current_layer currentLayer, status, state_json stateJson
      FROM troubleshooting_runs WHERE project_id=?
      ORDER BY updated_at DESC, id DESC LIMIT 1
    `).get(project.id) as { symptom: string; currentLayer: string; status: string; stateJson: string } | undefined;
    if (!row) return { exists: false, symptom: null, state: null };
    const snapshot = TroubleshootingRunSnapshotSchema.parse({
      currentLayer: row.currentLayer,
      status: row.status,
      stateJson: JSON.parse(row.stateJson),
    });
    return { exists: true, symptom: row.symptom, state: publicTroubleshootingState(snapshot.stateJson) };
  },
  summarize(rawOutput) {
    const output = TroubleshootingOutputSchema.parse(rawOutput);
    if (!output.exists || !output.state) return { summary: "当前还没有排障记录。", facts: ["需要先建立一轮可观察排障"], empty: true };
    return {
      summary: `排障处于 ${output.state.currentLayer} 层，状态为 ${output.state.status}。`,
      facts: [
        ...output.state.confirmedFacts,
        ...output.state.unconfirmedHypotheses,
        ...output.state.nextActions.map((action) => `下一步：${action}`),
      ],
      empty: false,
    };
  },
} satisfies AgentToolDefinition;

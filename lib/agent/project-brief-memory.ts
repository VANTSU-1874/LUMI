import { randomUUID } from "node:crypto";

import type { DatabaseConnection } from "@/lib/db/client";
import {
  PROJECT_BRIEF_FIELD_IDS,
  ProjectBriefPatchSchema,
  ProjectBriefSchema,
  type ProjectBrief,
  type ProjectBriefPatch,
} from "./project-brief-contract";

export {
  PROJECT_BRIEF_FIELD_IDS,
  ProjectBriefFieldIdSchema,
  ProjectBriefFieldSchema,
  ProjectBriefFieldUpdateSchema,
  ProjectBriefPatchSchema,
  ProjectBriefSchema,
} from "./project-brief-contract";
export type { ProjectBrief, ProjectBriefFieldId, ProjectBriefPatch } from "./project-brief-contract";

export function emptyProjectBrief(): ProjectBrief {
  return { revision: 0, fields: {}, updatedAt: null };
}

export function readProjectBrief(
  connection: DatabaseConnection,
  studentId: string,
  classId: string,
  taskId: string,
): ProjectBrief {
  const row = connection.sqlite.prepare(`
    SELECT brief_json briefJson, revision, updated_at updatedAt
    FROM agent_project_briefs WHERE student_id=? AND class_id=? AND task_id=?
  `).get(studentId, classId, taskId) as { briefJson: string; revision: number; updatedAt: number } | undefined;
  if (!row) return emptyProjectBrief();
  const parsed = ProjectBriefSchema.shape.fields.parse(JSON.parse(row.briefJson));
  return ProjectBriefSchema.parse({
    revision: row.revision,
    fields: parsed,
    updatedAt: new Date(row.updatedAt * 1_000).toISOString(),
  });
}

export function mergeProjectBrief(input: {
  connection: DatabaseConnection;
  studentId: string;
  classId: string;
  taskId: string;
  dataType: "REAL" | "DEMONSTRATION_DATA";
  patch: ProjectBriefPatch;
  sourceTurnId: string;
  now: Date;
}) {
  const patch = ProjectBriefPatchSchema.parse(input.patch);
  const candidateEntries = PROJECT_BRIEF_FIELD_IDS.flatMap((fieldId) => {
    const update = patch[fieldId];
    return update ? [[fieldId, update] as const] : [];
  });
  const current = readProjectBrief(input.connection, input.studentId, input.classId, input.taskId);
  const entries = candidateEntries.filter(([fieldId, update]) =>
    current.fields[fieldId]?.status !== "CONFIRMED" || update.status === "CONFIRMED");
  if (entries.length === 0) return current;

  const epochSeconds = Math.floor(input.now.getTime() / 1_000);
  const updatedAt = new Date(epochSeconds * 1_000).toISOString();
  const fields = { ...current.fields };
  for (const [fieldId, update] of entries) {
    fields[fieldId] = { ...update, sourceTurnId: input.sourceTurnId, updatedAt };
  }
  const revision = current.revision + 1;
  input.connection.sqlite.prepare(`
    INSERT INTO agent_project_briefs(
      id,task_id,student_id,class_id,brief_json,revision,created_at,updated_at,data_type
    ) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(task_id) DO UPDATE SET
      brief_json=excluded.brief_json,
      revision=excluded.revision,
      updated_at=excluded.updated_at
  `).run(
    randomUUID(), input.taskId, input.studentId, input.classId, JSON.stringify(fields), revision,
    epochSeconds, epochSeconds, input.dataType,
  );
  return ProjectBriefSchema.parse({ revision, fields, updatedAt });
}

export function projectBriefSummary(brief: ProjectBrief) {
  return PROJECT_BRIEF_FIELD_IDS.flatMap((fieldId) => {
    const field = brief.fields[fieldId];
    return field ? [{ fieldId, value: field.value, status: field.status }] : [];
  });
}

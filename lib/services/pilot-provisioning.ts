import { randomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import { issueStudentIdentityCode } from "@/lib/auth/identity-code";
import type { DatabaseConnection } from "@/lib/db/client";

const PilotProvisioningInputSchema = z.object({
  className: z.string().trim().min(2).max(80),
  participantCount: z.number().int().min(1).max(30),
  identityCodePepper: z.string().min(32),
  now: z.date().optional(),
}).strict();

export type PilotProvisioningResult = {
  classId: string;
  className: string;
  classAccessCode: string;
  identityCodes: string[];
  participantCount: number;
  createdAt: string;
};

export function preparePilotClass(connection: DatabaseConnection, rawInput: z.input<typeof PilotProvisioningInputSchema>): PilotProvisioningResult {
  const input = PilotProvisioningInputSchema.parse(rawInput);
  const now = input.now ?? new Date();
  const timestamp = Math.floor(now.getTime() / 1_000);
  const classId = `pilot-${randomUUID()}`;
  const classAccessCode = `PILOT-${randomBytes(6).toString("hex").toUpperCase()}`;
  const moduleId = `${classId}-module`;
  const assignmentId = `${classId}-assignment`;
  const identityCodes: string[] = [];

  connection.sqlite.transaction(() => {
    connection.sqlite.prepare("INSERT INTO classes(id,name,access_code) VALUES(?,?,?)")
      .run(classId, input.className, classAccessCode);
    const insertModule = connection.sqlite.prepare(`
      INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES(?,?,?,?,?,?)
    `);
    insertModule.run(`${moduleId}-1`, classId, 1, "交互逻辑与快速诊断", 8, "从意图、参与、输入、映射、输出和反馈理解项目");
    insertModule.run(`${moduleId}-2`, classId, 2, "DigiShow 信号入门", 16, "低门槛信号与映射实验");
    insertModule.run(`${moduleId}-3`, classId, 3, "TouchDesigner 项目搭建与排障", 24, "节点关系、五层信号链和证据排障");
    insertModule.run(`${moduleId}-4`, classId, 4, "迁移与反思", 16, "保持结构并改变输入、映射、输出或受众");
    connection.sqlite.prepare(`
      INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at)
      VALUES(?,?,?,?,?,?,?)
    `).run(
      assignmentId, classId, `${moduleId}-3`, "真实试用：声音有值但画面不动",
      "学生先描述自己的故障假设，再与 Agent 核对证据层、确认行动、提交阶段证据并完成一次迁移说明。",
      JSON.stringify(["DIGISHOW", "TOUCHDESIGNER", "COLLABORATIVE"]), timestamp,
    );
    for (let index = 0; index < input.participantCount; index += 1) {
      identityCodes.push(issueStudentIdentityCode(connection.db, { classId, pepper: input.identityCodePepper }));
    }
  })();

  return {
    classId, className: input.className, classAccessCode, identityCodes,
    participantCount: identityCodes.length, createdAt: now.toISOString(),
  };
}

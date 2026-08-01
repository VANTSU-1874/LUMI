import { z } from "zod";

export const PILOT_OBSERVATION_TITLE = "# “触映”真实试用匿名观察表";
export const PILOT_OBSERVATION_IDENTITY_ROW = "| 试用匿名编号 |  |";

const PilotObservationPacketInputSchema = z.object({
  className: z.string().trim().min(2).max(80),
  participantCount: z.number().int().min(1).max(30),
  createdAt: z.date(),
}).strict();

export type PilotObservationPacketInput = z.input<typeof PilotObservationPacketInputSchema>;

export function renderPilotObservationPacket(template: string, rawInput: PilotObservationPacketInput) {
  const input = PilotObservationPacketInputSchema.parse(rawInput);
  if (!template.trimStart().startsWith(PILOT_OBSERVATION_TITLE)) {
    throw new Error("匿名观察表模板缺少标准标题");
  }
  if (!template.includes(PILOT_OBSERVATION_IDENTITY_ROW)) {
    throw new Error("匿名观察表模板缺少试用匿名编号行");
  }

  const sheets = Array.from({ length: input.participantCount }, (_, index) => {
    const sequence = String(index + 1).padStart(2, "0");
    return template
      .replace(PILOT_OBSERVATION_TITLE, `${PILOT_OBSERVATION_TITLE}（试用序号 ${sequence}）`)
      .replace(
        PILOT_OBSERVATION_IDENTITY_ROW,
        `| 试用匿名编号 | ${sequence}（仅记录序号，不填写完整身份码） |`,
      );
  });

  return [
    "# “触映”真实试用匿名观察包",
    "",
    `- 试用班：${input.className}`,
    `- 生成时间：${input.createdAt.toISOString()}`,
    `- 观察表数量：${input.participantCount}`,
    "- 隐私规则：本文件只使用 01—30 序号与私有访问文件对应，不记录班级码或完整学生身份码。",
    "",
    sheets.join("\n\n---\n\n"),
    "",
  ].join("\n");
}

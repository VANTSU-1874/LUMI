// @vitest-environment node

import { describe, expect, it } from "vitest";

import { renderPilotObservationPacket } from "@/lib/services/pilot-observation";

const TEMPLATE = `# “触映”真实试用匿名观察表

| 字段 | 记录 |
| --- | --- |
| 试用匿名编号 |  |
| 观察教师 |  |
`;

describe("pilot observation packet", () => {
  it("creates numbered sheets without copying private access codes", () => {
    const packet = renderPilotObservationPacket(TEMPLATE, {
      className: "第一轮真实试用",
      participantCount: 3,
      createdAt: new Date("2026-07-16T02:00:00.000Z"),
    });

    expect(packet).toContain("第一轮真实试用");
    expect(packet).toContain("试用序号 01");
    expect(packet).toContain("试用序号 02");
    expect(packet).toContain("试用序号 03");
    expect(packet.match(/仅记录序号，不填写完整身份码/g)).toHaveLength(3);
    expect(packet).not.toMatch(/[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}/);
    expect(packet).not.toContain("班级码：");
  });

  it("rejects a template without the protected identity row", () => {
    expect(() => renderPilotObservationPacket("# “触映”真实试用匿名观察表", {
      className: "第一轮真实试用",
      participantCount: 1,
      createdAt: new Date(),
    })).toThrow("缺少试用匿名编号行");
  });
});

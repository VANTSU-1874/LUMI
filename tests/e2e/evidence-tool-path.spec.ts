import { expect, test, type Page } from "./fixtures";
import { enterLegacyStudent } from "./auth-helpers";

import { setFreshTrustedSourceHeaders } from "./trusted-source";

const scenarios = [
  { code: "LM3T-R7V9-X2QA", projectId: "e2e-p6", pathLabel: "DigiShow单工具路径", type: "LOCAL_CHANNEL_RECEIPT" },
  { code: "NP4U-S8W2-Y3RB", projectId: "e2e-p7", pathLabel: "TouchDesigner单工具路径", type: "LOCAL_CHANNEL_RECEIPT" },
  { code: "QR5V-T9X3-Z4SC", projectId: "e2e-p8", pathLabel: "DigiShow + TouchDesigner协同路径", type: "TRANSPORT_RECEIPT" },
] as const;

async function login(page: Page, code: string) {
  await enterLegacyStudent(page, code);
}

for (const scenario of scenarios) {
  test(`${scenario.pathLabel}通过已登录浏览器提交正确的传输回执`, async ({ page }) => {
    await login(page, scenario.code);
    await setFreshTrustedSourceHeaders(page, `e2e-${scenario.projectId}`);
    const draft = scenario.type === "LOCAL_CHANNEL_RECEIPT"
      ? {
          kind: "PROBE",
          label: "传输路径验证",
          signalLayer: "TRANSPORT",
          probe: {
            type: "LOCAL_CHANNEL_RECEIPT",
            sourceChannel: "input/channel1",
            targetChannel: "mapping/channel1",
            receivedValue: 0.75,
          },
        }
      : {
          kind: "PROBE",
          label: "传输路径验证",
          signalLayer: "TRANSPORT",
          probe: {
            type: "TRANSPORT_RECEIPT",
            protocol: "OSC",
            host: "127.0.0.1",
            port: 9000,
            receivedValue: 0.5,
          },
        };

    const submitted = await page.evaluate(async ({ projectId, evidenceDraft }) => {
      const response = await fetch(`/api/projects/${projectId}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(evidenceDraft),
      });
      return { status: response.status, body: await response.json() };
    }, { projectId: scenario.projectId, evidenceDraft: draft });

    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    expect(submitted.body).toMatchObject({
      kind: "PROBE",
      signalLayer: "TRANSPORT",
      label: "传输路径验证",
      verificationStatus: "RULE_VERIFIED",
    });

    const dashboard = await page.evaluate(async () => {
      const response = await fetch("/api/student/dashboard");
      return { status: response.status, body: await response.json() };
    });
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.evidence).toMatchObject({ total: 1, verified: 1 });
    expect(dashboard.body.evidence.recent[0]).toMatchObject({
      kind: "PROBE",
      layer: "TRANSPORT",
      verification: "RULE_VERIFIED",
    });
  });
}

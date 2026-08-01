import { describe, expect, it } from "vitest";

import {
  EvidenceProbeDraftSchema,
  validateEvidenceProbe,
} from "@/lib/domain/evidence-probe";

describe("structured evidence probes", () => {
  it.each([
    {
      signalLayer: "INPUT",
      probe: {
        type: "INPUT_MEASUREMENT",
        firstCondition: "靠近",
        firstValue: 12,
        secondCondition: "远离",
        secondValue: 86,
        unit: "cm",
      },
      code: "INPUT_OK",
    },
    {
      signalLayer: "MAPPING",
      probe: {
        type: "MAPPING_RANGE",
        inputMin: 0,
        inputMax: 100,
        outputMin: 0,
        outputMax: 1,
        relationship: "DIRECT",
      },
      code: "MAPPING_OK",
    },
    {
      signalLayer: "TRANSPORT",
      probe: {
        type: "TRANSPORT_RECEIPT",
        protocol: "OSC",
        host: "127.0.0.1",
        port: 9000,
        receivedValue: 0.5,
      },
      code: "TRANSPORT_OK",
    },
    {
      signalLayer: "BINDING",
      probe: {
        type: "BINDING_OBSERVATION",
        source: "oscin1/chan1",
        target: "level1.opacity",
        observedBefore: 0,
        observedAfter: 0.8,
      },
      code: "BINDING_OK",
    },
    {
      signalLayer: "OUTPUT",
      probe: {
        type: "OUTPUT_COMPARISON",
        parameter: "brightness",
        before: 0.2,
        after: 0.9,
      },
      code: "OUTPUT_OK",
    },
  ] as const)("rule-verifies $signalLayer with a structured comparison", (draft) => {
    const parsed = EvidenceProbeDraftSchema.parse({
      kind: "PROBE",
      label: `${draft.signalLayer}验证`,
      signalLayer: draft.signalLayer,
      probe: draft.probe,
    });
    expect(validateEvidenceProbe(parsed)).toEqual({
      verificationStatus: "RULE_VERIFIED",
      confirmedCode: draft.code,
    });
  });

  it.each([
    {
      kind: "PROBE",
      label: "空洞输入",
      signalLayer: "INPUT",
      probe: {
        type: "INPUT_MEASUREMENT",
        firstCondition: "一样",
        firstValue: 1,
        secondCondition: "一样",
        secondValue: 1,
        unit: "cm",
      },
    },
    {
      kind: "PROBE",
      label: "反向层",
      signalLayer: "INPUT",
      probe: {
        type: "MAPPING_RANGE",
        inputMin: 0,
        inputMax: 1,
        outputMin: 0,
        outputMax: 1,
        relationship: "DIRECT",
      },
    },
    {
      kind: "PROBE",
      label: "空绑定",
      signalLayer: "BINDING",
      probe: {
        type: "BINDING_OBSERVATION",
        source: " ",
        target: " ",
        observedBefore: 1,
        observedAfter: 1,
      },
    },
  ])("rejects vague, contradictory, or wrong-layer probes", (draft) => {
    expect(() => EvidenceProbeDraftSchema.parse(draft)).toThrow();
  });
});

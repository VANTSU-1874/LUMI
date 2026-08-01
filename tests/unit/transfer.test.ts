import { describe, expect, it } from "vitest";

import {
  TransferAnswerSchema,
  TransferChallengeGenerationError,
  createDeterministicChallenge,
  scoreTransferResponse,
} from "@/lib/services/transfer";
import { TransferPublicStateSchema, TransferRubricSchema, createEmptyTransferAnswerDraft, draftToAnswer, type TransferAnswer } from "@/lib/domain/transfer";

const logicCard = {
  culturalIntent: "让观众理解安岳石刻守护与共同记忆",
  participantAction: "观众靠近石刻投影并停留观察",
  inputSignal: "距离传感器10到80厘米",
  mappingRule: "距离由10到80厘米映射为0到1的画面亮度",
  outputMedium: "石刻纹样投影视觉",
  experienceFeedback: "靠近时纹样逐渐显现",
};
const layers = ["INPUT", "MAPPING", "TRANSPORT", "BINDING", "OUTPUT"] as const;
const codes = ["INPUT_OK", "MAPPING_OK", "TRANSPORT_OK", "BINDING_OK", "OUTPUT_OK"] as const;
const source = {
  projectId: "project-1",
  challengeRevision: 1,
  logicCard,
  path: "COLLABORATIVE" as const,
  verifiedEvidence: layers.map((layer, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    sequence: index + 1,
    layer,
    code: codes[index],
    digest: String(index + 1).repeat(64),
  })),
};

function answerFor(challenge: ReturnType<typeof createDeterministicChallenge>): TransferAnswer {
  const policy = challenge.unitPolicy;
  return {
    retainedStructure: {
      culturalIntent: challenge.mustRetain.culturalIntent,
      input: challenge.mustRetain.input,
      mapping: challenge.mustRetain.mapping,
      output: challenge.mustRetain.output,
    },
    changedParts: {
      dimension: challenge.changedDimension,
      from: challenge.change.from,
      to: challenge.change.to,
      rationale: "只替换挑战指定维度，其余交互关系保持不变。",
    },
    normalization: {
      sourceMin: policy.sourceUnit === "dB" ? 40 : 10,
      sourceMax: policy.sourceUnit === "dB" ? 90 : 80,
      sourceUnit: policy.sourceUnit,
      targetMin: policy.targetMin,
      targetMax: policy.targetMax,
      targetUnit: policy.targetUnit,
      relationship: policy.allowedRelationships[0],
    },
    culturalImpact: {
      audienceType: challenge.culturalPolicy.allowedAudienceTypes[0],
      behaviorBefore: challenge.culturalPolicy.allowedTransitions[0].before,
      behaviorAfter: challenge.culturalPolicy.allowedTransitions[0].after,
      intentAnchorId: challenge.culturalPolicy.intentAnchor.id,
      mechanism: challenge.culturalPolicy.allowedMechanisms[0],
      reflection: "该选择仅用于教师查看，不参与确定性判分。",
    },
  };
}

describe("structurally verifiable transfer rubric", () => {
  it("keeps a separate empty draft and converts only explicit finite fields", () => {
    const draft = createEmptyTransferAnswerDraft();
    expect(Object.values(draft.retainedStructure)).toEqual(["", "", "", ""]);
    expect(draftToAnswer(draft)).toBeNull();
    const challenge = createDeterministicChallenge(source);
    const complete = {
      retainedStructure: { ...answerFor(challenge).retainedStructure },
      changedParts: { ...answerFor(challenge).changedParts, rationale: "" },
      normalization: {
        sourceMin: "40", sourceMax: "90", sourceUnit: challenge.unitPolicy.sourceUnit,
        targetMin: "0", targetMax: "1", targetUnit: "normalized" as const,
        relationship: challenge.unitPolicy.allowedRelationships[0],
      },
      culturalImpact: {
        audienceType: challenge.culturalPolicy.allowedAudienceTypes[0],
        behaviorBefore: challenge.culturalPolicy.allowedTransitions[0].before,
        behaviorAfter: challenge.culturalPolicy.allowedTransitions[0].after,
        intentAnchorId: challenge.culturalPolicy.intentAnchor.id,
        mechanism: challenge.culturalPolicy.allowedMechanisms[0],
      },
    };
    expect(draftToAnswer(complete)?.normalization).toMatchObject({ sourceMin: 40, sourceMax: 90 });
    expect(draftToAnswer({ ...complete, normalization: { ...complete.normalization, sourceMin: "Infinity" } })).toBeNull();
  });
  it("is stable, snapshots all five evidence layers, and changes exactly one dimension", () => {
    const first = createDeterministicChallenge(source);
    const second = createDeterministicChallenge({ ...source, verifiedEvidence: [...source.verifiedEvidence].reverse() });
    expect(second).toEqual(first);
    expect(first.verifiedEvidenceSnapshot.map(({ layer }) => layer)).toEqual(layers);
    expect(first.change.from).not.toBe(first.change.to);
    expect(first.unitPolicy.allowedRelationships.length).toBeGreaterThan(0);
    expect(first.culturalPolicy.intentAnchor.id).toMatch(/^intent_[a-f0-9]{16}$/);
  });

  it("rotates to a different output candidate when the original already is lamp brightness", () => {
    const challenge = createDeterministicChallenge({
      ...source,
      forceDimension: "output",
      logicCard: { ...logicCard, outputMedium: "灯光亮度输出" },
    });
    expect(challenge.change.from).toBe("灯光亮度输出");
    expect(challenge.change.to).not.toBe("灯光亮度输出");
  });

  it("throws a typed error when every candidate normalizes to the original", () => {
    expect(() => createDeterministicChallenge({
      ...source,
      forceDimension: "output",
      candidateCatalog: { output: [{ id: "same", label: ` ${logicCard.outputMedium} ` }] },
    })).toThrow(TransferChallengeGenerationError);
  });

  it("passes exact retained and changed structures with policy-valid ranges", () => {
    const challenge = createDeterministicChallenge({ ...source, forceDimension: "input" });
    const result = scoreTransferResponse(challenge, answerFor(challenge));
    expect(result).toMatchObject({ score: 4, passed: true });
    expect(result.criteria.changedParts).toEqual({ passed: true, reasonCode: "CHANGE_TARGETED" });
    expect(result.criteria.normalization).toEqual({ passed: true, reasonCode: "NORMALIZATION_VALID" });
  });

  it("fails exact structural checks when a second dimension is changed", () => {
    const challenge = createDeterministicChallenge({ ...source, forceDimension: "input" });
    const answer = answerFor(challenge);
    answer.retainedStructure.output = "灯光亮度输出";
    const result = scoreTransferResponse(challenge, answer);
    expect(result.criteria.retainedStructure).toEqual({ passed: false, reasonCode: "RETAINED_MISMATCH" });
    expect(result.passed).toBe(false);
  });

  it("requires exact challenge dimension/from/to instead of keyword similarity", () => {
    const challenge = createDeterministicChallenge({ ...source, forceDimension: "input" });
    const answer = answerFor(challenge);
    answer.changedParts = { ...answer.changedParts, dimension: "output", from: "投影", to: "灯光" };
    const result = scoreTransferResponse(challenge, answer);
    expect(result.criteria.changedParts).toEqual({ passed: false, reasonCode: "CHANGE_MISMATCH" });
    expect(result.passed).toBe(false);
  });

  it("rejects unreasonable or arbitrary units and requires a 0..1 target", () => {
    const challenge = createDeterministicChallenge({ ...source, forceDimension: "input" });
    const wrongUnit = answerFor(challenge);
    wrongUnit.normalization.sourceUnit = "cm";
    expect(scoreTransferResponse(challenge, wrongUnit).criteria.normalization)
      .toEqual({ passed: false, reasonCode: "NORMALIZATION_INVALID_UNIT" });
    const wrongTarget = answerFor(challenge);
    wrongTarget.normalization.targetMax = 100;
    expect(scoreTransferResponse(challenge, wrongTarget).criteria.normalization)
      .toEqual({ passed: false, reasonCode: "NORMALIZATION_INVALID_RANGE" });
  });

  it("rejects cultural keyword piles and same-behavior submissions at the schema", () => {
    const challenge = createDeterministicChallenge({ ...source, forceDimension: "input" });
    expect(TransferAnswerSchema.safeParse({
      ...answerFor(challenge),
      culturalImpact: { audience: "观众文化参与", behaviorChange: "主动共同回应", connectionToIntent: "石刻文化文化文化" },
    }).success).toBe(false);
    const same = answerFor(challenge);
    same.culturalImpact.behaviorAfter = same.culturalImpact.behaviorBefore;
    expect(TransferAnswerSchema.safeParse(same).success).toBe(false);
    expect(TransferAnswerSchema.safeParse({ ...answerFor(challenge), score: 4 }).success).toBe(false);
  });

  it("fails controlled cultural choices for a wrong anchor, transition, or dimension mechanism", () => {
    const challenge = createDeterministicChallenge({ ...source, forceDimension: "input" });
    const wrongAnchor = answerFor(challenge);
    wrongAnchor.culturalImpact.intentAnchorId = "intent_0000000000000000";
    expect(scoreTransferResponse(challenge, wrongAnchor).criteria.culturalImpact)
      .toEqual({ passed: false, reasonCode: "CULTURAL_INVALID_ANCHOR" });
    const wrongTransition = answerFor(challenge);
    wrongTransition.culturalImpact.behaviorBefore = "REFLECTIVE_SHARING";
    wrongTransition.culturalImpact.behaviorAfter = "ACTIVE_EXPLORATION";
    expect(scoreTransferResponse(challenge, wrongTransition).criteria.culturalImpact)
      .toEqual({ passed: false, reasonCode: "CULTURAL_INVALID_TRANSITION" });
    const wrongMechanism = answerFor(challenge);
    wrongMechanism.culturalImpact.mechanism = "SENSORY_FEEDBACK";
    expect(scoreTransferResponse(challenge, wrongMechanism).criteria.culturalImpact)
      .toEqual({ passed: false, reasonCode: "CULTURAL_INVALID_MECHANISM" });
  });

  it("binds every criterion reason and feedback slot to its boolean outcome", () => {
    const challenge = createDeterministicChallenge({ ...source, forceDimension: "input" });
    const passed = scoreTransferResponse(challenge, answerFor(challenge));
    expect(passed.feedback).toEqual({ retained: false, changed: false, normalization: false, cultural: false, teacherReview: false, aiCode: null });
    expect(TransferRubricSchema.safeParse({
      ...passed,
      criteria: { ...passed.criteria, retainedStructure: { passed: true, reasonCode: "RETAINED_MISMATCH" } },
    }).success).toBe(false);
    expect(TransferRubricSchema.safeParse({ ...passed, feedback: { ...passed.feedback, cultural: true } }).success).toBe(false);
  });

  it("binds public remaining attempts and latest rubric to the challenge status", () => {
    const snapshot = createDeterministicChallenge(source);
    const challenge = {
      projectId: snapshot.projectId, challengeRevision: snapshot.challengeRevision,
      changedDimension: snapshot.changedDimension, prompt: snapshot.prompt, mustRetain: snapshot.mustRetain,
      change: snapshot.change, unitPolicy: snapshot.unitPolicy, culturalPolicy: snapshot.culturalPolicy, path: snapshot.path,
    };
    const passed = scoreTransferResponse(snapshot, answerFor(snapshot));
    expect(TransferPublicStateSchema.safeParse({
      challenge, status: "OPEN", attemptsUsed: 0, attemptsRemaining: 2, locked: false, latestRubric: passed,
    }).success).toBe(false);
    expect(TransferPublicStateSchema.safeParse({
      challenge, status: "PASSED", attemptsUsed: 1, attemptsRemaining: 1, locked: false, latestRubric: passed,
    }).success).toBe(false);
    expect(TransferPublicStateSchema.safeParse({
      challenge, status: "PASSED", attemptsUsed: 1, attemptsRemaining: 0, locked: false, latestRubric: passed,
    }).success).toBe(true);
    expect(TransferPublicStateSchema.safeParse({
      challenge, status: "PASSED", attemptsUsed: 0, attemptsRemaining: 0, locked: false, latestRubric: passed,
    }).success).toBe(false);
    const lockedRubric = {
      ...passed, passed: false, outcome: "LOCKED",
      criteria: { ...passed.criteria, retainedStructure: { passed: false, reasonCode: "RETAINED_MISMATCH" } },
      score: 3,
      feedback: { ...passed.feedback, retained: true, teacherReview: true },
    } as const;
    expect(TransferPublicStateSchema.safeParse({
      challenge, status: "LOCKED", attemptsUsed: 1, attemptsRemaining: 0, locked: true, latestRubric: lockedRubric,
    }).success).toBe(false);
  });
});

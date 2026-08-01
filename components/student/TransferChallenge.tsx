"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
  TransferPublicStateSchema,
  createEmptyTransferAnswerDraft,
  draftToAnswer,
  type TransferAnswerDraft,
  type TransferPublicState,
} from "@/lib/domain/transfer";

const criterionLabels = {
  retainedStructure: "保留结构",
  changedParts: "单一改变",
  normalization: "数值处理",
  culturalImpact: "文化影响",
} as const;
const dimensionLabels = { input: "输入", mapping: "映射", output: "输出" } as const;
const audienceLabels = {
  GENERAL_VISITORS: "一般参观者", YOUNG_LEARNERS: "青少年学习者", COMMUNITY_MEMBERS: "社区成员",
  CULTURAL_HERITAGE_AUDIENCE: "文化遗产受众",
} as const;
const behaviorLabels = {
  PASSIVE_VIEWING: "被动观看", FOLLOWING_INSTRUCTIONS: "跟随指令", INDIVIDUAL_INTERACTION: "个人互动",
  ACTIVE_EXPLORATION: "主动探索", COLLABORATIVE_CREATION: "协作创作", REFLECTIVE_SHARING: "反思分享",
} as const;
const mechanismLabels = {
  PARTICIPATORY_TRIGGER: "参与式触发", COLLECTIVE_RESPONSE: "集体响应", NARRATIVE_MAPPING: "叙事映射",
  SENSORY_FEEDBACK: "感官反馈", CULTURAL_SYMBOL_REINFORCEMENT: "文化符号强化",
} as const;

export function TransferChallenge({
  projectId, stage, initialState = null, onPassed, onChanged, fetchImpl = fetch,
}: {
  projectId: string;
  stage: string;
  initialState?: TransferPublicState | null;
  onPassed?: (state: TransferPublicState) => void;
  onChanged?: (state: TransferPublicState) => void;
  fetchImpl?: typeof fetch;
}) {
  const [localState, setState] = useState<TransferPublicState | null>(initialState);
  const [draft, setDraft] = useState<TransferAnswerDraft | null>(initialState ? createEmptyTransferAnswerDraft() : null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const notified = useRef<string | null>(null);
  const challengeKey = useRef<string | null>(initialState ? `${initialState.challenge.projectId}:${initialState.challenge.challengeRevision}` : null);
  const hydratedServerKey = useRef<string | null>(initialState ? `${initialState.challenge.projectId}:${initialState.challenge.challengeRevision}` : null);
  const workflowKey = `${projectId}:${stage}`;
  const hydratedWorkflowKey = useRef(workflowKey);
  const state = initialState && (!localState || initialState.challenge.challengeRevision > localState.challenge.challengeRevision || initialState.attemptsUsed > localState.attemptsUsed) ? initialState : localState;
  const incomingKey = initialState ? `${initialState.challenge.projectId}:${initialState.challenge.challengeRevision}` : null;
  const revisionMismatch = Boolean(initialState && localState && incomingKey !== `${localState.challenge.projectId}:${localState.challenge.challengeRevision}`);

  useEffect(() => {
    let active = true;
    if (hydratedWorkflowKey.current !== workflowKey) {
      hydratedWorkflowKey.current = workflowKey;
      hydratedServerKey.current = incomingKey;
      sequence.current += 1; controller.current?.abort(); inFlight.current = false; notified.current = null;
      queueMicrotask(() => {
        if (!active) return;
        setState(initialState); setDraft(initialState ? createEmptyTransferAnswerDraft() : null); setPending(false); setError(""); challengeKey.current = incomingKey;
      });
    }
    return () => {
      active = false; sequence.current += 1; controller.current?.abort(); controller.current = null; inFlight.current = false;
    };
    // Same-revision snapshots are reconciled without resetting the current answer draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowKey]);

  useEffect(() => {
    if (!initialState || !incomingKey) return;
    const changedChallenge = hydratedServerKey.current !== incomingKey;
    hydratedServerKey.current = incomingKey;
    let active = true;
    if (changedChallenge) {
      sequence.current += 1; controller.current?.abort(); controller.current = null; inFlight.current = false;
    }
    queueMicrotask(() => {
      if (!active) return;
      setState(initialState);
      if (changedChallenge) {
        challengeKey.current = incomingKey; setDraft(createEmptyTransferAnswerDraft()); setError(""); setPending(false); notified.current = null;
      }
    });
    return () => { active = false; };
  }, [incomingKey, initialState]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function showError(message: string) { setError(message); }

  async function send(body: unknown) {
    if (inFlight.current || stage !== "TRANSFER") return;
    inFlight.current = true;
    const requestSequence = ++sequence.current;
    const currentProject = projectId;
    const abort = new AbortController(); controller.current = abort;
    setPending(true); setError("");
    try {
      const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/transfer`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: abort.signal,
      });
      const payload: unknown = await response.json();
      if (requestSequence !== sequence.current || currentProject !== projectId || abort.signal.aborted) return;
      if (!response.ok) {
        const parsedError = z.object({ error: z.string().max(200).optional() }).passthrough().safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error ?? "迁移挑战请求失败" : "迁移挑战请求失败");
      }
      const parsed = TransferPublicStateSchema.safeParse(payload);
      if (!parsed.success) throw new Error("迁移挑战响应无效");
      const nextChallengeKey = `${parsed.data.challenge.projectId}:${parsed.data.challenge.challengeRevision}`;
      if (challengeKey.current !== nextChallengeKey) {
        challengeKey.current = nextChallengeKey;
        setDraft(createEmptyTransferAnswerDraft());
      }
      setState(parsed.data);
      onChanged?.(parsed.data);
      if (parsed.data.status === "PASSED") {
        const key = `${parsed.data.challenge.projectId}:${parsed.data.challenge.challengeRevision}`;
        if (notified.current !== key) { notified.current = key; onPassed?.(parsed.data); }
      }
    } catch (reason) {
      if (requestSequence !== sequence.current || abort.signal.aborted) return;
      showError(reason instanceof Error ? reason.message : "迁移挑战请求失败");
    } finally {
      if (requestSequence === sequence.current) { setPending(false); controller.current = null; inFlight.current = false; }
    }
  }

  function patchSection<K extends keyof TransferAnswerDraft>(section: K, patch: Partial<TransferAnswerDraft[K]>) {
    setDraft((current) => current ? { ...current, [section]: { ...current[section], ...patch } } : current);
  }
  function focusFirstIncomplete() {
    const controls = Array.from(formRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-transfer-required]") ?? []);
    (controls.find((control) => control.dataset.transferError === "true") ??
      controls.find(({ value }) => value.trim() === "") ?? controls[0])?.focus();
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || !draft || state.status !== "OPEN" || pending || revisionMismatch) return;
    const answer = draftToAnswer(draft);
    if (!answer) {
      showError("请完成所有必填项，并确认数值范围有效。");
      setTimeout(focusFirstIncomplete, 0);
      return;
    }
    void send({ action: "SUBMIT", challengeRevision: state.challenge.challengeRevision, expectedAttempt: state.attemptsUsed, answer });
  }

  const answer = draft && !revisionMismatch ? draftToAnswer(draft) : null;
  const textError = (value: string, label: string, min: number, max: number) =>
    value.length > max ? `${label}最多${max}字。` : value.length > 0 && value.trim().length < min ? `${label}至少${min}字。` : "";
  const fieldErrors = draft ? {
    culturalIntent: textError(draft.retainedStructure.culturalIntent, "文化意图", 2, 500),
    input: textError(draft.retainedStructure.input, "输入", 2, 500),
    mapping: textError(draft.retainedStructure.mapping, "映射", 2, 500),
    output: textError(draft.retainedStructure.output, "输出", 2, 500),
    from: textError(draft.changedParts.from, "改变前", 2, 500),
    to: textError(draft.changedParts.to, "改变后", 2, 500),
    rationale: textError(draft.changedParts.rationale, "改变理由", 10, 300),
  } : null;

  if (stage !== "TRANSFER") return null;
  return (
    <section aria-labelledby="transfer-title">
      <h2 id="transfer-title">迁移挑战</h2>
      {!state && <button type="button" disabled={pending} onClick={() => void send({ action: "START" })}>{pending ? "生成中" : "生成迁移挑战"}</button>}
      {pending && <button type="button" onClick={() => controller.current?.abort()}>取消</button>}
      {error && <p ref={errorRef} tabIndex={-1} role="alert" aria-live="assertive">{error}</p>}
      {state && draft && <div>
        <p>{state.challenge.prompt}</p>
        <h3>本次改变</h3>
        <p>{dimensionLabels[state.challenge.changedDimension]}：{state.challenge.change.from} → {state.challenge.change.to}</p>
        <h3>其余保留</h3>
        <ul>
          <li>文化意图：{state.challenge.mustRetain.culturalIntent}</li>
          <li>输入：{state.challenge.mustRetain.input}{state.challenge.changedDimension === "input" ? "（本次改变）" : "（保留）"}</li>
          <li>映射：{state.challenge.mustRetain.mapping}{state.challenge.changedDimension === "mapping" ? "（本次改变）" : "（保留）"}</li>
          <li>输出：{state.challenge.mustRetain.output}{state.challenge.changedDimension === "output" ? "（本次改变）" : "（保留）"}</li>
        </ul>
        <h3>允许的数值与文化选项</h3>
        <ul>
          <li>源范围：{state.challenge.unitPolicy.sourceRanges.map(({ unit, minInclusive, maxInclusive }) => `${unit} ${minInclusive}–${maxInclusive}`).join("；")}</li>
          <li>目标范围：{state.challenge.unitPolicy.targetMin}–{state.challenge.unitPolicy.targetMax} {state.challenge.unitPolicy.targetUnit}</li>
          <li>文化意图锚点：{state.challenge.culturalPolicy.intentAnchor.label}</li>
          <li>行为转变：{state.challenge.culturalPolicy.allowedTransitions.map(({ before, after }) => `${behaviorLabels[before]}→${behaviorLabels[after]}`).join("；")}</li>
          <li>作用机制：{state.challenge.culturalPolicy.allowedMechanisms.map((item) => mechanismLabels[item]).join("、")}</li>
        </ul>
        <p>剩余作答次数：{state.attemptsRemaining}</p>
        {state.status === "LOCKED" && <p role="alert">两次作答均未通过，已请求教师介入。</p>}
        {state.status === "PASSED" && <p role="status" aria-live="polite">迁移挑战已通过，项目闭环完成。</p>}
        <form ref={formRef} aria-label="迁移挑战回答" onSubmit={submit}>
          <fieldset disabled={pending || state.status !== "OPEN"}>
            <legend>一、保留结构</legend>
            <label>保留：文化意图<input data-transfer-required data-transfer-error={Boolean(fieldErrors?.culturalIntent)} aria-label="保留：文化意图" aria-describedby={fieldErrors?.culturalIntent ? "transfer-error-cultural-intent" : undefined} maxLength={500} value={draft.retainedStructure.culturalIntent} onChange={(event) => patchSection("retainedStructure", { culturalIntent: event.target.value })} />{fieldErrors?.culturalIntent && <span id="transfer-error-cultural-intent">{fieldErrors.culturalIntent}</span>}</label>
            <label>保留：输入<input data-transfer-required data-transfer-error={Boolean(fieldErrors?.input)} aria-label="保留：输入" aria-describedby={fieldErrors?.input ? "transfer-error-input" : undefined} maxLength={500} value={draft.retainedStructure.input} onChange={(event) => patchSection("retainedStructure", { input: event.target.value })} />{fieldErrors?.input && <span id="transfer-error-input">{fieldErrors.input}</span>}</label>
            <label>保留：映射<input data-transfer-required data-transfer-error={Boolean(fieldErrors?.mapping)} aria-label="保留：映射" aria-describedby={fieldErrors?.mapping ? "transfer-error-mapping" : undefined} maxLength={500} value={draft.retainedStructure.mapping} onChange={(event) => patchSection("retainedStructure", { mapping: event.target.value })} />{fieldErrors?.mapping && <span id="transfer-error-mapping">{fieldErrors.mapping}</span>}</label>
            <label>保留：输出<input data-transfer-required data-transfer-error={Boolean(fieldErrors?.output)} aria-label="保留：输出" aria-describedby={fieldErrors?.output ? "transfer-error-output" : undefined} maxLength={500} value={draft.retainedStructure.output} onChange={(event) => patchSection("retainedStructure", { output: event.target.value })} />{fieldErrors?.output && <span id="transfer-error-output">{fieldErrors.output}</span>}</label>
          </fieldset>
          <fieldset disabled={pending || state.status !== "OPEN"}>
            <legend>二、改变部分</legend>
            <label>改变维度<select data-transfer-required aria-label="改变维度" value={draft.changedParts.dimension} onChange={(event) => patchSection("changedParts", { dimension: event.target.value as TransferAnswerDraft["changedParts"]["dimension"] })}><option value="">请选择</option>{Object.entries(dimensionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>改变前<input data-transfer-required data-transfer-error={Boolean(fieldErrors?.from)} aria-label="改变前" aria-describedby={fieldErrors?.from ? "transfer-error-from" : undefined} maxLength={500} value={draft.changedParts.from} onChange={(event) => patchSection("changedParts", { from: event.target.value })} />{fieldErrors?.from && <span id="transfer-error-from">{fieldErrors.from}</span>}</label>
            <label>改变后<input data-transfer-required data-transfer-error={Boolean(fieldErrors?.to)} aria-label="改变后" aria-describedby={fieldErrors?.to ? "transfer-error-to" : undefined} maxLength={500} value={draft.changedParts.to} onChange={(event) => patchSection("changedParts", { to: event.target.value })} />{fieldErrors?.to && <span id="transfer-error-to">{fieldErrors.to}</span>}</label>
            <label>改变理由（可选）<textarea aria-label="改变理由（可选）" aria-describedby={fieldErrors?.rationale ? "transfer-error-rationale" : undefined} maxLength={300} value={draft.changedParts.rationale} onChange={(event) => patchSection("changedParts", { rationale: event.target.value })} />{fieldErrors?.rationale && <span id="transfer-error-rationale">{fieldErrors.rationale}</span>}</label>
          </fieldset>
          <fieldset disabled={pending || state.status !== "OPEN"}>
            <legend>三、数值处理</legend>
            <label>源最小值<input data-transfer-required aria-label="源最小值" type="number" value={draft.normalization.sourceMin} onChange={(event) => patchSection("normalization", { sourceMin: event.target.value })} /></label>
            <label>源最大值<input data-transfer-required aria-label="源最大值" type="number" value={draft.normalization.sourceMax} onChange={(event) => patchSection("normalization", { sourceMax: event.target.value })} /></label>
            <label>源单位<select data-transfer-required aria-label="源单位" value={draft.normalization.sourceUnit} onChange={(event) => patchSection("normalization", { sourceUnit: event.target.value as TransferAnswerDraft["normalization"]["sourceUnit"] })}><option value="">请选择</option>{state.challenge.unitPolicy.sourceRanges.map(({ unit }) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
            <label>目标最小值<input data-transfer-required aria-label="目标最小值" type="number" value={draft.normalization.targetMin} onChange={(event) => patchSection("normalization", { targetMin: event.target.value })} /></label>
            <label>目标最大值<input data-transfer-required aria-label="目标最大值" type="number" value={draft.normalization.targetMax} onChange={(event) => patchSection("normalization", { targetMax: event.target.value })} /></label>
            <label>目标单位<select data-transfer-required aria-label="目标单位" value={draft.normalization.targetUnit} onChange={(event) => patchSection("normalization", { targetUnit: event.target.value as TransferAnswerDraft["normalization"]["targetUnit"] })}><option value="">请选择</option><option value="normalized">normalized</option></select></label>
            <label>关系<select data-transfer-required aria-label="关系" value={draft.normalization.relationship} onChange={(event) => patchSection("normalization", { relationship: event.target.value as TransferAnswerDraft["normalization"]["relationship"] })}><option value="">请选择</option>{state.challenge.unitPolicy.allowedRelationships.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </fieldset>
          <fieldset disabled={pending || state.status !== "OPEN"}>
            <legend>四、文化影响</legend>
            <label>受众类型<select data-transfer-required aria-label="受众类型" value={draft.culturalImpact.audienceType} onChange={(event) => patchSection("culturalImpact", { audienceType: event.target.value as TransferAnswerDraft["culturalImpact"]["audienceType"] })}><option value="">请选择</option>{state.challenge.culturalPolicy.allowedAudienceTypes.map((item) => <option key={item} value={item}>{audienceLabels[item]}</option>)}</select></label>
            <label>行为改变前<select data-transfer-required aria-label="行为改变前" value={draft.culturalImpact.behaviorBefore} onChange={(event) => patchSection("culturalImpact", { behaviorBefore: event.target.value as TransferAnswerDraft["culturalImpact"]["behaviorBefore"], behaviorAfter: "" })}><option value="">请选择</option>{state.challenge.culturalPolicy.allowedTransitions.map(({ before }) => <option key={before} value={before}>{behaviorLabels[before]}</option>)}</select></label>
            <label>行为改变后<select data-transfer-required aria-label="行为改变后" value={draft.culturalImpact.behaviorAfter} onChange={(event) => patchSection("culturalImpact", { behaviorAfter: event.target.value as TransferAnswerDraft["culturalImpact"]["behaviorAfter"] })}><option value="">请选择</option>{state.challenge.culturalPolicy.allowedTransitions.filter(({ before }) => before === draft.culturalImpact.behaviorBefore).map(({ after }) => <option key={after} value={after}>{behaviorLabels[after]}</option>)}</select></label>
            <label>文化意图锚点<select data-transfer-required aria-label="文化意图锚点" value={draft.culturalImpact.intentAnchorId} onChange={(event) => patchSection("culturalImpact", { intentAnchorId: event.target.value })}><option value="">请选择</option><option value={state.challenge.culturalPolicy.intentAnchor.id}>{state.challenge.culturalPolicy.intentAnchor.label}</option></select></label>
            <label>作用机制<select data-transfer-required aria-label="作用机制" value={draft.culturalImpact.mechanism} onChange={(event) => patchSection("culturalImpact", { mechanism: event.target.value as TransferAnswerDraft["culturalImpact"]["mechanism"] })}><option value="">请选择</option>{state.challenge.culturalPolicy.allowedMechanisms.map((item) => <option key={item} value={item}>{mechanismLabels[item]}</option>)}</select></label>
          </fieldset>
          {state.status === "OPEN" && !answer && <p id="transfer-submit-help" aria-live="polite">填写全部必填字段后才可提交。</p>}
          <button type="submit" aria-describedby={!answer ? "transfer-submit-help" : undefined} disabled={pending || state.status !== "OPEN" || !answer}>{pending ? "评分中" : "提交迁移回答"}</button>
        </form>
        {state.latestRubric && <div aria-labelledby="transfer-rubric-title">
          <h3 id="transfer-rubric-title">迁移量规</h3>
          <ul>{Object.entries(state.latestRubric.criteria).map(([key, criterion]) => <li key={key}>{criterionLabels[key as keyof typeof criterionLabels]}：{criterion.passed ? "通过" : "需要修改"}</li>)}</ul>
          <p>确定性得分：{state.latestRubric.score}/4</p>
          <ul>
            {state.latestRubric.feedback.retained && <li>请逐项核对文化意图、输入、映射和输出。</li>}
            {state.latestRubric.feedback.changed && <li>改变维度、原值和目标值必须与挑战完全一致。</li>}
            {state.latestRubric.feedback.normalization && <li>请使用挑战允许的单位、有效范围和0到1目标范围。</li>}
            {state.latestRubric.feedback.cultural && <li>请从挑战提供的受众、行为转变、意图锚点和作用机制中选择。</li>}
            {state.latestRubric.feedback.teacherReview && <li>两次作答后仍未通过，请教师介入复核。</li>}
          </ul>
        </div>}
      </div>}
    </section>
  );
}

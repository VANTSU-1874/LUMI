"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  EvidenceApiErrorSchema,
  EvidenceNumericValueSchema,
  MAX_EVIDENCE_VALUE,
  MIN_EVIDENCE_VALUE,
  PublicEvidenceRecordSchema,
  type PublicEvidenceRecord,
} from "@/lib/domain/evidence";
import type { ToolPath } from "@/lib/domain/schemas";
import type { ToolPathRequirements } from "@/lib/domain/tool-path";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
type EvidenceKind = "VALUE" | "TEXT" | "VIDEO_LINK" | "IMAGE" | "PROBE";
const EMPTY_PROBE_FIELDS = {
  firstCondition: "", firstValue: "", secondCondition: "", secondValue: "", unit: "",
  inputMin: "", inputMax: "", outputMin: "", outputMax: "", relationship: "DIRECT",
  host: "127.0.0.1", port: "7000", receivedValue: "",
  sourceChannel: "", targetChannel: "",
  source: "", target: "", observedBefore: "", observedAfter: "",
  parameter: "", before: "", after: "",
};

export function EvidencePanel({
  projectId,
  toolPath = null,
  onSaved,
  fetchImpl = fetch,
}: {
  projectId: string;
  toolPath?: { path: ToolPath; requirements: ToolPathRequirements } | null;
  onSaved?: (record: PublicEvidenceRecord) => void;
  fetchImpl?: typeof fetch;
}) {
  const [kind, setKind] = useState<EvidenceKind>("VALUE");
  const [label, setLabel] = useState("");
  const [signalLayer, setSignalLayer] = useState("INPUT");
  const [value, setValue] = useState("");
  const [valueInvalid, setValueInvalid] = useState(false);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [probeFields, setProbeFields] = useState(EMPTY_PROBE_FIELDS);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const toolPathSignature = `${toolPath?.path ?? "NONE"}:${toolPath?.requirements.hasOsc ?? "NONE"}`;
  const transportMode = toolPath?.path === "COLLABORATIVE" && toolPath.requirements.hasOsc
    ? "OSC" as const
    : (toolPath?.path === "DIGISHOW" || toolPath?.path === "TOUCHDESIGNER") && !toolPath.requirements.hasOsc
      ? "LOCAL" as const
      : null;
  const transportPathLabel = toolPath?.path === "DIGISHOW"
    ? "DigiShow单工具路径"
    : toolPath?.path === "TOUCHDESIGNER"
      ? "TouchDesigner单工具路径"
      : toolPath?.path === "COLLABORATIVE"
        ? "DigiShow + TouchDesigner协同路径"
        : null;
  const transportBlocked = kind === "PROBE" && signalLayer === "TRANSPORT" && transportMode === null;

  useEffect(() => {
    let active = true;
    sequence.current += 1;
    controller.current?.abort();
    controller.current = null;
    queueMicrotask(() => {
      if (!active) return;
      setPending(false);
      setKind("VALUE");
      setLabel("");
      setSignalLayer("INPUT");
      setValue("");
      setText("");
      setUrl("");
      setProgress(0);
      setMessage("");
      setMessageIsError(false);
      setFile(null);
      setProbeFields(EMPTY_PROBE_FIELDS);
      setValueInvalid(false);
    });
    return () => {
      active = false;
      sequence.current += 1;
      controller.current?.abort();
      controller.current = null;
    };
  }, [projectId, toolPathSignature]);

  useEffect(() => {
    if (message && messageIsError) messageRef.current?.focus();
  }, [message, messageIsError]);

  function showError(next: string) {
    setMessageIsError(true);
    setMessage(next);
  }

  function showStatus(next: string) {
    setMessageIsError(false);
    setMessage(next);
  }

  function selectFile(next: File | null) {
    if (!next) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(next.type)) {
      showError("仅支持PNG、JPEG或WebP图片");
      setFile(null);
      return;
    }
    if (next.size === 0 || next.size > MAX_IMAGE_BYTES) {
      showError(next.size === 0 ? "图片文件不能为空" : "图片不能超过5MiB");
      setFile(null);
      return;
    }
    setKind("IMAGE");
    setFile(next);
    showStatus(`已粘贴：${next.name}`);
  }

  function probeForLayer() {
    const number = (field: keyof typeof probeFields) => {
      const raw = probeFields[field].trim();
      return raw === "" ? Number.NaN : Number(raw);
    };
    if (signalLayer === "INPUT") return {
      type: "INPUT_MEASUREMENT", firstCondition: probeFields.firstCondition, firstValue: number("firstValue"),
      secondCondition: probeFields.secondCondition, secondValue: number("secondValue"), unit: probeFields.unit,
    };
    if (signalLayer === "MAPPING") return {
      type: "MAPPING_RANGE", inputMin: number("inputMin"), inputMax: number("inputMax"),
      outputMin: number("outputMin"), outputMax: number("outputMax"), relationship: probeFields.relationship,
    };
    if (signalLayer === "TRANSPORT") return {
      ...(transportMode === "LOCAL"
        ? { type: "LOCAL_CHANNEL_RECEIPT", sourceChannel: probeFields.sourceChannel, targetChannel: probeFields.targetChannel }
        : { type: "TRANSPORT_RECEIPT", protocol: "OSC", host: probeFields.host, port: number("port") }),
      receivedValue: number("receivedValue"),
    };
    if (signalLayer === "BINDING") return {
      type: "BINDING_OBSERVATION", source: probeFields.source, target: probeFields.target,
      observedBefore: number("observedBefore"), observedAfter: number("observedAfter"),
    };
    return {
      type: "OUTPUT_COMPARISON", parameter: probeFields.parameter,
      before: number("before"), after: number("after"),
    };
  }

  function updateProbe(field: keyof typeof probeFields, next: string) {
    setProbeFields((current) => ({ ...current, [field]: next }));
  }

  function onPaste(event: React.ClipboardEvent) {
    const image = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
    if (image) {
      event.preventDefault();
      selectFile(image);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!label.trim()) { showError("请填写标签"); return; }
    if (kind === "IMAGE" && !file) { showError("请选择图片"); return; }
    if (transportBlocked) {
      showError(toolPath ? "当前工具路径配置与传输方式不一致，请重新生成工具路径" : "请先完成工具路径，再记录传输层验证");
      return;
    }
    const trimmedValue = value.trim();
    const numericValue = trimmedValue === "" ? undefined : Number(trimmedValue);
    if (kind === "VALUE" && !EvidenceNumericValueSchema.safeParse(numericValue).success) {
      setValueInvalid(true);
      showError("请输入有限数值（-10亿到10亿）");
      return;
    }
    setValueInvalid(false);
    const currentSequence = ++sequence.current;
    const currentProject = projectId;
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setProgress(10);
    setMessage("");
    setMessageIsError(false);
    let body: BodyInit;
    let headers: HeadersInit | undefined;
    if (kind === "IMAGE") {
      const form = new FormData();
      form.set("kind", "IMAGE"); form.set("label", label.trim()); form.set("signalLayer", signalLayer);
      form.set("file", file!);
      body = form;
    } else {
      body = JSON.stringify({
        kind, label: label.trim(), signalLayer,
        ...(kind === "VALUE" ? { value: numericValue }
          : kind === "TEXT" ? { text }
            : kind === "VIDEO_LINK" ? { url }
              : { probe: probeForLayer() }),
      });
      headers = { "content-type": "application/json" };
    }
    try {
      setProgress(40);
      const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/evidence`, {
        method: "POST", headers, body, signal: abort.signal,
      });
      const rawPayload: unknown = await response.json();
      if (currentSequence !== sequence.current || currentProject !== projectId) return;
      if (!response.ok) {
        const error = EvidenceApiErrorSchema.safeParse(rawPayload);
        throw new Error(error.success ? error.data.error : "证据保存失败");
      }
      const parsed = PublicEvidenceRecordSchema.safeParse(rawPayload);
      if (!parsed.success) throw new Error("服务器返回了无效的证据记录");
      const payload = parsed.data;
      setProgress(100);
      showStatus(payload.verificationStatus === "RULE_VERIFIED"
        ? "结构化证据已验证，可用于推进排障"
        : "证据已保存，等待规则或教师确认");
      onSaved?.(payload);
    } catch (error) {
      if (currentSequence !== sequence.current || abort.signal.aborted) return;
      showError(error instanceof Error ? error.message : "证据保存失败");
    } finally {
      if (currentSequence === sequence.current) {
        setPending(false);
        controller.current = null;
      }
    }
  }

  return (
    <section data-testid="evidence-panel" onPaste={onPaste} aria-labelledby="evidence-title">
      <h2 id="evidence-title">证据记录</h2>
      <form noValidate onSubmit={submit}>
        <label>证据类型
          <select aria-label="证据类型" value={kind} onChange={(event) => { setKind(event.target.value as EvidenceKind); setFile(null); setMessage(""); setMessageIsError(false); }}>
            <option value="VALUE">数值</option><option value="TEXT">文本</option>
            <option value="VIDEO_LINK">外部视频链接</option><option value="IMAGE">图片</option>
            <option value="PROBE">结构化验证</option>
          </select>
        </label>
        <label>信号层
          <select value={signalLayer} onChange={(event) => setSignalLayer(event.target.value)}>
            <option value="INPUT">输入</option><option value="MAPPING">映射</option><option value="TRANSPORT">传输</option>
            <option value="BINDING">绑定</option><option value="OUTPUT">输出</option>
          </select>
        </label>
        <label>标签<input aria-label="标签" value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} /></label>
        {kind === "VALUE" && <label>数值<input aria-label="数值" type="number" inputMode="decimal" required min={MIN_EVIDENCE_VALUE} max={MAX_EVIDENCE_VALUE} aria-invalid={valueInvalid} aria-describedby={valueInvalid ? "evidence-value-error" : undefined} value={value} onChange={(event) => { setValue(event.target.value); setValueInvalid(false); }} /></label>}
        {kind === "TEXT" && <label>文本<textarea aria-label="文本" value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} /></label>}
        {kind === "VIDEO_LINK" && <label>HTTPS链接<input aria-label="HTTPS链接" type="url" value={url} maxLength={2000} onChange={(event) => setUrl(event.target.value)} /></label>}
        {kind === "IMAGE" && <label>图片文件<input aria-label="图片文件" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} /></label>}
        {kind === "PROBE" && signalLayer === "INPUT" && <fieldset><legend>输入层对照测量</legend>
          <label>条件一<input aria-label="条件一" value={probeFields.firstCondition} onChange={(event) => updateProbe("firstCondition", event.target.value)} /></label>
          <label>条件一数值<input aria-label="条件一数值" type="number" value={probeFields.firstValue} onChange={(event) => updateProbe("firstValue", event.target.value)} /></label>
          <label>条件二<input aria-label="条件二" value={probeFields.secondCondition} onChange={(event) => updateProbe("secondCondition", event.target.value)} /></label>
          <label>条件二数值<input aria-label="条件二数值" type="number" value={probeFields.secondValue} onChange={(event) => updateProbe("secondValue", event.target.value)} /></label>
          <label>单位<input aria-label="单位" value={probeFields.unit} onChange={(event) => updateProbe("unit", event.target.value)} /></label>
        </fieldset>}
        {kind === "PROBE" && signalLayer === "MAPPING" && <fieldset><legend>映射层范围验证</legend>
          {(["inputMin", "inputMax", "outputMin", "outputMax"] as const).map((field) => <label key={field}>{field}<input aria-label={field} type="number" value={probeFields[field]} onChange={(event) => updateProbe(field, event.target.value)} /></label>)}
          <label>映射关系<select aria-label="映射关系" value={probeFields.relationship} onChange={(event) => updateProbe("relationship", event.target.value)}><option value="DIRECT">正向</option><option value="INVERSE">反向</option><option value="THRESHOLD">阈值</option></select></label>
        </fieldset>}
        {kind === "PROBE" && signalLayer === "TRANSPORT" && <div className="space-y-3">
          {transportPathLabel && <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">当前路径：{transportPathLabel}</p>}
          {transportMode === "LOCAL" && <fieldset><legend>本地通道传递验证</legend>
            <p className="text-sm text-slate-600">记录同一工具内数值从哪个通道到达哪个通道，证明信号确实完成传递。</p>
            <label>源通道<input aria-label="源通道" required value={probeFields.sourceChannel} onChange={(event) => updateProbe("sourceChannel", event.target.value)} /></label>
            <label>目标通道<input aria-label="目标通道" required value={probeFields.targetChannel} onChange={(event) => updateProbe("targetChannel", event.target.value)} /></label>
            <label>接收值<input aria-label="本地接收值" required type="number" inputMode="decimal" value={probeFields.receivedValue} onChange={(event) => updateProbe("receivedValue", event.target.value)} /></label>
          </fieldset>}
          {transportMode === "OSC" && <fieldset><legend>OSC跨软件接收验证</legend>
            <p className="text-sm text-slate-600">记录TouchDesigner接收DigiShow信号时使用的地址、端口和实际接收值。</p>
            <label>主机<input aria-label="OSC主机" required value={probeFields.host} onChange={(event) => updateProbe("host", event.target.value)} /></label>
            <label>端口<input aria-label="OSC端口" required type="number" value={probeFields.port} onChange={(event) => updateProbe("port", event.target.value)} /></label>
            <label>接收值<input aria-label="OSC接收值" required type="number" inputMode="decimal" value={probeFields.receivedValue} onChange={(event) => updateProbe("receivedValue", event.target.value)} /></label>
          </fieldset>}
          {transportMode === null && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{toolPath ? "当前工具路径配置与传输方式不一致，请重新生成工具路径。" : "请先完成工具路径，再记录传输层验证。"}</p>}
        </div>}
        {kind === "PROBE" && signalLayer === "BINDING" && <fieldset><legend>绑定层变化验证</legend>
          <label>信号源<input aria-label="绑定信号源" value={probeFields.source} onChange={(event) => updateProbe("source", event.target.value)} /></label>
          <label>目标参数<input aria-label="绑定目标参数" value={probeFields.target} onChange={(event) => updateProbe("target", event.target.value)} /></label>
          <label>变化前<input aria-label="绑定变化前" type="number" value={probeFields.observedBefore} onChange={(event) => updateProbe("observedBefore", event.target.value)} /></label>
          <label>变化后<input aria-label="绑定变化后" type="number" value={probeFields.observedAfter} onChange={(event) => updateProbe("observedAfter", event.target.value)} /></label>
        </fieldset>}
        {kind === "PROBE" && signalLayer === "OUTPUT" && <fieldset><legend>输出层前后对照</legend>
          <label>输出参数<input aria-label="输出参数" value={probeFields.parameter} onChange={(event) => updateProbe("parameter", event.target.value)} /></label>
          <label>输出变化前<input aria-label="输出变化前" type="number" value={probeFields.before} onChange={(event) => updateProbe("before", event.target.value)} /></label>
          <label>输出变化后<input aria-label="输出变化后" type="number" value={probeFields.after} onChange={(event) => updateProbe("after", event.target.value)} /></label>
        </fieldset>}
        {pending && <progress aria-label="上传进度" max={100} value={progress}>{progress}%</progress>}
        <button type="submit" disabled={pending || transportBlocked}>{pending ? "正在上传" : "保存证据"}</button>
        {pending && <button type="button" onClick={() => controller.current?.abort()}>取消上传</button>}
      </form>
      {message && <p id={valueInvalid ? "evidence-value-error" : undefined} ref={messageRef} role={messageIsError ? "alert" : "status"} tabIndex={messageIsError ? -1 : undefined}>{message}</p>}
    </section>
  );
}

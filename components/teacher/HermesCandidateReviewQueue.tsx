/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */
"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageOff,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";
import {
  HermesCandidateQueueSchema,
  type HermesCandidateQueueItem,
  type HermesReviewState,
} from "./hermes-review-api";

const PAGE_SIZE = 20;
const FILTERS: Array<{ value: "ALL" | HermesReviewState; label: string }> = [
  { value: "ALL", label: "全部状态" },
  { value: "PENDING_REVIEW", label: "待治理" },
  { value: "NORMALIZATION_REQUIRED", label: "待规范化" },
  { value: "DUPLICATE_HOLD", label: "重复暂缓" },
  { value: "RIGHTS_HOLD", label: "权利暂缓" },
  { value: "REJECTED", label: "已拒绝" },
];
const STATE_LABEL: Record<HermesReviewState, string> = {
  PENDING_REVIEW: "待治理",
  NORMALIZATION_REQUIRED: "待规范化",
  DUPLICATE_HOLD: "重复暂缓",
  RIGHTS_HOLD: "权利暂缓",
  REJECTED: "已拒绝",
};

const CATEGORY_LABEL: Record<string, string> = {
  BRANDING: "品牌视觉识别",
  TYPOGRAPHY: "字体与排版",
  EDITORIAL: "书籍与编辑设计",
  PRINT: "印刷与海报",
  PACKAGING: "包装设计",
  WEB_INTERFACE: "数字界面",
  PRODUCT: "产品设计",
  MOTION: "动态视觉",
  ILLUSTRATION: "插画",
  THREE_D: "三维视觉",
  SPATIAL: "空间与环境图形",
  OTHER: "跨媒介设计",
};

const PLATFORM_LABEL: Record<string, string> = {
  PINTEREST: "Pinterest 发现入口",
  BEHANCE: "Behance 作者作品页",
  NOTEFOLIO: "Notefolio 作者作品页",
  RECENT_DESIGN: "Recent.design 策展索引",
  BPANDO: "BP&O 设计评论",
  HESIGN: "Hesign 设计档案",
  TYPOGRAPHIC_POSTERS: "字体海报策展档案",
  OTHER_PUBLIC_WEB: "其他公开来源",
};

function containsChinese(value: string | null) {
  return value !== null && /[\u3400-\u9fff]/u.test(value);
}

function candidateDisplayTitle(item: HermesCandidateQueueItem) {
  if (containsChinese(item.content.title)) return item.content.title;
  const categories = [...new Set(item.designCategories.map((category) => CATEGORY_LABEL[category] ?? "视觉设计"))];
  return `${categories.join("与") || "视觉设计"}候选`;
}

function platformLabel(platform: string) {
  const normalized = platform.toUpperCase().replace(/[^A-Z]/g, "");
  return PLATFORM_LABEL[platform]
    ?? Object.entries(PLATFORM_LABEL).find(([key]) => key.replace(/_/g, "") === normalized)?.[1]
    ?? "公开来源";
}

function ReadinessMetric({ label, value, total }: { label: string; value: number; total: number }) {
  return <div className="min-w-0 bg-[var(--color-paper-raised)] px-3 py-3">
    <span className="block text-xs font-bold text-[var(--color-ink-muted)]">{label}</span>
    <strong className="mt-1 block text-lg text-[var(--color-ink)]">{value}<span className="ml-1 text-xs font-normal text-[var(--color-ink-muted)]">/ {total}</span></strong>
  </div>;
}

function CandidateIndexRow({ item }: { item: HermesCandidateQueueItem }) {
  const blockers = [
    !item.media.controlledPreviewAvailable ? "无受控图片" : null,
    item.license === null ? "无权利证据" : null,
    item.content.description === null ? "描述缺失" : null,
    item.contractState === "V1_UPGRADE_REQUIRED" ? "旧版合同待规范化" : null,
  ].filter((value): value is string => value !== null);

  return <article className="border-t border-[var(--color-rule)] px-4 py-4 first:border-t-0 sm:px-5" data-testid={`hermes-candidate-${item.id}`}>
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <h3 className="min-w-0 flex-1 [overflow-wrap:anywhere] text-sm font-black text-[var(--color-ink)]">{candidateDisplayTitle(item)}</h3>
          <span className="inline-flex min-h-7 shrink-0 items-center rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-accent-soft)] px-2 text-xs font-bold text-[var(--color-ink)]">{STATE_LABEL[item.reviewState]}</span>
        </div>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{platformLabel(item.source.platform)} · 修订 {item.revision} · 采集筛选 {item.screening.totalScore}/30</p>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="治理缺口">
          {blockers.map((blocker) => <span className="rounded-md bg-[var(--color-amber-soft)] px-2 py-1 text-xs font-bold text-[var(--color-ink)]" key={blocker}>{blocker}</span>)}
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="font-bold text-[var(--color-ink)]">来源记录署名</dt><dd className="mt-0.5 text-[var(--color-ink-muted)]">{item.author?.displayName ? "署名已记录，原文见来源页" : "未知，保持空值"}</dd></div>
          <div><dt className="font-bold text-[var(--color-ink)]">授权信息</dt><dd className="mt-0.5 text-[var(--color-ink-muted)]">{item.license?.name ? "授权名称已记录，原文见来源页" : "未知，保持空值"}</dd></div>
        </dl>
      </div>

      <div className="min-w-0 lg:w-[22rem] lg:shrink-0">
        <div className="flex min-h-16 items-center gap-3 rounded-md border border-dashed border-[var(--color-rule-strong)] bg-[var(--color-paper-muted)] px-3 py-3 text-sm text-[var(--color-ink-muted)]">
          <ImageOff aria-hidden="true" className="size-5 shrink-0" />
          <span>{item.media.controlledPreviewAvailable ? "受控预览已记录，仍须完成其余治理门槛" : "仅记录到远程媒体；当前不构成可审核图像证据"}</span>
        </div>
        <a className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--color-ink)] px-3 text-sm font-bold text-[var(--color-ink)] outline-none transition-colors hover:bg-[var(--color-accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" href={item.source.pageUrl} rel="noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" className="size-4" />打开来源记录（非审核要求）
        </a>
      </div>
    </div>
  </article>;
}

export function HermesCandidateReviewQueue({ fetcher = fetch }: { fetcher?: TeacherWorkspaceFetcher }) {
  const [filter, setFilter] = useState<"ALL" | HermesReviewState>("ALL");
  const [offset, setOffset] = useState(0);
  const [payload, setPayload] = useState<ReturnType<typeof HermesCandidateQueueSchema.parse> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [resolvedRequest, setResolvedRequest] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const requestKey = `${filter}:${offset}:${reload}`;

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (filter !== "ALL") query.set("reviewState", filter);
    void fetcher(`/api/teacher/inspiration-wiki/candidates?${query}`, { cache: "no-store", signal: controller.signal })
      .then(jsonOrError)
      .then((body) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setPayload(HermesCandidateQueueSchema.parse(body));
        setError(null);
        setResolvedRequest(requestKey);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted && sequence === requestSequence.current) {
          setError(caught instanceof Error ? caught.message : "候选治理数据加载失败");
          setResolvedRequest(requestKey);
        }
      });
    return () => controller.abort();
  }, [fetcher, filter, offset, reload, requestKey]);

  const refresh = useCallback(() => setReload((value) => value + 1), []);
  const visiblePayload = resolvedRequest === requestKey ? payload : null;
  const visibleError = resolvedRequest === requestKey ? error : null;
  const total = visiblePayload?.meta.total ?? 0;
  const hasPrevious = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return <section aria-labelledby="hermes-governance-title" className="overflow-x-clip rounded-lg border border-[var(--color-rule)] bg-[var(--color-paper-raised)] shadow-sm">
    <header className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[var(--color-ink)]"><LockKeyhole aria-hidden="true" className="size-4" /><span className="text-xs font-black">私有候选 · D-18 S2</span></div>
          <h2 className="mt-1 text-xl font-black text-[var(--color-ink)]" id="hermes-governance-title">Hermes 候选治理准备区</h2>
          <p className="mt-1 text-sm leading-6 text-[var(--color-ink-muted)]">这里追踪 Codex 的权利、去重、规范化与图像证据准备进度，不是教师逐条审核任务。</p>
        </div>
        <button aria-label="刷新候选治理进度" className="grid size-10 shrink-0 place-items-center rounded-md border border-[var(--color-rule-strong)] text-[var(--color-ink)] outline-none transition-colors hover:bg-[var(--color-accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] active:translate-y-px" onClick={refresh} title="刷新" type="button"><RefreshCw aria-hidden="true" className="size-4" /></button>
      </div>

      {visiblePayload ? <>
        <div className="mt-4 flex gap-3 rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-amber-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-ink)]" role="status">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p><strong className="block">当前无需教师逐条操作</strong>{visiblePayload.meta.readiness.teacherReviewReady} / {visiblePayload.meta.total} 条具备完整图文、权利证据与新版规范化条件；未达到门槛前不会进入教师图文审核包。</p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--color-rule)] bg-[var(--color-rule)] text-sm sm:grid-cols-5">
          <ReadinessMetric label="教师可审" total={visiblePayload.meta.total} value={visiblePayload.meta.readiness.teacherReviewReady} />
          <ReadinessMetric label="受控预览" total={visiblePayload.meta.total} value={visiblePayload.meta.readiness.controlledPreviewReady} />
          <ReadinessMetric label="权利证据" total={visiblePayload.meta.total} value={visiblePayload.meta.readiness.rightsEvidenceReady} />
          <ReadinessMetric label="新版规范化" total={visiblePayload.meta.total} value={visiblePayload.meta.readiness.v2Normalized} />
          <ReadinessMetric label="描述齐备" total={visiblePayload.meta.total} value={visiblePayload.meta.readiness.descriptionsReady} />
        </div>

        <div className="mt-4 border-t border-[var(--color-rule)] pt-4">
          <h3 className="text-sm font-black text-[var(--color-ink)]">按来源准备度</h3>
          <div className="mt-2 grid gap-px overflow-hidden rounded-md border border-[var(--color-rule)] bg-[var(--color-rule)] sm:grid-cols-2">
            {visiblePayload.meta.sources.map((source) => <div className="min-w-0 bg-[var(--color-paper-raised)] px-3 py-3" key={source.sourceId}>
              <strong className="block min-w-0 [overflow-wrap:anywhere] text-sm text-[var(--color-ink)]">{platformLabel(source.sourceId.toUpperCase().replace(/[^A-Z]/g, ""))} · {source.total} 条</strong>
              <span className="mt-1 block text-xs leading-5 text-[var(--color-ink-muted)]">预览 {source.controlledPreviewReady} · 权利 {source.rightsEvidenceReady} · 描述 {source.descriptionsReady}</span>
            </div>)}
          </div>
        </div>
      </> : null}
    </header>

    {visibleError ? <div className="m-4 rounded-md border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]" role="alert">{visibleError}</div> : null}
    {!visiblePayload && !visibleError ? <p className="px-5 py-8 text-sm font-bold text-[var(--color-ink-muted)]" role="status">正在读取候选治理进度…</p> : null}

    {visiblePayload ? <details className="border-t border-[var(--color-rule)]">
      <summary className="cursor-pointer px-4 py-4 text-sm font-black text-[var(--color-ink)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)] sm:px-5">查看只读原始候选索引（{visiblePayload.meta.total} 条）</summary>
      <div className="border-t border-[var(--color-rule)]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <label className="text-sm font-bold text-[var(--color-ink)]">治理状态
            <select className="ml-2 min-h-10 rounded-md border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)] px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]" onChange={(event) => { setFilter(event.target.value as "ALL" | HermesReviewState); setOffset(0); }} value={filter}>
              {FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <span className="text-sm font-bold text-[var(--color-ink-muted)]">只读 · 当前筛选 {total} 条</span>
        </div>

        {visiblePayload.items.length === 0 ? <p className="border-t border-[var(--color-rule)] px-5 py-8 text-sm font-bold text-[var(--color-ink-muted)]">当前筛选没有候选。</p> : null}
        {visiblePayload.items.map((item) => <CandidateIndexRow item={item} key={item.id} />)}

        {hasPrevious || hasNext ? <footer className="flex items-center justify-between border-t border-[var(--color-rule)] px-4 py-3 sm:px-5">
          <button aria-label="上一页" className="grid size-10 place-items-center rounded-md border border-[var(--color-rule-strong)] text-[var(--color-ink)] outline-none hover:bg-[var(--color-accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40" disabled={!hasPrevious} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} title="上一页" type="button"><ChevronLeft aria-hidden="true" className="size-4" /></button>
          <span className="text-sm font-bold text-[var(--color-ink-muted)]">{Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
          <button aria-label="下一页" className="grid size-10 place-items-center rounded-md border border-[var(--color-rule-strong)] text-[var(--color-ink)] outline-none hover:bg-[var(--color-accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40" disabled={!hasNext} onClick={() => setOffset(offset + PAGE_SIZE)} title="下一页" type="button"><ChevronRight aria-hidden="true" className="size-4" /></button>
        </footer> : null}
      </div>
    </details> : null}
  </section>;
}

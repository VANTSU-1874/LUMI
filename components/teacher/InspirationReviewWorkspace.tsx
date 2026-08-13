/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V4 */
"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  ImageOff,
  Minus,
  Plus,
  RotateCcw,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  EvidenceGapReviewDecisionBodySchema,
  EvidenceGapReviewPackSchema,
  TeacherEvidenceGapReviewEditContextSchema,
  TeacherEvidenceGapReviewDecisionReceiptSchema,
  evidenceGapAcceptanceRequirementKeys,
  evidenceGapVerifiedCount,
  type EvidenceGapReadiness,
  type EvidenceGapReviewPack,
  type TeacherEvidenceGapReviewEditContext,
} from "@/lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import {
  ReviewPackDecisionBodySchema,
  StrictReviewPackSchema,
  TeacherReviewPackEditContextSchema,
  TeacherReviewPackDecisionReceiptSchema,
  type StrictReviewPack,
  type TeacherReviewPackEditContext,
} from "@/lib/domain/inspiration-wiki/review-pack-contracts";
import { localizeReviewPackForTeacher, localizedMediaRole } from "./inspiration-review-copy.zh-CN";
import { TeacherAppShell } from "./TeacherAppShell";
import { jsonOrError, type TeacherWorkspaceFetcher } from "./teacher-workspace-api";

type ReviewTab = "source" | "curation" | "rights" | "duplicate";
type ReviewMedia = StrictReviewPack["mediaGroup"][number];
type Assessment = {
  workSourceMatch: "MATCH" | "UNCERTAIN";
  classificationDescription: "ACCURATE" | "NEEDS_ADJUSTMENT";
  curationValue: "VALUABLE" | "EXCLUDE";
  teachingValue: "VALUABLE" | "EXCLUDE";
  rightsSafety: "SUFFICIENT_FOR_PRIVATE_WIKIDRAFT" | "NEEDS_MORE_EVIDENCE" | "BLOCKED";
  duplicateRelationship: "DISTINCT" | "VARIANT" | "DUPLICATE" | "UNCERTAIN";
};

const initialAssessment: Assessment = {
  workSourceMatch: "UNCERTAIN",
  classificationDescription: "NEEDS_ADJUSTMENT",
  curationValue: "EXCLUDE",
  teachingValue: "EXCLUDE",
  rightsSafety: "NEEDS_MORE_EVIDENCE",
  duplicateRelationship: "UNCERTAIN",
};

const approvedAssessment: Assessment = {
  workSourceMatch: "MATCH",
  classificationDescription: "ACCURATE",
  curationValue: "VALUABLE",
  teachingValue: "VALUABLE",
  rightsSafety: "SUFFICIENT_FOR_PRIVATE_WIKIDRAFT",
  duplicateRelationship: "DISTINCT",
};

const zoomLevels = [1, 1.25, 1.5, 2, 2.5, 3] as const;

const platformLabels: Record<StrictReviewPack["sources"][number]["platform"], string> = {
  PINTEREST: "Pinterest",
  BEHANCE: "Behance",
  NOTEFOLIO: "Notefolio",
  RECENT_DESIGN: "Recent.design",
  BPANDO: "BP&O",
  HESIGN: "Hesign",
  TYPOGRAPHIC_POSTERS: "Typographic Posters",
  ORIGINAL_PUBLISHER: "原始发布者",
  OTHER_PUBLIC_WEB: "其他公开网页",
};

const gapFields: Array<[keyof EvidenceGapReadiness, string]> = [
  ["controlledMediaGroup", "受控图 / 图组"],
  ["workSourceMatch", "作品与原始来源匹配"],
  ["sourceRole", "来源角色"],
  ["rightsEvidence", "权利证据"],
  ["normalizedClassification", "规范化分类"],
  ["visualDescription", "视觉描述"],
  ["duplicateRelationship", "重复关系"],
  ["curationRecommendation", "策展建议"],
  ["teachingRecommendation", "教学建议"],
];

const gapKeyByField = {
  controlledMediaGroup: "CONTROLLED_MEDIA_GROUP",
  workSourceMatch: "WORK_SOURCE_MATCH",
  sourceRole: "SOURCE_ROLE",
  rightsEvidence: "RIGHTS_EVIDENCE",
  normalizedClassification: "NORMALIZED_CLASSIFICATION",
  visualDescription: "VISUAL_DESCRIPTION",
  duplicateRelationship: "DUPLICATE_RELATIONSHIP",
  curationRecommendation: "CURATION_RECOMMENDATION",
  teachingRecommendation: "TEACHING_RECOMMENDATION",
} as const;

const gapStatusLabels = {
  VERIFIED: "已核验",
  UNKNOWN: "已确认：未知",
  PRESENT_UNVERIFIED: "已有材料，尚未核验",
  MISSING: "缺失",
  BLOCKED: "阻断",
} as const;

const sourceRoleLabels = {
  DISCOVERY_POINTER: "发现入口",
  CREATOR_WORK_PAGE: "创作者作品页",
  CURATORIAL_INDEX: "策展索引",
  ORIGINAL_PUBLISHER_RECORD: "原始发布记录",
  UNVERIFIED: "未知",
} as const;

const creatorRelationshipLabels = {
  DISCOVERY_ONLY: "仅发现关系",
  DIRECT_CREATOR_PAGE: "创作者直接发布",
  CURATED_CREATOR_RECORD: "策展收录记录",
  ORIGINAL_PUBLISHER_RECORD: "原始发布方记录",
} as const;

const recommendationLabels = { RECOMMEND: "建议纳入", DO_NOT_RECOMMEND: "不建议纳入" } as const;
const rightsDecisionLabels = { ALLOW: "允许", DENY: "不允许", UNKNOWN: "未知" } as const;
const rightsEvidenceTypeLabels = {
  SOURCE_TERMS: "来源条款",
  CREATOR_PERMISSION: "创作者许可",
  LICENSE: "许可协议",
  INSTITUTIONAL_POLICY: "机构政策",
  RIGHTS_HOLDER_STATEMENT: "权利人声明",
} as const;
const duplicateStatusLabels = { DISTINCT: "独立作品", VARIANT_OF: "相关变体", DUPLICATE_OF: "重复候选" } as const;
const safetyStatusLabels = { READY_FOR_TEACHER_DECISION: "可供教师判断" } as const;
const gapRecommendationLabels = { UNASSESSED: "尚未判断", RECOMMEND: "建议纳入", DO_NOT_RECOMMEND: "不建议纳入" } as const;
const gapDuplicateStatusLabels = { UNASSESSED: "尚未判断", DISTINCT: "独立作品", VARIANT_OF: "相关变体", DUPLICATE_OF: "重复候选" } as const;
const gapSafetyStatusLabels = { UNASSESSED: "尚未判断", READY_FOR_TEACHER_DECISION: "可供教师判断", BLOCKED: "需要人工处理" } as const;
const reviewedStageLabels = {
  RETURNED_TO_CODEX: "已退回 Codex 补证",
  REJECTED: "已拒绝",
  PRIVATE_WIKIDRAFT: "已进入私有草稿",
  PRIVATE_WIKIDRAFT_WITH_GAPS: "私有草稿（保留缺口）",
} as const;

function parseStrictReviewDetail(raw: unknown) {
  const { editContext: rawContext, ...rawPack } = raw as Record<string, unknown>;
  return {
    pack: localizeReviewPackForTeacher(StrictReviewPackSchema.parse(rawPack)),
    editContext: TeacherReviewPackEditContextSchema.parse(rawContext),
  };
}

function parseEvidenceGapReviewDetail(raw: unknown) {
  const { editContext: rawContext, ...rawPack } = raw as Record<string, unknown>;
  return {
    pack: EvidenceGapReviewPackSchema.parse(rawPack),
    editContext: TeacherEvidenceGapReviewEditContextSchema.parse(rawContext),
  };
}

function assessmentAccepted(assessment: Assessment) {
  return assessment.workSourceMatch === "MATCH"
    && assessment.classificationDescription === "ACCURATE"
    && assessment.curationValue === "VALUABLE"
    && assessment.teachingValue === "VALUABLE"
    && assessment.rightsSafety === "SUFFICIENT_FOR_PRIVATE_WIKIDRAFT"
    && (assessment.duplicateRelationship === "DISTINCT" || assessment.duplicateRelationship === "VARIANT");
}

function SourcePanel({ pack }: { pack: StrictReviewPack }) {
  return <div><dl className="reviewDefinition"><div><dt>作品—来源匹配</dt><dd>已匹配 · {pack.work.workSourceMatch.evidence.join("；")}</dd></div><div><dt>规范化分类</dt><dd>{pack.normalizedClassification.primary} / {pack.normalizedClassification.secondary.join("、") || "无二级分类"}</dd></div><div><dt>视觉描述</dt><dd>{pack.visualDescription.summary}</dd></div></dl><div className="reviewSourceChain">{pack.sources.map((source) => <article className="reviewSource" key={source.sourceId}><strong>{platformLabels[source.platform]} · {source.label}</strong><span>{sourceRoleLabels[source.role]} / {creatorRelationshipLabels[source.creatorRelationship]}</span><span>创作者：{source.creatorName ?? "未由该入口提供"} · 策展者：{source.curatorName ?? "不适用"}</span><span>{source.evidenceStatement}</span></article>)}</div></div>;
}

function CurationPanel({ pack }: { pack: StrictReviewPack }) {
  return <dl className="reviewDefinition"><div><dt>策展建议 · {recommendationLabels[pack.curationRecommendation.recommendation]}</dt><dd>{pack.curationRecommendation.rationale}</dd></div><div><dt>教学建议 · {recommendationLabels[pack.teachingRecommendation.recommendation]}</dt><dd>{pack.teachingRecommendation.rationale}</dd></div><div><dt>课堂提问</dt><dd>{pack.teachingRecommendation.prompts.map((prompt, index) => <p key={prompt}>{index + 1}. {prompt}</p>)}</dd></div><div><dt>教学提醒</dt><dd>{pack.teachingRecommendation.cautions.join("；") || "无额外提醒"}</dd></div></dl>;
}

function RightsPanel({ pack }: { pack: StrictReviewPack }) {
  return <dl className="reviewDefinition"><div><dt>安全准备状态</dt><dd>{safetyStatusLabels[pack.safetyAssessment.status]} · {pack.safetyAssessment.evidence.join("；")}</dd></div>{pack.rightsEvidence.map((evidence) => <div key={evidence.evidenceId}><dt>{rightsEvidenceTypeLabels[evidence.evidenceType]}</dt><dd>{evidence.summary}</dd><dd>教师私有审核：{rightsDecisionLabels[evidence.privateTeacherReviewDecision]} · 再发布许可：{rightsDecisionLabels[evidence.republicationDecision]}</dd><dd><strong>作者作品页不等于再发布许可：是</strong></dd></div>)}</dl>;
}

function DuplicatePanel({ pack }: { pack: StrictReviewPack }) {
  return <dl className="reviewDefinition"><div><dt>系统关系判断</dt><dd>{duplicateStatusLabels[pack.duplicateRelationship.status]}</dd></div><div><dt>判断依据</dt><dd>{pack.duplicateRelationship.explanation}</dd></div><div><dt>关联候选</dt><dd>{pack.duplicateRelationship.relatedCandidateIds.join("、") || "无"}</dd></div></dl>;
}

function gapStateCopy(requirement: EvidenceGapReadiness[keyof EvidenceGapReadiness]) {
  return `${gapStatusLabels[requirement.status]}${requirement.note ? ` · ${requirement.note}` : ""}`;
}

function EvidenceGapSourcePanel({ pack }: { pack: EvidenceGapReviewPack }) {
  const classification = [pack.normalizedClassification.primary, ...pack.normalizedClassification.secondary].filter(Boolean).join(" / ");
  return <div><dl className="reviewDefinition"><div><dt>作品—原始来源匹配</dt><dd>{gapStateCopy(pack.readiness.workSourceMatch)}</dd></div><div><dt>来源角色</dt><dd>{gapStateCopy(pack.readiness.sourceRole)}</dd></div><div><dt>规范化分类</dt><dd>{classification || "尚未形成规范化分类"}</dd></div><div><dt>艺术表现风格</dt><dd>{pack.visualDescription.artisticStyle ? <><strong>{pack.visualDescription.artisticStyle.labels.join(" · ")}</strong><p>{pack.visualDescription.artisticStyle.rationale}</p></> : "尚未定义"}</dd></div><div><dt>视觉描述</dt><dd>{pack.visualDescription.summary ?? "尚未形成视觉描述"}</dd></div>{pack.visualDescription.observations.length ? <div><dt>画面观察</dt><dd>{pack.visualDescription.observations.map((item, index) => <p key={`${index}-${item.observation}`}>{index + 1}. {item.observation}</p>)}</dd></div> : null}</dl><div className="reviewSourceChain">{pack.sources.map((source) => <article className="reviewSource" key={source.sourceId}><strong>{platformLabels[source.platform]} · 公开来源记录</strong><span>来源角色：{gapStatusLabels[pack.readiness.sourceRole.status]}</span><span>创作者：{source.creatorName ?? "未知"} · 策展者：{source.curatorName ?? "未知"}</span></article>)}</div></div>;
}

function EvidenceGapCurationPanel({ pack }: { pack: EvidenceGapReviewPack }) {
  return <dl className="reviewDefinition"><div><dt>策展建议 · {gapRecommendationLabels[pack.curationRecommendation.recommendation]}</dt><dd>{pack.curationRecommendation.rationale ?? "尚未形成策展建议"}</dd></div><div><dt>教学建议 · {gapRecommendationLabels[pack.teachingRecommendation.recommendation]}</dt><dd>{pack.teachingRecommendation.rationale ?? "尚未形成教学建议"}</dd></div><div><dt>课堂提问</dt><dd>{pack.teachingRecommendation.prompts.length ? pack.teachingRecommendation.prompts.map((prompt, index) => <p key={prompt}>{index + 1}. {prompt}</p>) : "尚未形成课堂提问"}</dd></div><div><dt>教学提醒</dt><dd>{pack.teachingRecommendation.cautions.join("；") || "无额外提醒"}</dd></div></dl>;
}

function EvidenceGapRightsPanel({ pack }: { pack: EvidenceGapReviewPack }) {
  return <dl className="reviewDefinition"><div><dt>权利证据</dt><dd>{gapStateCopy(pack.readiness.rightsEvidence)}</dd></div><div><dt>安全准备状态</dt><dd>{gapSafetyStatusLabels[pack.safetyAssessment.status]}{pack.safetyAssessment.evidence.length ? ` · ${pack.safetyAssessment.evidence.join("；")}` : ""}</dd></div><div><dt>使用边界</dt><dd>仅供教师私有审核；不据公开可访问性推定复制、再发布或学生展示许可。</dd></div></dl>;
}

function EvidenceGapDuplicatePanel({ pack }: { pack: EvidenceGapReviewPack }) {
  return <dl className="reviewDefinition"><div><dt>系统关系判断</dt><dd>{gapDuplicateStatusLabels[pack.duplicateRelationship.status]}</dd></div><div><dt>判断依据</dt><dd>{pack.duplicateRelationship.explanation ?? "尚未形成重复关系说明"}</dd></div><div><dt>关联候选</dt><dd>{pack.duplicateRelationship.relatedCandidateIds.join("、") || "无"}</dd></div></dl>;
}

function ReviewMediaLightbox({
  media,
  mediaGroup,
  onClose,
  onSelect,
}: {
  media: ReviewMedia;
  mediaGroup: ReviewMedia[];
  onClose: () => void;
  onSelect: (mediaId: string) => void;
}) {
  const [zoomIndex, setZoomIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const currentIndex = Math.max(0, mediaGroup.findIndex((item) => item.mediaId === media.mediaId));
  const zoom = zoomLevels[zoomIndex];

  const selectRelative = useCallback((offset: number) => {
    const nextIndex = (currentIndex + offset + mediaGroup.length) % mediaGroup.length;
    setZoomIndex(0);
    onSelect(mediaGroup[nextIndex].mediaId);
  }, [currentIndex, mediaGroup, onSelect]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && mediaGroup.length > 1) {
        event.preventDefault();
        selectRelative(-1);
        return;
      }
      if (event.key === "ArrowRight" && mediaGroup.length > 1) {
        event.preventDefault();
        selectRelative(1);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoomIndex((value) => Math.min(zoomLevels.length - 1, value + 1));
        return;
      }
      if (event.key === "-") {
        event.preventDefault();
        setZoomIndex((value) => Math.max(0, value - 1));
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        setZoomIndex(0);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [mediaGroup.length, onClose, selectRelative]);

  return <div aria-labelledby="review-lightbox-title" aria-modal="true" className="reviewLightbox" ref={dialogRef} role="dialog">
    <header className="reviewLightboxHeader">
      <div className="reviewLightboxTitle">
        <span>{media.role} · {currentIndex + 1} / {mediaGroup.length}</span>
        <h3 id="review-lightbox-title">{media.alt}</h3>
      </div>
      <div aria-label="图片缩放工具" className="reviewLightboxTools" role="toolbar">
        {mediaGroup.length > 1 ? <button aria-label="上一张图片" onClick={() => selectRelative(-1)} title="上一张" type="button"><ChevronLeft aria-hidden="true" size={20} /></button> : null}
        <button aria-label="缩小图片" disabled={zoomIndex === 0} onClick={() => setZoomIndex((value) => Math.max(0, value - 1))} title="缩小" type="button"><Minus aria-hidden="true" size={18} /></button>
        <output aria-live="polite" className="reviewLightboxZoom">{Math.round(zoom * 100)}%</output>
        <button aria-label="放大图片" disabled={zoomIndex === zoomLevels.length - 1} onClick={() => setZoomIndex((value) => Math.min(zoomLevels.length - 1, value + 1))} title="放大" type="button"><Plus aria-hidden="true" size={18} /></button>
        <button aria-label="适应屏幕" disabled={zoomIndex === 0} onClick={() => setZoomIndex(0)} title="适应屏幕" type="button"><Maximize2 aria-hidden="true" size={18} /></button>
        {mediaGroup.length > 1 ? <button aria-label="下一张图片" onClick={() => selectRelative(1)} title="下一张" type="button"><ChevronRight aria-hidden="true" size={20} /></button> : null}
        <button aria-label="关闭放大预览" onClick={onClose} ref={closeButtonRef} title="关闭" type="button"><X aria-hidden="true" size={20} /></button>
      </div>
    </header>
    <div className="reviewLightboxStage">
      <div className="reviewLightboxViewport">
        <div className="reviewLightboxCanvas" style={{ height: `${zoom * 100}%`, width: `${zoom * 100}%` }}>
          <Image alt={`${media.alt}（放大预览）`} className="reviewLightboxImage" height={media.height} priority src={media.previewUrl} unoptimized width={media.width} />
        </div>
      </div>
    </div>
    <p className="reviewLightboxCaption">SHA-256 {media.sha256.slice(0, 12)}… · {media.width} × {media.height}</p>
  </div>;
}

export function InspirationReviewWorkspace({
  reviewPackId,
  fetcher = fetch,
  initialPack,
  initialEditContext,
  navigate = (href) => window.location.assign(href),
}: {
  reviewPackId: string;
  fetcher?: TeacherWorkspaceFetcher;
  initialPack?: StrictReviewPack;
  initialEditContext?: TeacherReviewPackEditContext;
  navigate?: (href: string) => void;
}) {
  const [pack, setPack] = useState<StrictReviewPack | null>(() => initialPack ? localizeReviewPackForTeacher(StrictReviewPackSchema.parse(initialPack)) : null);
  const [editContext, setEditContext] = useState<TeacherReviewPackEditContext | null>(() => initialEditContext ? TeacherReviewPackEditContextSchema.parse(initialEditContext) : null);
  const [loading, setLoading] = useState(!initialPack);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ReviewTab>("source");
  const [selectedMediaId, setSelectedMediaId] = useState(initialPack?.mediaGroup[0]?.mediaId ?? "");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [assessment, setAssessment] = useState<Assessment>(() => initialEditContext?.latestDecision?.assessment ?? initialAssessment);
  const [note, setNote] = useState(() => initialEditContext?.latestDecision?.note ?? "");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialPack) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { pack: payload, editContext: context } = parseStrictReviewDetail(await jsonOrError(await fetcher(`/api/teacher/inspiration-wiki/review-packs/${encodeURIComponent(reviewPackId)}`, { signal: controller.signal, cache: "no-store" })));
        if (!controller.signal.aborted) {
          setPack(payload);
          setEditContext(context);
          if (context.latestDecision) {
            setAssessment(context.latestDecision.assessment);
            setNote(context.latestDecision.note);
          }
          setSelectedMediaId(payload.mediaGroup[0]?.mediaId ?? "");
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "审核包加载失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fetcher, initialPack, reviewPackId]);

  const selectedMedia = useMemo(() => pack?.mediaGroup.find((media) => media.mediaId === selectedMediaId) ?? pack?.mediaGroup[0], [pack, selectedMediaId]);
  const canEnterDraft = assessmentAccepted(assessment);
  const currentReviewRevision = editContext?.currentReviewRevision ?? pack?.revision ?? 1;
  const editingPreviousDecision = editContext?.latestDecision !== null && editContext?.latestDecision !== undefined;

  function updateAssessment<Key extends keyof Assessment>(key: Key, value: Assessment[Key]) {
    setAssessment((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  async function decide(finalAction: "RETURN_TO_CODEX" | "REJECT_CANDIDATE" | "ENTER_PRIVATE_WIKIDRAFT") {
    if (!pack || pending) return;
    if (finalAction !== "ENTER_PRIVATE_WIKIDRAFT" && !note.trim()) {
      setNoteError(finalAction === "REJECT_CANDIDATE" ? "请先填写拒绝理由，再提交拒绝。" : "请先填写需要补证的事实或缺口，再退回 Codex。");
      noteRef.current?.focus();
      return;
    }
    setNoteError(null);
    setError(null);
    setNotice(null);
    try {
      const body = ReviewPackDecisionBodySchema.parse({
        reviewPackRevision: currentReviewRevision,
        assessment,
        finalAction,
        note: note.trim(),
        idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `review-${Date.now()}`,
      });
      setPending(true);
      const receipt = TeacherReviewPackDecisionReceiptSchema.parse(await jsonOrError(await fetcher(`/api/teacher/inspiration-wiki/review-packs/${encodeURIComponent(pack.reviewPackId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      })));
      setNotice(finalAction === "RETURN_TO_CODEX" ? "已退回 Codex 补证" : finalAction === "REJECT_CANDIDATE" ? "已拒绝候选" : "已进入私有草稿");
      navigate(receipt.nextReviewPackId
        ? `/teacher/inspiration-wiki/review/${encodeURIComponent(receipt.nextReviewPackId)}`
        : "/teacher/inspiration-wiki");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审核决定保存失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <TeacherAppShell active="wiki" backHref="/teacher/inspiration-wiki" backLabel="返回灵感 Wiki" description="检查受控图组与证据链，再完成六项教师判断。" eyebrow="严格审核包 · 教师判断" title="单作品审核工作区">
      {loading ? <p className="teacherLoading">正在读取严格审核包…</p> : null}
      {error ? <div className="teacherNotice teacherError" role="alert">{error}</div> : null}
      {notice ? <div className="teacherNotice" role="status">{notice}</div> : null}
      {editingPreviousDecision && editContext ? <section className="reviewRevisionBanner" role="status"><RotateCcw aria-hidden="true" size={18} /><div><strong>正在再次编辑已审核结论</strong><p>上次结果：{reviewedStageLabels[editContext.currentStage as keyof typeof reviewedStageLabels]}。提交后将追加审核修订 {currentReviewRevision + 1}，原结论继续保留在审计历史中。</p></div></section> : null}
      {!loading && !pack ? <section className="teacherPanel reviewErrorState"><div><ShieldAlert aria-hidden="true" size={30} /><h2>没有可审核的严格审核包</h2><p>真实数据库当前没有严格审核包。原始 Hermes 元数据只属于治理材料，不能在此伪装为审核任务。</p></div></section> : null}
      {pack && selectedMedia ? <section className="reviewWorkbench" data-state={canEnterDraft ? "draft-eligible" : "judgement-required"} data-ui="review-workbench">
        <div className="reviewMedia" aria-label="可检查受控图组">
          <div className="reviewMediaStage"><button aria-label={`放大查看：${selectedMedia.alt}`} className="reviewMediaOpen" onClick={() => setLightboxOpen(true)} type="button"><Image alt={selectedMedia.alt} height={selectedMedia.height} loading="eager" priority src={selectedMedia.previewUrl} unoptimized width={selectedMedia.width} /><span aria-hidden="true" className="reviewMediaOpenIcon"><Maximize2 size={18} /></span></button><p className="reviewMediaCaption">{localizedMediaRole(selectedMedia.role)} · {selectedMedia.alt} · 文件校验值 {selectedMedia.sha256.slice(0, 12)}…</p></div>
          <div className="reviewThumbnails" aria-label="图组缩略图">{pack.mediaGroup.map((media) => <button aria-label={`查看图像：${media.alt}`} aria-pressed={media.mediaId === selectedMedia.mediaId} className="reviewThumbnail" key={media.mediaId} onClick={() => setSelectedMediaId(media.mediaId)} type="button"><Image alt="" height={media.height} loading="eager" src={media.previewUrl} unoptimized width={media.width} /></button>)}</div>
        </div>
        <div className="reviewJudgement">
          <header className="reviewTitle"><h2>{pack.work.title}</h2><p>{pack.work.creators.join("、")} · {pack.work.year ?? "年份待核"} · 审核修订 {currentReviewRevision}</p></header>
          <div className="reviewTabs" role="tablist" aria-label="审核包证据分组">
            {([ ["source", "作品与来源"], ["curation", "策展与教学"], ["rights", "权利与安全"], ["duplicate", "重复关系"] ] as const).map(([value, label]) => <button aria-controls={`review-panel-${value}`} aria-selected={tab === value} className="reviewTab" id={`review-tab-${value}`} key={value} onClick={() => setTab(value)} role="tab" type="button">{label}</button>)}
          </div>
          <div aria-labelledby={`review-tab-${tab}`} className="reviewTabPanel" id={`review-panel-${tab}`} role="tabpanel">
            {tab === "source" ? <SourcePanel pack={pack} /> : null}
            {tab === "curation" ? <CurationPanel pack={pack} /> : null}
            {tab === "rights" ? <RightsPanel pack={pack} /> : null}
            {tab === "duplicate" ? <DuplicatePanel pack={pack} /> : null}
          </div>
          <div className="reviewAssessment" aria-label="教师六项判断">
            <div className="reviewAssessmentHeader">
              <h3>教师六项判断</h3>
              <button className="teacherButton reviewApproveAll" disabled={canEnterDraft} onClick={() => { setAssessment(approvedAssessment); setNotice(null); }} type="button"><CheckCircle2 aria-hidden="true" size={16} />{canEnterDraft ? "六项已认证" : "一键认证六项"}</button>
            </div>
            <div className="reviewAssessmentField"><label htmlFor="assessment-work-match">作品与原始来源匹配</label><select className="teacherSelect" id="assessment-work-match" onChange={(event) => updateAssessment("workSourceMatch", event.target.value as Assessment["workSourceMatch"])} value={assessment.workSourceMatch}><option value="UNCERTAIN">仍不确定</option><option value="MATCH">匹配</option></select></div>
            <div className="reviewAssessmentField"><label htmlFor="assessment-classification">分类与描述</label><select className="teacherSelect" id="assessment-classification" onChange={(event) => updateAssessment("classificationDescription", event.target.value as Assessment["classificationDescription"])} value={assessment.classificationDescription}><option value="NEEDS_ADJUSTMENT">需要调整</option><option value="ACCURATE">准确</option></select></div>
            <div className="reviewAssessmentField"><label htmlFor="assessment-curation">策展价值</label><select className="teacherSelect" id="assessment-curation" onChange={(event) => updateAssessment("curationValue", event.target.value as Assessment["curationValue"])} value={assessment.curationValue}><option value="EXCLUDE">不纳入</option><option value="VALUABLE">有价值</option></select></div>
            <div className="reviewAssessmentField"><label htmlFor="assessment-teaching">教学价值</label><select className="teacherSelect" id="assessment-teaching" onChange={(event) => updateAssessment("teachingValue", event.target.value as Assessment["teachingValue"])} value={assessment.teachingValue}><option value="EXCLUDE">不纳入</option><option value="VALUABLE">有价值</option></select></div>
            <div className="reviewAssessmentField"><label htmlFor="assessment-rights">权利与安全结论</label><select className="teacherSelect" id="assessment-rights" onChange={(event) => updateAssessment("rightsSafety", event.target.value as Assessment["rightsSafety"])} value={assessment.rightsSafety}><option value="NEEDS_MORE_EVIDENCE">需要补证</option><option value="BLOCKED">阻断</option><option value="SUFFICIENT_FOR_PRIVATE_WIKIDRAFT">足够进入私有草稿</option></select></div>
            <div className="reviewAssessmentField"><label htmlFor="assessment-duplicate">重复关系</label><select className="teacherSelect" id="assessment-duplicate" onChange={(event) => updateAssessment("duplicateRelationship", event.target.value as Assessment["duplicateRelationship"])} value={assessment.duplicateRelationship}><option value="UNCERTAIN">仍不确定</option><option value="DISTINCT">独立作品</option><option value="VARIANT">相关变体</option><option value="DUPLICATE">重复候选</option></select></div>
            <div className="reviewNote"><label htmlFor="review-note">教师说明（退回或拒绝时必填）</label><textarea aria-describedby="review-note-hint" aria-invalid={noteError ? "true" : undefined} className="teacherTextarea" id="review-note" maxLength={300} onChange={(event) => { setNote(event.target.value); setNoteError(null); setNotice(null); }} ref={noteRef} value={note} /><p className="reviewFieldHint" data-state={noteError ? "error" : "default"} id="review-note-hint" role={noteError ? "alert" : undefined}>{noteError ?? "退回或拒绝需要填写 1–300 字理由；进入私有草稿可不填。"}</p></div>
          </div>
          <div className="reviewActions">
            <button className="teacherButton" disabled={pending} onClick={() => void decide("RETURN_TO_CODEX")} type="button"><RotateCcw size={16} />退回 Codex 补证</button>
            <button className="teacherButton teacherButtonDanger" disabled={pending} onClick={() => void decide("REJECT_CANDIDATE")} type="button"><XCircle size={16} />拒绝候选</button>
            <button className="teacherButton teacherButtonPrimary" disabled={pending || !canEnterDraft} onClick={() => void decide("ENTER_PRIVATE_WIKIDRAFT")} type="button"><CheckCircle2 size={16} />进入私有草稿</button>
          </div>
          <p className="reviewBoundaryNote"><strong>边界持续生效：</strong> 不正式发布、不对学生可见、不创建正式页面、不写入对象存储、不生成向量索引、不进入 Lumi 引用。</p>
        </div>
        {lightboxOpen ? <ReviewMediaLightbox media={selectedMedia} mediaGroup={pack.mediaGroup} onClose={() => setLightboxOpen(false)} onSelect={setSelectedMediaId} /> : null}
      </section> : null}
    </TeacherAppShell>
  );
}

export function EvidenceGapReviewWorkspace({
  reviewPackId,
  fetcher = fetch,
  initialPack,
  initialEditContext,
  navigate = (href) => window.location.assign(href),
}: {
  reviewPackId: string;
  fetcher?: TeacherWorkspaceFetcher;
  initialPack?: EvidenceGapReviewPack;
  initialEditContext?: TeacherEvidenceGapReviewEditContext;
  navigate?: (href: string) => void;
}) {
  const [pack, setPack] = useState<EvidenceGapReviewPack | null>(() => initialPack ? EvidenceGapReviewPackSchema.parse(initialPack) : null);
  const [editContext, setEditContext] = useState<TeacherEvidenceGapReviewEditContext | null>(() => initialEditContext ? TeacherEvidenceGapReviewEditContextSchema.parse(initialEditContext) : null);
  const [loading, setLoading] = useState(!initialPack);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ReviewTab>("source");
  const [selectedMediaId, setSelectedMediaId] = useState(initialPack?.mediaGroup[0]?.mediaId ?? "");
  const [acceptedGapKeys, setAcceptedGapKeys] = useState<string[]>(() => initialEditContext?.latestDecision?.acceptedGapKeys ?? []);
  const [note, setNote] = useState(() => initialEditContext?.latestDecision?.note ?? "");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (initialPack) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const { pack: payload, editContext: context } = parseEvidenceGapReviewDetail(await jsonOrError(await fetcher(`/api/teacher/inspiration-wiki/review-packs/evidence-gaps/${encodeURIComponent(reviewPackId)}`, { signal: controller.signal, cache: "no-store" })));
        if (!controller.signal.aborted) {
          setPack(payload);
          setEditContext(context);
          if (context.latestDecision) {
            setAcceptedGapKeys(context.latestDecision.acceptedGapKeys);
            setNote(context.latestDecision.note);
          }
          setSelectedMediaId(payload.mediaGroup[0]?.mediaId ?? "");
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "缺证审核包加载失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [fetcher, initialPack, reviewPackId]);

  const gapKeys = pack ? evidenceGapAcceptanceRequirementKeys(pack.readiness) : [];
  const verifiedCount = pack ? evidenceGapVerifiedCount(pack.readiness) : 0;
  const confirmedUnknownCount = pack ? Object.values(pack.readiness).filter((requirement) => requirement.status === "UNKNOWN").length : 0;
  const handledCount = verifiedCount + confirmedUnknownCount;
  const selectedMedia = pack?.mediaGroup.find((media) => media.mediaId === selectedMediaId) ?? pack?.mediaGroup[0];
  const allGapsAccepted = gapKeys.every((key) => acceptedGapKeys.includes(key));
  const currentReviewRevision = editContext?.currentReviewRevision ?? pack?.revision ?? 1;
  const editingPreviousDecision = editContext?.latestDecision !== null && editContext?.latestDecision !== undefined;

  function toggleGap(key: string, checked: boolean) {
    setAcceptedGapKeys((current) => checked ? [...new Set([...current, key])] : current.filter((item) => item !== key));
    setNotice(null);
  }

  async function decide(finalAction: "RETURN_TO_CODEX" | "REJECT_CANDIDATE" | "ENTER_PRIVATE_WIKIDRAFT") {
    if (!pack || pending) return;
    if (finalAction !== "ENTER_PRIVATE_WIKIDRAFT" && !note.trim()) {
      setNoteError(finalAction === "REJECT_CANDIDATE" ? "请先填写拒绝理由，再提交拒绝。" : finalAction === "RETURN_TO_CODEX" ? "请先填写需要补证的事实或缺口，再退回 Codex。" : "请先说明为何接受当前证据缺口，再进入私有草稿。");
      noteRef.current?.focus();
      return;
    }
    setNoteError(null);
    setError(null);
    setNotice(null);
    try {
      const body = EvidenceGapReviewDecisionBodySchema.parse({
        reviewPackRevision: currentReviewRevision,
        finalAction,
        acceptedGapKeys: finalAction === "ENTER_PRIVATE_WIKIDRAFT" ? acceptedGapKeys : [],
        note: note.trim(),
        privateDraftOnly: finalAction === "ENTER_PRIVATE_WIKIDRAFT",
        idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `gap-review-${Date.now()}`,
      });
      setPending(true);
      const receipt = TeacherEvidenceGapReviewDecisionReceiptSchema.parse(await jsonOrError(await fetcher(`/api/teacher/inspiration-wiki/review-packs/evidence-gaps/${encodeURIComponent(pack.reviewPackId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      })));
      setNotice(finalAction === "RETURN_TO_CODEX" ? "已退回 Codex 补证" : finalAction === "REJECT_CANDIDATE" ? "已拒绝候选" : "已进入私有草稿（保留缺口）");
      navigate(receipt.nextReviewPackId ? `/teacher/inspiration-wiki/review/gap/${encodeURIComponent(receipt.nextReviewPackId)}` : "/teacher/inspiration-wiki");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "缺证审核决定保存失败");
    } finally { setPending(false); }
  }

  return <TeacherAppShell active="wiki" backHref="/teacher/inspiration-wiki" backLabel="返回灵感 Wiki" description="六项分析与三项已确认未知保持可见；教师可直接作出私有判断。" eyebrow="缺证候选 · 教师判断" title="缺证候选审核">
    {loading ? <p className="teacherLoading">正在读取缺证审核包…</p> : null}
    {error ? <div className="teacherNotice teacherError" role="alert">{error}</div> : null}
    {notice ? <div className="teacherNotice" role="status">{notice}</div> : null}
    {editingPreviousDecision && editContext ? <section className="reviewRevisionBanner" role="status"><RotateCcw aria-hidden="true" size={18} /><div><strong>正在再次编辑已审核结论</strong><p>上次结果：{reviewedStageLabels[editContext.currentStage as keyof typeof reviewedStageLabels]}。提交后将追加审核修订 {currentReviewRevision + 1}，原结论继续保留在审计历史中。</p></div></section> : null}
    {!loading && !pack ? <section className="teacherPanel reviewErrorState"><div><ShieldAlert aria-hidden="true" size={30} /><h2>没有可审核的缺证候选</h2><p>该对象可能已经被处理或升级为严格审核包。</p></div></section> : null}
    {pack ? <>
      <section className="reviewGapBanner" role="status"><ShieldAlert aria-hidden="true" /><div><strong>人工缺证审核 · 已处理 {handledCount}/9</strong><p>{verifiedCount} 项已完成分析，{confirmedUnknownCount} 项已确认为“未知”。进入私有草稿无需勾选未知项，也无需填写说明。</p></div></section>
      <section className="reviewGapGateGrid" aria-label="九道准备门状态">{gapFields.map(([field, label]) => { const requirement = pack.readiness[field]; return <article data-status={requirement.status} key={field}><span>{gapStatusLabels[requirement.status]}</span><strong>{label}</strong><p>{requirement.note ?? "当前没有补充说明"}</p></article>; })}</section>
      <section className="reviewWorkbench reviewGapWorkbench" data-state={allGapsAccepted ? "gaps-accepted" : "gaps-open"} data-ui="evidence-gap-review-workbench">
        <div className="reviewMedia" aria-label="缺证候选媒体">
          {selectedMedia ? <><div className="reviewMediaStage"><Image alt={selectedMedia.alt ?? "候选图片"} height={selectedMedia.height} priority src={selectedMedia.previewUrl} unoptimized width={selectedMedia.width} /><p className="reviewMediaCaption">{selectedMedia.reviewStatus === "VERIFIED_FOR_PRIVATE_REVIEW" ? "已完成私有审核准备" : "尚未核验"} · {selectedMedia.role === "COVER" ? "封面" : selectedMedia.role ?? "角色待核"} · SHA-256 {selectedMedia.sha256.slice(0, 12)}…</p></div><div className="reviewThumbnails">{pack.mediaGroup.map((media) => <button aria-label={`查看候选图片：${media.alt ?? media.mediaId}`} aria-pressed={media.mediaId === selectedMedia.mediaId} className="reviewThumbnail" key={media.mediaId} onClick={() => setSelectedMediaId(media.mediaId)} type="button"><Image alt="" height={media.height} src={media.previewUrl} unoptimized width={media.width} /></button>)}</div></> : <div className="reviewGapNoMedia"><ImageOff aria-hidden="true" size={32} /><h2>当前没有受控图片</h2><p>教师仍可检查来源记录和九门缺口；系统不会加载远程图片或显示破图占位。</p></div>}
        </div>
        <div className="reviewJudgement">
          <header className="reviewTitle"><h2>{pack.work.title ?? "未命名候选"}</h2><p>{pack.work.creators.join("、") || "创作者未知"} · {pack.work.year ?? "年份未知"} · 审核修订 {currentReviewRevision}</p></header>
          <div className="reviewTabs" role="tablist" aria-label="缺证候选证据分组">
            {([ ["source", "作品与来源"], ["curation", "策展与教学"], ["rights", "权利与安全"], ["duplicate", "重复关系"] ] as const).map(([value, label]) => <button aria-controls={`gap-review-panel-${value}`} aria-selected={tab === value} className="reviewTab" id={`gap-review-tab-${value}`} key={value} onClick={() => setTab(value)} role="tab" type="button">{label}</button>)}
          </div>
          <section aria-labelledby={`gap-review-tab-${tab}`} className="reviewTabPanel" id={`gap-review-panel-${tab}`} role="tabpanel">
            {tab === "source" ? <EvidenceGapSourcePanel pack={pack} /> : null}
            {tab === "curation" ? <EvidenceGapCurationPanel pack={pack} /> : null}
            {tab === "rights" ? <EvidenceGapRightsPanel pack={pack} /> : null}
            {tab === "duplicate" ? <EvidenceGapDuplicatePanel pack={pack} /> : null}
          </section>
          {gapKeys.length ? <fieldset className="reviewGapConfirmations"><legend>逐门确认未解决缺口</legend><p>只需勾选尚未解决的缺口；“已确认：未知”不需重复确认。</p>{gapFields.filter(([field]) => !["VERIFIED", "UNKNOWN"].includes(pack.readiness[field].status)).map(([field, label]) => { const key = gapKeyByField[field]; return <label key={field}><input checked={acceptedGapKeys.includes(key)} onChange={(event) => toggleGap(key, event.target.checked)} type="checkbox" /><span><strong>{label}</strong><small>{gapStatusLabels[pack.readiness[field].status]} · {pack.readiness[field].note ?? "无补充说明"}</small></span></label>; })}</fieldset> : <div className="reviewGapConfirmations"><strong>三项未知已确认</strong><p>当前没有需要再勾选的缺口，可直接进入教师私有草稿。</p></div>}
          <div className="reviewNote"><label htmlFor="gap-review-note">教师说明（退回或拒绝时必填）</label><textarea aria-describedby="gap-review-note-hint" aria-invalid={noteError ? "true" : undefined} className="teacherTextarea" id="gap-review-note" maxLength={300} onChange={(event) => { setNote(event.target.value); setNoteError(null); setNotice(null); }} ref={noteRef} value={note} /><p className="reviewFieldHint" data-state={noteError ? "error" : "default"} id="gap-review-note-hint" role={noteError ? "alert" : undefined}>{noteError ?? "退回或拒绝需填写 1–300 字说明；进入私有草稿无需填写。"}</p></div>
          <div className="reviewActions"><button className="teacherButton" disabled={pending} onClick={() => void decide("RETURN_TO_CODEX")} type="button"><RotateCcw size={16} />退回 Codex 补证</button><button className="teacherButton teacherButtonDanger" disabled={pending} onClick={() => void decide("REJECT_CANDIDATE")} type="button"><XCircle size={16} />拒绝候选</button><button className="teacherButton teacherButtonPrimary" disabled={pending || !allGapsAccepted} onClick={() => void decide("ENTER_PRIVATE_WIKIDRAFT")} type="button"><CheckCircle2 size={16} />进入私有草稿（保留缺口）</button></div>
          <p className="reviewBoundaryNote"><strong>边界持续生效：</strong> 不对学生可见、不创建正式页面、不写入对象存储、不生成向量索引、不进入 Lumi 引用。</p>
        </div>
      </section>
    </> : null}
  </TeacherAppShell>;
}

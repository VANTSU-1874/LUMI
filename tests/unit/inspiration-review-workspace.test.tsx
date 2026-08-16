import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvidenceGapReviewWorkspace, InspirationReviewWorkspace } from "@/components/teacher/InspirationReviewWorkspace";
import type { EvidenceGapReviewPack } from "@/lib/domain/inspiration-wiki/evidence-gap-review-contracts";
import { strictReviewPackFixture } from "@/tests/fixtures/inspiration-review-pack";

const gapPackFixture: EvidenceGapReviewPack = {
  schemaVersion: "lumi-inspiration-evidence-gap-review-pack/v1",
  contractKind: "EVIDENCE_GAP_REVIEW",
  reviewPackId: "review-pack:evidence-gap-unit-001",
  candidateId: `hermes-candidate:${"a".repeat(32)}`,
  revision: 1,
  stage: "READY_FOR_TEACHER_TRIAGE",
  materialHash: "b".repeat(64),
  preparedAt: "2026-08-12T08:00:00.000Z",
  work: { title: "待人工判断的缺证海报", creators: [], year: null, workSourceMatchEvidence: [] },
  sources: [{ sourceId: "source-1", platform: "PINTEREST", pageUrl: "https://www.pinterest.com/pin/123/", role: "DISCOVERY_POINTER", label: "Pinterest 发现记录", creatorName: null, curatorName: null, evidenceStatement: "仅证明发现入口存在。" }],
  mediaGroup: [],
  rightsEvidence: [],
  normalizedClassification: { primary: null, secondary: [], sourceTerms: ["poster"] },
  visualDescription: { summary: null, observations: [] },
  duplicateRelationship: { status: "UNASSESSED", relatedCandidateIds: [], explanation: null },
  curationRecommendation: { recommendation: "UNASSESSED", rationale: null },
  teachingRecommendation: { recommendation: "UNASSESSED", rationale: null, prompts: [], cautions: [] },
  safetyAssessment: { status: "UNASSESSED", evidence: [] },
  readiness: {
    controlledMediaGroup: { status: "MISSING", note: "尚无受控图片", evidenceRefs: [] },
    workSourceMatch: { status: "PRESENT_UNVERIFIED", note: "仅有发现入口", evidenceRefs: ["source-1"] },
    sourceRole: { status: "VERIFIED", note: "发现入口角色已确认", evidenceRefs: ["source-1"] },
    rightsEvidence: { status: "MISSING", note: "没有逐行为权利证据", evidenceRefs: [] },
    normalizedClassification: { status: "PRESENT_UNVERIFIED", note: "采集标签待规范", evidenceRefs: [] },
    visualDescription: { status: "BLOCKED", note: "无像素可观察", evidenceRefs: [] },
    duplicateRelationship: { status: "MISSING", note: "尚未比对", evidenceRefs: [] },
    curationRecommendation: { status: "MISSING", note: "尚未判断", evidenceRefs: [] },
    teachingRecommendation: { status: "MISSING", note: "尚未判断", evidenceRefs: [] },
  },
  capabilityBoundary: { teacherPrivate: true, studentVisible: false, currentPage: "DISABLED", r2: "DISABLED", embedding: "DISABLED", lumiRetrieval: "DISABLED" },
};

describe("InspirationReviewWorkspace", () => {
  afterEach(cleanup);

  it("renders the controlled image group, four evidence tabs and only three final actions", async () => {
    const nextReviewPackId = "review-pack:next-review-item-001";
    const navigate = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      reviewPackId: strictReviewPackFixture.reviewPackId,
      previousRevision: strictReviewPackFixture.revision,
      revision: strictReviewPackFixture.revision + 1,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      stage: "PRIVATE_WIKIDRAFT",
      capabilityBoundary: strictReviewPackFixture.capabilityBoundary,
      decidedAt: "2026-08-12T08:00:00.000Z",
      replayed: false,
      nextReviewPackId,
    }));
    const { container } = render(<InspirationReviewWorkspace fetcher={fetcher} initialPack={strictReviewPackFixture} navigate={navigate} reviewPackId={strictReviewPackFixture.reviewPackId} />);

    expect(screen.getByRole("heading", { name: strictReviewPackFixture.work.title })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "作品与来源" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "策展与教学" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "权利与安全" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "重复关系" })).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(4);
    expect(container.querySelector('img[src^="http"]')).toBeNull();

    const draft = screen.getByRole("button", { name: "进入私有草稿" });
    expect(draft).toBeDisabled();
    expect(screen.getByRole("button", { name: "退回 Codex 补证" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝候选" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /发布|学生可见|Current Page|R2|Embedding|Lumi 引用/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "权利与安全" }));
    expect(screen.getByText(/再发布许可：未知/)).toBeInTheDocument();
    expect(screen.getByText("作者作品页不等于再发布许可：是")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "一键认证六项" }));
    expect(screen.getByLabelText("作品与原始来源匹配")).toHaveValue("MATCH");
    expect(screen.getByLabelText("分类与描述")).toHaveValue("ACCURATE");
    expect(screen.getByLabelText("策展价值")).toHaveValue("VALUABLE");
    expect(screen.getByLabelText("教学价值")).toHaveValue("VALUABLE");
    expect(screen.getByLabelText("权利与安全结论")).toHaveValue("SUFFICIENT_FOR_PRIVATE_WIKIDRAFT");
    expect(screen.getByLabelText("重复关系")).toHaveValue("DISTINCT");
    expect(screen.getByRole("button", { name: "六项已认证" })).toBeDisabled();
    expect(draft).toBeEnabled();
    fireEvent.click(draft);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("/decision");
    expect(await screen.findByText("已进入私有草稿")).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith(`/teacher/inspiration-wiki/review/${encodeURIComponent(nextReviewPackId)}`);
  });

  it("opens a keyboard-accessible lightbox and keeps every enlarged image on the controlled relative URL", () => {
    const { container } = render(<InspirationReviewWorkspace initialPack={strictReviewPackFixture} reviewPackId={strictReviewPackFixture.reviewPackId} />);
    const firstMedia = strictReviewPackFixture.mediaGroup[0];
    const secondMedia = strictReviewPackFixture.mediaGroup[1];
    const openButton = screen.getByRole("button", { name: `放大查看：${firstMedia.alt}` });
    openButton.focus();
    fireEvent.click(openButton);

    expect(screen.getByRole("dialog", { name: firstMedia.alt })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `${firstMedia.alt}（放大预览）` })).toHaveAttribute("src", firstMedia.previewUrl);
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(screen.getByText("125%")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByRole("dialog", { name: secondMedia.alt })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `${secondMedia.alt}（放大预览）` })).toHaveAttribute("src", secondMedia.previewUrl);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(container.querySelector('img[src^="http"]')).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });

  it("keeps rejection actionable and explains the required note before submitting", async () => {
    const navigate = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      reviewPackId: strictReviewPackFixture.reviewPackId,
      previousRevision: strictReviewPackFixture.revision,
      revision: strictReviewPackFixture.revision + 1,
      finalAction: "REJECT_CANDIDATE",
      stage: "REJECTED",
      capabilityBoundary: strictReviewPackFixture.capabilityBoundary,
      decidedAt: "2026-08-12T08:05:00.000Z",
      replayed: false,
      nextReviewPackId: null,
    }));
    render(<InspirationReviewWorkspace fetcher={fetcher} initialPack={strictReviewPackFixture} navigate={navigate} reviewPackId={strictReviewPackFixture.reviewPackId} />);

    const reject = screen.getByRole("button", { name: "拒绝候选" });
    const note = screen.getByLabelText("教师说明（退回或拒绝时必填）");
    expect(reject).toBeEnabled();

    fireEvent.click(reject);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByText("请先填写拒绝理由，再提交拒绝。")).toHaveAttribute("role", "alert");
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(note).toHaveFocus();

    fireEvent.change(note, { target: { value: "该作品不适合当前教师案例池。" } });
    expect(note).not.toHaveAttribute("aria-invalid");
    fireEvent.click(reject);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.finalAction).toBe("REJECT_CANDIDATE");
    expect(body.note).toBe("该作品不适合当前教师案例池。");
    expect(await screen.findByText("已拒绝候选")).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith("/teacher/inspiration-wiki");
  });

  it("prefills the latest strict decision when editing an already reviewed item", () => {
    render(<InspirationReviewWorkspace
      initialEditContext={{
        currentStage: "REJECTED",
        currentReviewRevision: 2,
        latestDecision: {
          reviewPackRevision: 1,
          assessment: {
            workSourceMatch: "MATCH",
            classificationDescription: "ACCURATE",
            curationValue: "EXCLUDE",
            teachingValue: "EXCLUDE",
            rightsSafety: "BLOCKED",
            duplicateRelationship: "DISTINCT",
          },
          finalAction: "REJECT_CANDIDATE",
          note: "第一次审核认为权利风险不可接受。",
          decidedAt: "2026-08-12T08:05:00.000Z",
        },
      }}
      initialPack={strictReviewPackFixture}
      reviewPackId={strictReviewPackFixture.reviewPackId}
    />);

    expect(screen.getByText("正在再次编辑已审核结论")).toBeInTheDocument();
    expect(screen.getByText(/原结论继续保留在审计历史中/)).toBeInTheDocument();
    expect(screen.getByText(/审核修订 2/)).toBeInTheDocument();
    expect(screen.getByLabelText("教师说明（退回或拒绝时必填）")).toHaveValue("第一次审核认为权利风险不可接受。");
    expect(screen.getByLabelText("权利与安全结论")).toHaveValue("BLOCKED");
  });

  it("shows the HotDog review copy in Chinese without changing the source contract", () => {
    const hotDogPack = {
      ...strictReviewPackFixture,
      reviewPackId: "review-pack:bpando-hotdog-smlxl-001",
    };
    render(<InspirationReviewWorkspace initialPack={hotDogPack} reviewPackId={hotDogPack.reviewPackId} />);

    expect(screen.getByRole("heading", { name: "HotDog 宠物护理品牌视觉识别｜SMLXL" })).toBeInTheDocument();
    expect(screen.getByText(/同一套非正式视觉语言延展到文具、封箱胶带和产品图像/)).toBeInTheDocument();
    expect(screen.getAllByText(/宠物护理品牌视觉识别/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/HotDog combines a heavy black wordmark/)).not.toBeInTheDocument();
  });

  it("keeps evidence gaps visible and requires explicit acceptance before a private draft", async () => {
    const navigate = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      reviewPackId: gapPackFixture.reviewPackId,
      previousRevision: 1,
      revision: 2,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      stage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
      capabilityBoundary: gapPackFixture.capabilityBoundary,
      decidedAt: "2026-08-12T08:10:00.000Z",
      replayed: false,
      nextReviewPackId: null,
    }));
    const { container } = render(<EvidenceGapReviewWorkspace fetcher={fetcher} initialPack={gapPackFixture} navigate={navigate} reviewPackId={gapPackFixture.reviewPackId} />);

    expect(screen.getByText("人工缺证审核 · 已处理 1/9")).toBeInTheDocument();
    expect(screen.getAllByText("缺失").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已有材料，尚未核验").length).toBeGreaterThan(0);
    expect(screen.getByText("阻断")).toBeInTheDocument();
    expect(screen.getByText("当前没有受控图片")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /一键认证/ })).not.toBeInTheDocument();

    const draft = screen.getByRole("button", { name: "进入私有草稿（保留缺口）" });
    const reject = screen.getByRole("button", { name: "拒绝候选" });
    const note = screen.getByLabelText("教师说明（退回或拒绝时必填）");
    expect(draft).toBeDisabled();
    expect(screen.getByRole("button", { name: "退回 Codex 补证" })).toBeEnabled();
    expect(reject).toBeEnabled();

    fireEvent.click(reject);
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByText("请先填写拒绝理由，再提交拒绝。")).toHaveAttribute("role", "alert");
    expect(note).toHaveFocus();

    fireEvent.change(note, { target: { value: "理解并保留这些证据缺口，仅进入教师私有草稿。" } });
    expect(screen.getByRole("button", { name: "退回 Codex 补证" })).toBeEnabled();
    expect(draft).toBeDisabled();

    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect(draft).toBeEnabled();
    fireEvent.click(draft);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.privateDraftOnly).toBe(true);
    expect(body.acceptedGapKeys).toHaveLength(8);
    expect(await screen.findByText("已进入私有草稿（保留缺口）")).toBeInTheDocument();
    expect(navigate).toHaveBeenCalledWith("/teacher/inspiration-wiki");
    expect(screen.queryByRole("button", { name: /正式发布|正式入库|学生可见/ })).not.toBeInTheDocument();
  });

  it("allows a six-analyzed, three-confirmed-unknown candidate into a private draft without a note", async () => {
    const analyzedPack: EvidenceGapReviewPack = {
      ...gapPackFixture,
      revision: 3,
      normalizedClassification: { primary: "海报与字体设计", secondary: ["印刷与海报", "字体与排版"], sourceTerms: ["PRINT", "TYPOGRAPHY"] },
      visualDescription: {
        summary: "黑底上密布白色圆点，手写体标题从圆点之间穿过。",
        artisticStyle: { labels: ["实验字体", "几何抽象"], rationale: "手写字与高密度圆点共同建立强烈黑白节奏。" },
        observations: [{ observation: "圆点密度由边缘向字形周围变化，形成黑白节奏。", mediaIds: [] }],
      },
      duplicateRelationship: { status: "DISTINCT", relatedCandidateIds: [], explanation: "候选地址、图像校验值与现有作品均不相同。" },
      curationRecommendation: { recommendation: "RECOMMEND", rationale: "黑白图形语言明确，适合作为实验字体案例。" },
      teachingRecommendation: { recommendation: "RECOMMEND", rationale: "可用于分析字形与图底关系。", prompts: ["白色圆点如何改变标题的阅读顺序？"], cautions: ["只讨论可见构成，不推断创作者意图。"] },
      safetyAssessment: { status: "READY_FOR_TEACHER_DECISION", evidence: ["画面不含学生数据。"] },
      readiness: {
        controlledMediaGroup: { status: "VERIFIED", note: "已核验", evidenceRefs: ["media"] },
        workSourceMatch: { status: "UNKNOWN", note: "未知", evidenceRefs: [] },
        sourceRole: { status: "UNKNOWN", note: "未知", evidenceRefs: [] },
        rightsEvidence: { status: "UNKNOWN", note: "未知", evidenceRefs: [] },
        normalizedClassification: { status: "VERIFIED", note: "已分析", evidenceRefs: ["classification"] },
        visualDescription: { status: "VERIFIED", note: "已分析", evidenceRefs: ["visual"] },
        duplicateRelationship: { status: "VERIFIED", note: "已分析", evidenceRefs: ["dedupe"] },
        curationRecommendation: { status: "VERIFIED", note: "已分析", evidenceRefs: ["curation"] },
        teachingRecommendation: { status: "VERIFIED", note: "已分析", evidenceRefs: ["teaching"] },
      },
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      reviewPackId: analyzedPack.reviewPackId,
      previousRevision: 3,
      revision: 4,
      finalAction: "ENTER_PRIVATE_WIKIDRAFT",
      stage: "PRIVATE_WIKIDRAFT_WITH_GAPS",
      capabilityBoundary: analyzedPack.capabilityBoundary,
      decidedAt: "2026-08-12T13:30:00.000Z",
      replayed: false,
      nextReviewPackId: null,
    }));
    render(<EvidenceGapReviewWorkspace fetcher={fetcher} initialPack={analyzedPack} reviewPackId={analyzedPack.reviewPackId} />);

    expect(screen.getAllByText(/已确认：未知/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("艺术表现风格")).toBeInTheDocument();
    expect(screen.getByText("人工缺证审核 · 已处理 9/9")).toBeInTheDocument();
    expect(screen.getByText("实验字体 · 几何抽象")).toBeInTheDocument();
    expect(screen.getByText("海报与字体设计 / 印刷与海报 / 字体与排版")).toBeInTheDocument();
    expect(screen.getByText("黑底上密布白色圆点，手写体标题从圆点之间穿过。")).toBeInTheDocument();
    expect(screen.getByText(/圆点密度由边缘向字形周围变化，形成黑白节奏/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "策展与教学" }));
    expect(screen.getByText("策展建议 · 建议纳入")).toBeInTheDocument();
    expect(screen.getByText("黑白图形语言明确，适合作为实验字体案例。")).toBeInTheDocument();
    expect(screen.getByText("教学建议 · 建议纳入")).toBeInTheDocument();
    expect(screen.getByText(/白色圆点如何改变标题的阅读顺序/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "权利与安全" }));
    expect(screen.getAllByText("权利证据").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/仅供教师私有审核/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "重复关系" }));
    expect(screen.getByText("独立作品")).toBeInTheDocument();
    expect(screen.getByText("候选地址、图像校验值与现有作品均不相同。")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const draft = screen.getByRole("button", { name: "进入私有草稿（保留缺口）" });
    expect(draft).toBeEnabled();
    fireEvent.click(draft);

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ acceptedGapKeys: [], note: "", privateDraftOnly: true });
  });
});

"use client";

import Image from "next/image";
import { type KeyboardEvent, type MouseEvent, useMemo, useState } from "react";

import { LumiButton, LumiEmptyState, LumiTag } from "@/components/design-system/LumiUI";

import styles from "./student-app.module.css";
import type { LumiStudentSession } from "./use-lumi-student-session";

type ArtifactTab = "ARTWORK" | "CRITIQUE" | "GROWTH";

const statusLabels = {
  ESTABLISHED: "已有成立依据",
  DEVELOPING: "继续验证",
  NEEDS_EVIDENCE: "需要补证据",
} as const;

export function ArtifactPanel({
  session,
  previewUrl,
  activeTab,
  onTabChange,
  mobileOpen,
  onClose,
}: {
  session: LumiStudentSession;
  previewUrl: string;
  activeTab: ArtifactTab;
  onTabChange: (tab: ArtifactTab) => void;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotations, setAnnotations] = useState<Array<{ x: number; y: number }>>([]);
  const latest = session.latestTurn;
  const critique = latest?.critique;
  const savedArtwork = latest?.artworkAttachment?.previewUrl ?? "";
  const visibleArtwork = previewUrl || savedArtwork;
  const critiqueHistory = useMemo(() => session.turns.filter((turn) => Boolean(turn.critique)), [session.turns]);

  function annotate(event: MouseEvent<HTMLDivElement>) {
    if (!annotationMode || !visibleArtwork) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setAnnotations((current) => [...current, {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    }]);
  }

  function annotateFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!annotationMode || !visibleArtwork || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    setAnnotations((current) => [...current, { x: 50, y: 50 }]);
  }

  return <aside className={`${styles.artifactPanel} ${mobileOpen ? styles.artifactPanelOpen : ""}`} aria-label="学生作品与会诊">
    <header className={styles.artifactHeader}>
      <div><p>学生作品</p><span>{visibleArtwork ? "当前版本" : "等待上传"}</span></div>
      <button aria-label="在手机上关闭作品面板" className={styles.artifactClose} onClick={onClose} type="button">×</button>
    </header>
    <div className={styles.artifactTabs} role="tablist" aria-label="作品面板视图">
      {(["ARTWORK", "CRITIQUE", "GROWTH"] as const).map((value) => <button aria-selected={activeTab === value} key={value} onClick={() => onTabChange(value)} role="tab" type="button">
        {{ ARTWORK: "作品", CRITIQUE: "五维会诊", GROWTH: "成长档案" }[value]}
      </button>)}
    </div>

    <div className={styles.artifactContent}>
      {activeTab === "ARTWORK" ? <div className={styles.artworkView}>
        <div className={styles.artworkToolbar}>
          <div><button aria-label="缩小作品" disabled={!visibleArtwork || zoom <= 0.7} onClick={() => setZoom((value) => Math.max(0.7, value - 0.15))} type="button">−</button><span className="lumi-mixed-text">{Math.round(zoom * 100)}%</span><button aria-label="放大作品" disabled={!visibleArtwork || zoom >= 1.75} onClick={() => setZoom((value) => Math.min(1.75, value + 0.15))} type="button">＋</button></div>
          <div><button aria-pressed={annotationMode} disabled={!visibleArtwork} onClick={() => setAnnotationMode((value) => !value)} type="button">圈注</button><button disabled={annotations.length === 0} onClick={() => setAnnotations([])} type="button">清除</button></div>
        </div>
        {visibleArtwork ? <div className={`${styles.artworkCanvas} ${annotationMode ? styles.artworkCanvasAnnotating : ""}`} onClick={annotate} onKeyDown={annotateFromKeyboard} role={annotationMode ? "button" : undefined} tabIndex={annotationMode ? 0 : undefined}>
          <Image alt="当前学生作品" fill sizes="(max-width: 960px) 100vw, 48vw" src={visibleArtwork} style={{ transform: `scale(${zoom})` }} unoptimized />
          {annotations.map((point, index) => <span className={styles.annotation} key={`${point.x}-${point.y}-${index}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}>{index + 1}</span>)}
        </div> : <div className={styles.artworkEmpty}>
          <span aria-hidden="true">＋</span><h2>把作品放到这里</h2><p>在左侧对话框添加 PNG、JPEG 或 WebP。上传时会显示真实进度，完成后作品会常驻在这里。</p>
        </div>}
        <p className={styles.artworkCaption}>{annotationMode ? "在作品上点击添加临时圈注；圈注只保留在当前页面。" : "作品始终保留原色，界面只使用中性纸面与少量朱砂。"}</p>
      </div> : null}

      {activeTab === "CRITIQUE" ? <div className={styles.critiqueView}>
        <header>
          <div><p>FIVE-DIMENSION REVIEW</p><h2>五维总览</h2></div>
          {critique ? <LumiTag>{critique.frameworkVersion}</LumiTag> : null}
        </header>
        {critique ? <>
          <div className={styles.dimensionList}>
            {[...critique.dimensions].sort((left, right) => left.displayOrder - right.displayOrder).map((dimension) => <article className={dimension.isDeepDive ? styles.dimensionDeep : ""} key={dimension.id}>
              <div className={styles.dimensionIndex}><span>0{dimension.displayOrder}</span><i /></div>
              <div className={styles.dimensionBody}>
                <div><h3>{dimension.label}</h3><LumiTag accent={dimension.isDeepDive}>{dimension.isDeepDive ? "本轮深谈" : statusLabels[dimension.status]}</LumiTag></div>
                <p>{dimension.observation}</p>
                {dimension.evidence.length ? <details><summary>查看判断依据</summary><ul>{dimension.evidence.map((evidence) => <li key={`${evidence.kind}-${evidence.label}`}>{evidence.label}</li>)}</ul></details> : <small>当前证据不足，不作确定判断。</small>}
                <blockquote><b>{{ QUESTION: "追问", HINT: "提示", DEMONSTRATION: "局部示范" }[dimension.guidance.level]}</b>{dimension.guidance.message}</blockquote>
              </div>
            </article>)}
          </div>
          <section className={styles.closure} aria-labelledby="critique-closure-title">
            <div><p>本轮收束 / NEXT MOVE</p><h3 id="critique-closure-title">不是第六维，只留下一个可比较的动作。</h3></div>
            <dl><div><dt>哪里已经成立</dt><dd>{critique.closure.established}</dd></div><div><dt>下一步只改哪里</dt><dd>{critique.closure.nextStep}</dd></div>{critique.closure.historyReference ? <div><dt>相较上次</dt><dd>{critique.closure.historyReference.comparison}</dd></div> : null}</dl>
          </section>
        </> : <LumiEmptyState action={<LumiButton onClick={() => onTabChange("ARTWORK")} size="small" variant="secondary">先看作品</LumiButton>} description="上传作品并说明当前意图后，Lumi 会先做五维总览，只挑最影响目标的 1–2 维深谈。" title="还没有本轮会诊" />}
      </div> : null}

      {activeTab === "GROWTH" ? <div className={styles.growthView}>
        <header><p>只对本人可见</p><h2>成长档案</h2><span>这里记录你如何判断与修改，不做班级排名。</span></header>
        <div className={styles.growthStats}><div><b className="lumi-mixed-text">{session.turns.length}</b><span>本课程对话</span></div><div><b className="lumi-mixed-text">{critiqueHistory.length}</b><span>作品会诊</span></div><div><b className="lumi-mixed-text">{new Set(session.turns.map((turn) => turn.episode)).size}</b><span>学习情境</span></div></div>
        {critiqueHistory.length >= 2 ? <section className={styles.versionCompare}>
          <div className={styles.growthSectionTitle}><span>版本对照</span><small>依据已保存的会诊记录</small></div>
          <div>{critiqueHistory.slice(-2).map((turn, index) => <article key={turn.turnId}><LumiTag>{index === 0 ? "上一版" : "这一版"}</LumiTag><p>{turn.critique?.closure.established}</p><small>{new Date(turn.createdAt).toLocaleDateString("zh-CN")}</small></article>)}</div>
        </section> : <section className={styles.versionPrompt}><p>完成第二次作品会诊后，这里会并排显示上一版与这一版的可核对变化。</p></section>}
        <section className={styles.growthTimeline}>
          <div className={styles.growthSectionTitle}><span>本课程轨迹</span><small>按时间保存</small></div>
          {session.turns.length ? <ol>{[...session.turns].reverse().map((turn) => <li key={turn.turnId}><i /><div><time dateTime={turn.createdAt}>{new Date(turn.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><b>{turn.reply.title}</b><p>{turn.studentMessage}</p></div></li>)}</ol> : <p className={styles.growthEmpty}>完成第一段对话后，轨迹会出现在这里。</p>}
        </section>
      </div> : null}
    </div>
  </aside>;
}

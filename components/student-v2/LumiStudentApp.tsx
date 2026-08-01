"use client";

import { useEffect, useRef, useState } from "react";

import { LumiLoading } from "@/components/design-system/LumiUI";

import { ArtifactPanel } from "./ArtifactPanel";
import { ConversationPanel } from "./ConversationPanel";
import { StudentEntryGate } from "./StudentEntryGate";
import { StudentSidebar } from "./StudentSidebar";
import styles from "./student-app.module.css";
import { useLumiStudentSession } from "./use-lumi-student-session";

const acceptedArtworkTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxArtworkBytes = 5 * 1024 * 1024;

export function LumiStudentApp({ demo }: { demo: boolean }) {
  const session = useLumiStudentSession({ demo });
  const [artwork, setArtwork] = useState<File | null>(null);
  const [composerPreview, setComposerPreview] = useState("");
  const [artifactPreview, setArtifactPreview] = useState("");
  const [artworkError, setArtworkError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [artifactTab, setArtifactTab] = useState<"ARTWORK" | "CRITIQUE" | "GROWTH">("ARTWORK");
  const objectUrlRef = useRef("");

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  function selectArtwork(file: File) {
    if (!acceptedArtworkTypes.has(file.type)) {
      setArtworkError("仅支持 PNG、JPEG 或 WebP 图片。");
      return;
    }
    if (file.size > maxArtworkBytes) {
      setArtworkError("图片不能超过 5 MB，请压缩后再试。");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const preview = URL.createObjectURL(file);
    objectUrlRef.current = preview;
    setArtwork(file);
    setComposerPreview(preview);
    setArtifactPreview(preview);
    setArtworkError("");
    setArtifactTab("ARTWORK");
  }

  function clearArtwork() {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = "";
    setArtwork(null);
    setComposerPreview("");
    setArtifactPreview("");
    setArtworkError("");
  }

  async function submit(message: string) {
    const run = await session.submit(message, artwork);
    if (!run) return false;
    setArtwork(null);
    setComposerPreview("");
    return true;
  }

  function openArtifact(tab: "ARTWORK" | "CRITIQUE" | "GROWTH" = "CRITIQUE") {
    setArtifactTab(tab);
    setArtifactOpen(true);
  }

  if (session.entryRequired) {
    return <StudentEntryGate busy={session.loading} error={session.error} onEnter={session.enterStudent} />;
  }

  if (session.loading && session.tasks.length === 0) {
    return <main className={styles.initialLoading}>
      {demo ? <div className={styles.demoLoadingDisclosure}>预置演示 · 不是真实学生记录</div> : null}
      <div className={styles.initialBrand}>Lumi <small>鹿鸣</small></div>
      <LumiLoading label={demo ? "正在准备演示学习空间…" : "正在恢复你的学习空间…"} />
      <p>课程、历史对话与作品记录会在这里继续。</p>
    </main>;
  }

  return <main className={styles.studentApp}>
    <button aria-expanded={sidebarOpen} aria-label="打开课程与历史对话" className={styles.mobileMenuButton} onClick={() => setSidebarOpen(true)} type="button">
      <span /><span />
    </button>
    <StudentSidebar
      mobileOpen={sidebarOpen}
      onClose={() => setSidebarOpen(false)}
      onOpenGrowth={() => openArtifact("GROWTH")}
      session={session}
    />
    <ConversationPanel
      artwork={artwork}
      artworkError={artworkError}
      artworkPreview={composerPreview}
      onClearArtwork={clearArtwork}
      onOpenArtifact={() => openArtifact(session.latestTurn?.critique ? "CRITIQUE" : "ARTWORK")}
      onSelectArtwork={selectArtwork}
      onSubmit={submit}
      session={session}
    />
    {artifactOpen ? <button aria-label="关闭作品面板" className={styles.artifactScrim} onClick={() => setArtifactOpen(false)} type="button" /> : null}
    <ArtifactPanel
      activeTab={artifactTab}
      mobileOpen={artifactOpen}
      onClose={() => setArtifactOpen(false)}
      onTabChange={setArtifactTab}
      previewUrl={artifactPreview}
      session={session}
    />
  </main>;
}

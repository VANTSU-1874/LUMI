"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  DownloadIcon,
  FolderOpenIcon,
  ImageIcon,
  LibraryBigIcon,
  LoaderCircleIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  type LabPlugin,
  readLabPlugins,
} from "./assistant-lab-data";
import { requestJson } from "./assistant-lab-backend";
import { useComposerCapability } from "./assistant-lab-capability-state";
import type { DesignTask } from "@/lib/agent/design-project-task-contract";
import type { StudentLibraryAsset, StudentLibraryListResponse } from "@/lib/agent/student-library-contract";
import type { StudentProject, StudentProjectDetail } from "@/lib/agent/student-project-contract";
import styles from "./assistant-lab.module.css";

export type AssistantLabSection = "chat" | "library" | "projects" | "plugins";

export function AssistantLabSectionView({
  activeProjectId,
  onBackToChat,
  onOpenProject,
  section,
}: {
  activeProjectId: string | null;
  onBackToChat: () => void;
  onOpenProject: (project: DesignTask) => Promise<void>;
  section: Exclude<AssistantLabSection, "chat">;
}) {
  if (section === "library") {
    return <LabOutputLibrary activeProjectId={activeProjectId} onBackToChat={onBackToChat} />;
  }
  if (section === "projects") {
    return (
      <LabProjects
        activeProjectId={activeProjectId}
        onBackToChat={onBackToChat}
        onOpenProject={onOpenProject}
      />
    );
  }
  return <LabPlugins onBackToChat={onBackToChat} />;
}

function LabOutputLibrary({
  activeProjectId,
  onBackToChat,
}: {
  activeProjectId: string | null;
  onBackToChat: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<StudentLibraryAsset[]>([]);
  const [filter, setFilter] = useState<"all" | StudentLibraryAsset["source"]>("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "uploading">("loading");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    setStatus("loading");
    try {
      const response = await requestJson<StudentLibraryListResponse>("/api/agent/library");
      setAssets(response.assets);
      setStatus("ready");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "文件库暂时不可用");
      setStatus("ready");
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visibleAssets = assets.filter((asset) => {
    if (filter !== "all" && asset.source !== filter) return false;
    return !normalizedQuery || `${asset.fileName} ${asset.project?.title ?? ""} ${asset.mimeType}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
  });
  const usedBytes = assets.reduce((sum, asset) => sum + asset.byteSize, 0);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setStatus("uploading");
    try {
      const form = new FormData();
      form.append("file", file);
      if (activeProjectId) form.append("taskId", activeProjectId);
      await requestJson("/api/agent/library", { method: "POST", body: form });
      await refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "上传失败");
      setStatus("ready");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (asset: StudentLibraryAsset) => {
    if (!asset.canDelete || !window.confirm(`删除“${asset.fileName}”？此操作无法撤销。`)) return;
    setError("");
    try {
      await requestJson(`/api/agent/library/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      setAssets((current) => current.filter(({ id, source }) => id !== asset.id || source !== asset.source));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败");
    }
  };

  return (
    <section aria-labelledby="lab-library-title" className={styles.utilityView}>
      <UtilityHeader
        count={`${assets.length} 个文件`}
        onBackToChat={onBackToChat}
        title="文件库"
      />

      <div className={styles.libraryToolbar}>
        <p>上传和对话中的文件会自动保存在这里，可跨设备查找、下载和复用。</p>
        <input
          accept="image/png,image/jpeg,image/webp"
          aria-label="选择要上传的图片"
          hidden
          onChange={(event) => void upload(event.currentTarget.files?.[0])}
          ref={inputRef}
          type="file"
        />
        <button
          disabled={status === "uploading"}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          {status === "uploading" ? <LoaderCircleIcon aria-hidden="true" className={styles.spin} size={16} /> : <UploadIcon aria-hidden="true" size={16} />}
          <span>{status === "uploading" ? "上传中" : "上传图片"}</span>
        </button>
      </div>

      <div className={styles.librarySearch}>
        <SearchIcon aria-hidden="true" size={17} />
        <input aria-label="搜索文件" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索文件名或项目" value={query} />
        <span>{formatFileSize(usedBytes)} 已使用</span>
      </div>

      <div aria-label="文件来源" className={styles.utilityTabs} role="tablist">
        <button aria-selected={filter === "all"} onClick={() => setFilter("all")} role="tab" type="button">全部</button>
        <button aria-selected={filter === "DIRECT_UPLOAD"} onClick={() => setFilter("DIRECT_UPLOAD")} role="tab" type="button">独立上传</button>
        <button aria-selected={filter === "CHAT_ATTACHMENT"} onClick={() => setFilter("CHAT_ATTACHMENT")} role="tab" type="button">对话作品</button>
      </div>

      {error ? (
        <div className={styles.utilityNotice} role="alert">
          <span>{error}</span>
          <button onClick={() => void refresh()} type="button">重试</button>
        </div>
      ) : null}

      {status === "loading" ? (
        <div className={styles.utilityEmpty} aria-live="polite">
          <LoaderCircleIcon aria-hidden="true" className={styles.spin} size={28} />
          <strong>正在读取文件</strong>
        </div>
      ) : visibleAssets.length ? (
        <div className={styles.outputGrid}>
          {visibleAssets.map((asset) => (
            <article className={styles.outputCard} key={`${asset.source}:${asset.id}`}>
              <div className={styles.outputPreview}>
                <Image
                  alt={asset.fileName}
                  fill
                  sizes="(max-width: 800px) 100vw, 360px"
                  src={asset.previewUrl}
                  unoptimized
                />
                <span className={styles.assetSource}>{asset.source === "DIRECT_UPLOAD" ? "独立上传" : "对话作品"}</span>
              </div>
              <div className={styles.outputMeta}>
                <strong title={asset.fileName}>{asset.fileName}</strong>
                <span>{formatDate(asset.createdAt)} · {formatFileSize(asset.byteSize)} · {asset.width} × {asset.height}</span>
                <small title={asset.project?.title ?? "未归入项目"}>{asset.project?.title ?? "未归入项目"}</small>
              </div>
              <div className={styles.outputActions}>
                <a aria-label={`下载 ${asset.fileName}`} download href={asset.downloadUrl} title="下载">
                  <DownloadIcon aria-hidden="true" size={16} />
                </a>
                {asset.canDelete ? (
                  <button aria-label={`删除 ${asset.fileName}`} onClick={() => void remove(asset)} title="删除" type="button">
                    <Trash2Icon aria-hidden="true" size={16} />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.utilityEmpty}>
          <ImageIcon aria-hidden="true" size={28} />
          <strong>{filter === "all" ? "还没有文件" : "这一来源还没有文件"}</strong>
          <span>上传作品图片，或在对话中发送图片后再回来查看。</span>
        </div>
      )}
    </section>
  );
}

function LabProjects({
  activeProjectId,
  onBackToChat,
  onOpenProject,
}: {
  activeProjectId: string | null;
  onBackToChat: () => void;
  onOpenProject: (project: DesignTask) => Promise<void>;
}) {
  const [projects, setProjects] = useState<StudentProject[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [selected, setSelected] = useState<StudentProjectDetail | null>(null);
  const [availableTasks, setAvailableTasks] = useState<DesignTask[]>([]);
  const [taskToMove, setTaskToMove] = useState("");
  const [projectFiles, setProjectFiles] = useState<StudentLibraryAsset[]>([]);
  const projectFileInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const response = await requestJson<{ projects: StudentProject[] }>("/api/agent/projects");
      setProjects(response.projects);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "项目暂时不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    setError("");
    try {
      const detail = await requestJson<StudentProjectDetail>("/api/agent/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nextName, icon: "folder", color: "emerald", instructions: "" }),
      });
      setName("");
      const thread = detail.threads[0];
      if (thread) await onOpenProject(thread);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "新建项目失败");
    }
  };

  const updateProject = async (project: StudentProject, update: Partial<Pick<StudentProject, "status" | "name" | "instructions">>) => {
    setError("");
    try {
      await requestJson(`/api/agent/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
      });
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "更新项目失败");
    }
  };

  const removeProject = async (project: StudentProject) => {
    if (!window.confirm(`永久删除“${project.name}”、项目文件和其中的全部对话？此操作无法撤销。`)) return;
    setError("");
    try {
      await requestJson(`/api/agent/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除项目失败");
    }
  };

  const visibleProjects = projects.filter(({ status }) => status === filter);

  const openProject = async (project: StudentProject) => {
    setError("");
    try {
      const detail = await requestJson<StudentProjectDetail>(`/api/agent/projects/${encodeURIComponent(project.id)}`);
      const tasks = await requestJson<{ tasks: DesignTask[] }>("/api/agent/tasks");
      const library = await requestJson<StudentLibraryListResponse>("/api/agent/library");
      const contained = new Set(detail.threads.map(({ id }) => id));
      setAvailableTasks(tasks.tasks.filter(({ id, status }) => status === "ACTIVE" && !contained.has(id)));
      setProjectFiles(library.assets.filter((asset) => asset.project?.id === project.id));
      setSelected(detail);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "打开项目失败");
    }
  };

  const uploadProjectFile = async (file: File | undefined) => {
    if (!file || !selected?.threads[0]) return;
    setError("");
    try {
      const form = new FormData(); form.append("file", file); form.append("taskId", selected.threads[0].id);
      await requestJson("/api/agent/library", { method: "POST", body: form });
      const [detail, library] = await Promise.all([
        requestJson<StudentProjectDetail>(`/api/agent/projects/${encodeURIComponent(selected.project.id)}`),
        requestJson<StudentLibraryListResponse>("/api/agent/library"),
      ]);
      setSelected(detail); setProjectFiles(library.assets.filter((asset) => asset.project?.id === selected.project.id));
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "上传项目文件失败"); }
    finally { if (projectFileInput.current) projectFileInput.current.value = ""; }
  };

  const addNewConversation = async () => {
    if (!selected) return;
    setError("");
    try {
      const task = await requestJson<DesignTask>("/api/agent/tasks", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: `新对话 · ${selected.project.name}`, mode: "conversation" }),
      });
      const detail = await requestJson<StudentProjectDetail>(`/api/agent/projects/${encodeURIComponent(selected.project.id)}/threads`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: task.id }),
      });
      setSelected(detail);
      await onOpenProject(task);
    } catch (createError) { setError(createError instanceof Error ? createError.message : "新建项目对话失败"); }
  };

  const moveExistingConversation = async () => {
    if (!selected || !taskToMove) return;
    setError("");
    try {
      const detail = await requestJson<StudentProjectDetail>(`/api/agent/projects/${encodeURIComponent(selected.project.id)}/threads`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: taskToMove }),
      });
      setSelected(detail);
      setAvailableTasks((items) => items.filter(({ id }) => id !== taskToMove));
      setTaskToMove("");
    } catch (moveError) { setError(moveError instanceof Error ? moveError.message : "移入对话失败"); }
  };

  return (
    <section aria-labelledby="lab-projects-title" className={styles.utilityView}>
      <UtilityHeader
        count={`${projects.length} 个项目`}
        onBackToChat={onBackToChat}
        title="项目"
      />

      {selected ? (
        <section className={styles.projectWorkspace} aria-label={`${selected.project.name} 项目内容`}>
          <div className={styles.projectWorkspaceHeader}>
            <button aria-label="返回项目列表" onClick={() => setSelected(null)} type="button"><ArrowLeftIcon aria-hidden="true" size={16} /></button>
            <div><strong>{selected.project.name}</strong><span>{selected.project.threadCount} 条对话 · {selected.project.fileCount} 个文件</span></div>
            <button onClick={() => void addNewConversation()} type="button"><PlusIcon aria-hidden="true" size={16} />新对话</button>
          </div>
          <div className={styles.projectContextSummary}>
            <strong>项目说明</strong>
            <p>{selected.project.instructions || "尚未添加项目说明。项目说明会应用到这个项目内的每条对话。"}</p>
          </div>
          <div className={styles.projectFilesPanel}>
            <div><strong>项目文件</strong><button onClick={() => projectFileInput.current?.click()} type="button"><UploadIcon aria-hidden="true" size={15} />添加文件</button></div>
            <input accept="image/png,image/jpeg,image/webp" aria-label="选择项目文件" hidden onChange={(event) => void uploadProjectFile(event.currentTarget.files?.[0])} ref={projectFileInput} type="file" />
            {projectFiles.length ? projectFiles.map((asset) => <a href={asset.downloadUrl} key={`${asset.source}:${asset.id}`}><ImageIcon aria-hidden="true" size={15} /><span>{asset.fileName}</span><DownloadIcon aria-hidden="true" size={15} /></a>) : <p>还没有项目文件</p>}
          </div>
          <div className={styles.projectMoveRow}>
            <select aria-label="选择要移入项目的对话" onChange={(event) => setTaskToMove(event.currentTarget.value)} value={taskToMove}>
              <option value="">选择现有对话</option>
              {availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
            <button disabled={!taskToMove} onClick={() => void moveExistingConversation()} type="button">移入项目</button>
          </div>
          <div className={styles.projectThreadList}>
            {selected.threads.map((thread) => (
              <button key={thread.id} onClick={() => void onOpenProject(thread)} type="button">
                <span><strong>{thread.title}</strong><small>{formatDate(thread.updatedAt)}</small></span>
                <ArrowUpRightIcon aria-hidden="true" size={16} />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!selected ? <form className={styles.projectForm} onSubmit={createProject}>
        <label htmlFor="lab-project-name">项目名称</label>
        <div>
          <input
            id="lab-project-name"
            onChange={(event) => setName(event.currentTarget.value)}
            value={name}
          />
          <button disabled={!name.trim()} type="submit">
            <PlusIcon aria-hidden="true" size={16} />
            <span>新建项目</span>
          </button>
        </div>
      </form> : null}

      {!selected ? <div aria-label="项目状态" className={styles.utilityTabs} role="tablist">
        <button aria-selected={filter === "ACTIVE"} onClick={() => setFilter("ACTIVE")} role="tab" type="button">进行中</button>
        <button aria-selected={filter === "ARCHIVED"} onClick={() => setFilter("ARCHIVED")} role="tab" type="button">已归档</button>
      </div> : null}

      {error ? (
        <div className={styles.utilityNotice} role="alert">
          <span>{error}</span>
          <button onClick={() => void refresh()} type="button">重试</button>
        </div>
      ) : null}

      {!selected && loading ? (
        <div className={styles.utilityEmpty} aria-live="polite">
          <LoaderCircleIcon aria-hidden="true" className={styles.spin} size={28} />
          <strong>正在读取项目</strong>
        </div>
      ) : !selected && visibleProjects.length ? (
        <div className={styles.projectList}>
          {visibleProjects.map((project) => (
            <article className={styles.projectRow} data-active={activeProjectId === project.id} key={project.id}>
              <FolderOpenIcon aria-hidden="true" size={20} />
              <div>
                <strong>{project.name}</strong>
                <span>{project.threadCount} 条对话 · {project.fileCount} 个文件 · 更新于 {formatDate(project.updatedAt)}</span>
              </div>
              {project.status === "ACTIVE" ? (
                <button className={styles.openProjectButton} onClick={() => void openProject(project)} type="button">
                  打开
                </button>
              ) : (
                <button className={styles.openProjectButton} onClick={() => void updateProject(project, { status: "ACTIVE" })} type="button">恢复</button>
              )}
              <button
                aria-label={project.status === "ACTIVE" ? `归档项目 ${project.name}` : `取消归档项目 ${project.name}`}
                className={styles.rowIconButton}
                onClick={() => void updateProject(project, { status: project.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" })}
                title={project.status === "ACTIVE" ? "归档项目" : "取消归档"}
                type="button"
              >
                {project.status === "ACTIVE" ? <ArchiveIcon aria-hidden="true" size={16} /> : <ArchiveRestoreIcon aria-hidden="true" size={16} />}
              </button>
              <button
                aria-label={`设置项目 ${project.name}`}
                className={styles.rowIconButton}
                onClick={() => { setEditingId(project.id); setInstructions(project.instructions); }}
                title="项目设置"
                type="button"
              >
                <PlugIcon aria-hidden="true" size={16} />
              </button>
              <button
                aria-label={`删除项目 ${project.name}`}
                className={styles.rowIconButton}
                onClick={() => void removeProject(project)}
                title="删除项目"
                type="button"
              >
                <Trash2Icon aria-hidden="true" size={16} />
              </button>
            </article>
          ))}
          {editingId ? (
            <form className={styles.projectForm} onSubmit={(event) => {
              event.preventDefault();
              const project = projects.find(({ id }) => id === editingId);
              if (!project) return;
              void updateProject(project, { instructions }).then(() => setEditingId(null));
            }}>
              <label htmlFor="lab-project-instructions">项目说明</label>
              <textarea
                id="lab-project-instructions"
                maxLength={6000}
                onChange={(event) => setInstructions(event.currentTarget.value)}
                placeholder="说明 Lumi 在这个项目中的角色、语气和工作要求"
                rows={5}
                value={instructions}
              />
              <div>
                <button onClick={() => setEditingId(null)} type="button">取消</button>
                <button type="submit">保存说明</button>
              </div>
            </form>
          ) : null}
        </div>
      ) : !selected ? (
        <div className={styles.utilityEmpty}>
          <FolderOpenIcon aria-hidden="true" size={28} />
          <strong>{filter === "ACTIVE" ? "还没有进行中的项目" : "还没有已归档项目"}</strong>
        </div>
      ) : null}
    </section>
  );
}

function LabPlugins({ onBackToChat }: { onBackToChat: () => void }) {
  const plugins = readLabPlugins();
  const { select } = useComposerCapability();
  const [filter, setFilter] = useState<"all" | "available" | "authorization">("all");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().normalize("NFKC").toLowerCase();
  const visiblePlugins = plugins.filter((plugin) => {
    const matchesFilter = filter === "all"
      || (filter === "available" && plugin.status === "AVAILABLE")
      || (filter === "authorization" && plugin.status === "AUTHORIZATION_REQUIRED");
    if (!matchesFilter) return false;
    if (!normalizedQuery) return true;
    return `${plugin.name} ${plugin.description} ${plugin.kind}`
      .normalize("NFKC")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const availableCount = plugins.filter((plugin) => plugin.status === "AVAILABLE").length;
  const groups = [
    {
      id: "available",
      label: "已可用",
      description: "点击后带回对话，作为下一条消息的处理能力。",
      items: visiblePlugins.filter((plugin) => plugin.status === "AVAILABLE"),
    },
    {
      id: "authorization",
      label: "需要账户授权",
      description: "打开服务商官网；Lumi OAuth 接通前不会显示为已连接。",
      items: visiblePlugins.filter((plugin) => plugin.status === "AUTHORIZATION_REQUIRED"),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <section aria-labelledby="lab-plugins-title" className={styles.utilityView}>
      <UtilityHeader
        count={`${availableCount} 个已可用 · ${plugins.length} 个能力`}
        onBackToChat={onBackToChat}
        title="插件"
      />

      <div className={styles.pluginDirectoryIntro}>
        <div>
          <strong>插件与 Skill</strong>
          <span>云端插件、课程插件和 Lumi Skill 统一在这里管理。</span>
        </div>
        <label className={styles.pluginSearch}>
          <SearchIcon aria-hidden="true" size={15} />
          <span className="sr-only">搜索插件与 Skill</span>
          <input
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索插件与 Skill"
            type="search"
            value={query}
          />
        </label>
      </div>

      <div aria-label="插件状态" className={styles.utilityTabs} role="tablist">
        <button aria-selected={filter === "all"} onClick={() => setFilter("all")} role="tab" type="button">全部</button>
        <button aria-selected={filter === "available"} onClick={() => setFilter("available")} role="tab" type="button">已可用</button>
        <button aria-selected={filter === "authorization"} onClick={() => setFilter("authorization")} role="tab" type="button">需授权</button>
      </div>

      {groups.length ? (
        <div className={styles.pluginDirectory}>
          {groups.map((group) => (
            <section className={styles.pluginCatalogGroup} key={group.id}>
              <header>
                <h2>{group.label}</h2>
                <p>{group.description}</p>
              </header>
              <div className={styles.pluginGrid}>
                {group.items.map((plugin) => (
                  <PluginCatalogCard
                    key={plugin.id}
                    onBackToChat={onBackToChat}
                    onSelect={select}
                    plugin={plugin}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.utilityEmpty}>
          <SearchIcon aria-hidden="true" size={28} />
          <strong>没有找到匹配的插件或 Skill</strong>
        </div>
      )}
    </section>
  );
}

function PluginCatalogCard({
  onBackToChat,
  onSelect,
  plugin,
}: {
  onBackToChat: () => void;
  onSelect: ReturnType<typeof useComposerCapability>["select"];
  plugin: LabPlugin;
}) {
  const Icon = plugin.kind === "skill" ? LibraryBigIcon : PlugIcon;
  const statusLabel = plugin.status === "AVAILABLE"
    ? "已可用"
    : "待接 OAuth";

  return (
    <article
      className={styles.pluginCatalogCard}
      data-kind={plugin.kind}
      data-status={plugin.status}
    >
      <div className={styles.pluginCatalogIcon}>
        <Icon aria-hidden="true" size={19} />
      </div>
      <div className={styles.pluginCatalogMeta}>
        <div>
          <strong>{plugin.name}</strong>
          <span>{plugin.kind === "skill" ? "Skill" : "插件"}</span>
        </div>
        <p>{plugin.description}</p>
      </div>
      <span className={styles.pluginCatalogStatus}>{statusLabel}</span>
      {plugin.status === "AVAILABLE" && plugin.capabilityId ? (
        <button
          className={styles.pluginCatalogAction}
          onClick={() => {
            onSelect(plugin.capabilityId!);
            onBackToChat();
          }}
          type="button"
        >
          在对话中使用
        </button>
      ) : plugin.status === "AUTHORIZATION_REQUIRED" && plugin.authorizationUrl ? (
        <a
          className={styles.pluginCatalogAction}
          href={plugin.authorizationUrl}
          rel="noreferrer"
          target="_blank"
        >
          去官网授权
          <ArrowUpRightIcon aria-hidden="true" size={13} />
        </a>
      ) : null}
    </article>
  );
}

function UtilityHeader({
  count,
  onBackToChat,
  title,
}: {
  count: string;
  onBackToChat: () => void;
  title: string;
}) {
  const titleId = `lab-${title === "文件库" ? "library" : title === "项目" ? "projects" : "plugins"}-title`;
  return (
    <header className={styles.utilityHeader}>
      <button aria-label="返回对话" onClick={onBackToChat} title="返回对话" type="button">
        <ArrowLeftIcon aria-hidden="true" size={18} />
      </button>
      <div>
        <h1 id={titleId}>{title}</h1>
        <span>{count}</span>
      </div>
    </header>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFileSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

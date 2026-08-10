"use client";

import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  DownloadIcon,
  FileIcon,
  FolderOpenIcon,
  ImageIcon,
  LibraryBigIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import Image from "next/image";
import { type FormEvent, useEffect, useState } from "react";

import {
  LAB_DATA_EVENT,
  createLabProject,
  type LabOutput,
  type LabPlugin,
  type LabProject,
  readLabOutputs,
  readLabPlugins,
  readLabProjects,
  removeLabOutput,
  removeLabProject,
} from "./assistant-lab-data";
import { useComposerCapability } from "./assistant-lab-capability-state";
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
  onOpenProject: (project: LabProject) => void;
  section: Exclude<AssistantLabSection, "chat">;
}) {
  if (section === "library") {
    return <LabOutputLibrary onBackToChat={onBackToChat} />;
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

function LabOutputLibrary({ onBackToChat }: { onBackToChat: () => void }) {
  const [outputs, setOutputs] = useState<LabOutput[]>([]);
  const [filter, setFilter] = useState<"all" | LabOutput["kind"]>("all");

  useEffect(() => {
    const refresh = () => setOutputs(readLabOutputs());
    refresh();
    window.addEventListener(LAB_DATA_EVENT, refresh);
    return () => window.removeEventListener(LAB_DATA_EVENT, refresh);
  }, []);

  const visibleOutputs = outputs.filter((output) => (
    filter === "all" ? true : output.kind === filter
  ));

  return (
    <section aria-labelledby="lab-library-title" className={styles.utilityView}>
      <UtilityHeader
        count={`${outputs.length} 个输出`}
        onBackToChat={onBackToChat}
        title="文件库"
      />

      <div aria-label="文件类型" className={styles.utilityTabs} role="tablist">
        <button aria-selected={filter === "all"} onClick={() => setFilter("all")} role="tab" type="button">全部</button>
        <button aria-selected={filter === "image"} onClick={() => setFilter("image")} role="tab" type="button">图片</button>
        <button aria-selected={filter === "file"} onClick={() => setFilter("file")} role="tab" type="button">文件</button>
      </div>

      {visibleOutputs.length ? (
        <div className={styles.outputGrid}>
          {visibleOutputs.map((output) => (
            <article className={styles.outputCard} key={output.id}>
              {output.kind === "image" && output.previewUrl ? (
                <div className={styles.outputPreview}>
                  <Image
                    alt={output.name}
                    fill
                    sizes="(max-width: 800px) 100vw, 360px"
                    src={output.previewUrl}
                  />
                </div>
              ) : (
                <div className={styles.filePreview}>
                  <FileIcon aria-hidden="true" size={26} />
                  <span>MD</span>
                </div>
              )}
              <div className={styles.outputMeta}>
                <strong title={output.name}>{output.name}</strong>
                <span>{formatDate(output.createdAt)} · {output.kind === "image" ? "PNG" : "Markdown"}</span>
                <small title={output.sourceTitle}>{output.sourceTitle}</small>
              </div>
              <div className={styles.outputActions}>
                {output.previewUrl ? (
                  <a aria-label={`下载 ${output.name}`} download href={output.previewUrl} title="下载">
                    <DownloadIcon aria-hidden="true" size={16} />
                  </a>
                ) : (
                  <button aria-label={`下载 ${output.name}`} onClick={() => downloadTextOutput(output)} title="下载" type="button">
                    <DownloadIcon aria-hidden="true" size={16} />
                  </button>
                )}
                <button aria-label={`删除 ${output.name}`} onClick={() => removeLabOutput(output.id)} title="删除" type="button">
                  <Trash2Icon aria-hidden="true" size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.utilityEmpty}>
          <ImageIcon aria-hidden="true" size={28} />
          <strong>还没有输出</strong>
          <button onClick={onBackToChat} type="button">返回对话</button>
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
  onOpenProject: (project: LabProject) => void;
}) {
  const [projects, setProjects] = useState<LabProject[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    const refresh = () => setProjects(readLabProjects());
    refresh();
    window.addEventListener(LAB_DATA_EVENT, refresh);
    return () => window.removeEventListener(LAB_DATA_EVENT, refresh);
  }, []);

  const createProject = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    const project = createLabProject(nextName);
    setName("");
    onOpenProject(project);
  };

  return (
    <section aria-labelledby="lab-projects-title" className={styles.utilityView}>
      <UtilityHeader
        count={`${projects.length} 个项目`}
        onBackToChat={onBackToChat}
        title="项目"
      />

      <form className={styles.projectForm} onSubmit={createProject}>
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
      </form>

      {projects.length ? (
        <div className={styles.projectList}>
          {projects.map((project) => (
            <article className={styles.projectRow} data-active={activeProjectId === project.id} key={project.id}>
              <FolderOpenIcon aria-hidden="true" size={20} />
              <div>
                <strong>{project.name}</strong>
                <span>{formatDate(project.createdAt)}</span>
              </div>
              <button className={styles.openProjectButton} onClick={() => onOpenProject(project)} type="button">
                {activeProjectId === project.id ? "继续" : "打开"}
              </button>
              <button aria-label={`删除项目 ${project.name}`} className={styles.rowIconButton} onClick={() => removeLabProject(project.id)} title="删除项目" type="button">
                <Trash2Icon aria-hidden="true" size={16} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.utilityEmpty}>
          <FolderOpenIcon aria-hidden="true" size={28} />
          <strong>还没有项目</strong>
        </div>
      )}
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

function downloadTextOutput(output: LabOutput) {
  const url = URL.createObjectURL(new Blob([output.content ?? ""], { type: output.mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = output.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

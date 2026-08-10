"use client";

import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
  type DataMessagePartProps,
  type FileMessagePartProps,
  type ImageMessagePartProps,
  type ReasoningMessagePartProps,
  type SourceMessagePartProps,
  type TextMessagePartProps,
  type ThreadMessage,
  type ToolCallMessagePartProps,
  groupPartByType,
  makeAssistantToolUI,
  useAui,
  useAuiState,
  useToolCallElapsed,
} from "@assistant-ui/react";
import Link from "next/link";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClipboardListIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileOutputIcon,
  FileTextIcon,
  FolderIcon,
  HistoryIcon,
  ImageIcon,
  LibraryBigIcon,
  LoaderCircleIcon,
  MenuIcon,
  MicIcon,
  PaperclipIcon,
  PencilLineIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "motion/react";
import {
  type FormEvent,
  type PropsWithChildren,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
  Tool,
  ToolContent,
  ToolHeader,
} from "@/components/ai-elements/tool";
import { useSmoothStream } from "@/components/student/use-smooth-stream";
import { PlanTool } from "@/components/ui/plan-tool";
import {
  ThinkingTool,
  type ThinkingToolStep,
} from "@/components/ui/thinking-tool";
import {
  TodoTool,
  type TodoItem,
} from "@/components/ui/todo-tool";
import type { AgentRequestedCapabilityId } from "@/lib/agent/requested-capability";

import {
  type AssistantLabSection,
  AssistantLabSectionView,
} from "./AssistantLabSections";
import { LabAccountArea } from "./AssistantLabAccount";
import { LabThreadHeader } from "./AssistantLabExperience";
import { LabThreadMoreMenu } from "./AssistantLabThreadMenu";
import {
  LAB_DATA_EVENT,
  type LabProject,
  readActiveLabProjectId,
  setActiveLabProjectId,
} from "./assistant-lab-data";
import { shouldCollapseLongform } from "./longform-presentation";
import { AssistantLabRuntimeProvider } from "./assistant-lab-runtime";
import type { LumiExecutionProgressData } from "./assistant-lab-backend";
import {
  requestedCapabilityFromThreadMessage,
  useComposerCapability,
} from "./assistant-lab-capability-state";
import {
  assistantLabInterventionStatusLabel,
  useAssistantLabInterventions,
} from "./assistant-lab-interventions";
import { isContinuationIntent } from "./continuation-intent";
import { latestTextSnapshot } from "./latest-answer-snapshot";
import styles from "./assistant-lab.module.css";

const welcomeSuggestions = [
  {
    icon: PencilLineIcon,
    label: "点评我的设计",
    prompt: "请根据我提供的作品，从目标、创意转译和构成层级开始点评。",
  },
  {
    icon: ImageIcon,
    label: "整理作品思路",
    prompt: "帮我把当前作品的目标、受众和视觉方向整理清楚。",
  },
  {
    icon: SearchIcon,
    label: "查找课程资料",
    prompt: "帮我查找与当前问题相关的视觉传达课程资料。",
  },
  {
    icon: FileOutputIcon,
    label: "生成可交付方案",
    prompt: "基于当前工程生成一份可以继续修改和交付的设计方案文件。",
  },
];

const fallbackFollowupSuggestions = [
  {
    label: "把建议整理成执行清单",
    prompt: "请把刚才的建议整理成一份按优先级排序、可以逐项勾选的执行清单。",
  },
  {
    label: "生成三种方向草图提示",
    prompt: "基于刚才的回答，分别为信息型、情绪型和概念型方向生成三组草图提示。",
  },
  {
    label: "继续检索相关课程资料",
    prompt: "围绕刚才最关键的问题，继续检索可追溯的课程资料并说明引用关系。",
  },
  {
    label: "按五维标准继续会诊",
    prompt: "请按目标、创意转译、构成与层级、形式语言、工艺与规范继续会诊。",
  },
] as const;

const composerPlaceholders = [
  "想和 Lumi 一起理清什么？",
  "拖入作品，先做一次五维会诊。",
  "从一个还没想清楚的问题开始。",
  "说说这份设计最想解决什么。",
];

const composerPlaceholderContainerVariants: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.025,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.015,
      staggerDirection: -1,
    },
  },
};

const composerPlaceholderLetterVariants: Variants = {
  initial: {
    opacity: 0,
    filter: "blur(10px)",
    y: 8,
  },
  animate: {
    opacity: 1,
    filter: "blur(0px)",
    y: 0,
    transition: {
      opacity: { duration: 0.22 },
      filter: { duration: 0.36 },
      y: { type: "spring", stiffness: 90, damping: 20 },
    },
  },
  exit: {
    opacity: 0,
    filter: "blur(10px)",
    y: -8,
    transition: {
      opacity: { duration: 0.18 },
      filter: { duration: 0.28 },
      y: { type: "spring", stiffness: 90, damping: 20 },
    },
  },
};

type ComposerExtension = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  kind: "attachment" | "capability" | "unavailable";
  capabilityId?: AgentRequestedCapabilityId;
  statusLabel?: string;
};

const composerExtensionGroups: Array<{
  label: string;
  items: ComposerExtension[];
}> = [
  {
    label: "作品与素材",
    items: [
      {
        id: "attachment",
        label: "添加作品、照片或文件",
        description: "把素材带入这次对话",
        icon: PaperclipIcon,
        kind: "attachment",
      },
    ],
  },
  {
    label: "处理方式",
    items: [
      {
        id: "five-dimension",
        label: "五维一收",
        description: "上传作品后，按五维结构会诊",
        icon: ClipboardListIcon,
        kind: "capability",
        capabilityId: "five-dimension",
      },
      {
        id: "public-research",
        label: "公开资料研究",
        description: "本轮授权后检索公开网页",
        icon: ExternalLinkIcon,
        kind: "capability",
        capabilityId: "public-research",
      },
      {
        id: "course-reference",
        label: "课程资料检索",
        description: "检索当前课程包中的可追溯依据",
        icon: SearchIcon,
        kind: "capability",
        capabilityId: "course-reference",
      },
    ],
  },
  {
    label: "Lumi 专业 Skill",
    items: [
      {
        id: "book-design",
        label: "书籍设计 Skill",
        description: "读取书籍项目状态与课程规范",
        icon: FileTextIcon,
        kind: "capability",
        capabilityId: "book-design",
      },
      {
        id: "design-calculation",
        label: "设计计算",
        description: "比例、尺寸与数值关系计算",
        icon: ClipboardListIcon,
        kind: "capability",
        capabilityId: "design-calculation",
      },
      {
        id: "process-record",
        label: "项目过程记录",
        description: "读取当前项目状态与阶段证据",
        icon: HistoryIcon,
        kind: "capability",
        capabilityId: "process-record",
      },
      {
        id: "evidence-troubleshooting",
        label: "证据排障",
        description: "依据项目记录定位故障与缺口",
        icon: CircleAlertIcon,
        kind: "capability",
        capabilityId: "evidence-troubleshooting",
      },
      {
        id: "touchdesigner-cases",
        label: "TouchDesigner 案例库",
        description: "检索课程案例、节点网络与效果路径",
        icon: PlugIcon,
        kind: "capability",
        capabilityId: "touchdesigner-cases",
      },
      {
        id: "skill-installer",
        label: "Skill 安装",
        description: "审查来源、安全边界与安装方案",
        icon: DownloadIcon,
        kind: "capability",
        capabilityId: "skill-installer",
      },
      {
        id: "skill-creator",
        label: "Skill 创建",
        description: "把教学或创作流程整理成可复用技能",
        icon: LibraryBigIcon,
        kind: "capability",
        capabilityId: "skill-creator",
      },
    ],
  },
  {
    label: "需要账户授权",
    items: [
      {
        id: "figma",
        label: "Figma",
        description: "读取设计稿、评论与组件信息",
        icon: PencilLineIcon,
        kind: "unavailable",
        statusLabel: "需授权",
      },
      {
        id: "notion",
        label: "Notion",
        description: "读取项目文档与知识库",
        icon: FileTextIcon,
        kind: "unavailable",
        statusLabel: "需授权",
      },
      {
        id: "google-drive",
        label: "Google Drive",
        description: "读取云端文件、文档与表格",
        icon: FolderIcon,
        kind: "unavailable",
        statusLabel: "需授权",
      },
      {
        id: "canva",
        label: "Canva",
        description: "连接品牌与设计资产",
        icon: ImageIcon,
        kind: "unavailable",
        statusLabel: "需授权",
      },
      {
        id: "slack",
        label: "Slack",
        description: "读取已授权的项目讨论",
        icon: ExternalLinkIcon,
        kind: "unavailable",
        statusLabel: "需授权",
      },
    ],
  },
];

const composerCapabilityItems = composerExtensionGroups
  .flatMap((group) => group.items)
  .filter((item): item is ComposerExtension & {
    capabilityId: AgentRequestedCapabilityId;
  } => item.kind === "capability" && Boolean(item.capabilityId));

function composerCapabilityItem(id: AgentRequestedCapabilityId) {
  return composerCapabilityItems.find((item) => item.capabilityId === id);
}

type ToolRecord = Record<string, unknown>;
type ToolVisualState = "running" | "complete" | "error" | "pending" | "cancelled";

function asToolRecord(value: unknown): ToolRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ToolRecord
    : {};
}

function readToolString(record: ToolRecord, key: string) {
  return typeof record[key] === "string" ? record[key] : undefined;
}

function readToolStringList(record: ToolRecord, key: string) {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getToolStateLabel(state: ToolVisualState) {
  return {
    running: "进行中",
    complete: "已完成",
    error: "未完成",
    pending: "待确认",
    cancelled: "已取消",
  }[state];
}

function getToolDisplayName(toolName: string) {
  const knownNames: Record<string, string> = {
    "knowledge-map.search-concepts": "课程资料检索",
    "lumi.five_dimension_diagnosis": "五维会诊",
    "lumi.confirm_action": "操作确认",
  };
  return knownNames[toolName] ?? "外部工具";
}

function getToolActionLabel(toolName: string) {
  const knownLabels: Record<string, string> = {
    "knowledge-map.search-concepts": "检索课程资料",
    "lumi.five_dimension_diagnosis": "运行五维会诊",
    "lumi.confirm_action": "确认下一步操作",
  };
  return knownLabels[toolName] ?? "调用外部工具";
}

function getToolSkillLabel(toolName: string) {
  const labels: Record<string, string> = {
    "knowledge-map.search-concepts": "课程参考 Skill",
    "lumi.five_dimension_diagnosis": "五维会诊 Skill",
    "design-calculator.compute": "设计参数计算 Skill",
  };
  return labels[toolName];
}

function summarizeToolResult(toolName: string, result: unknown, args: unknown) {
  const output = asToolRecord(result);
  if (toolName === "knowledge-map.search-concepts") {
    const items = Array.isArray(output.items) ? output.items : [];
    if (items.length > 0) return `命中 ${items.length} 条可追溯课程依据`;
  }

  const summary =
    readToolString(output, "summary")
    ?? readToolString(output, "message")
    ?? readToolString(output, "status");
  return summary ?? (summarizeToolArgs(args) || undefined);
}

function summarizeToolArgs(value: unknown) {
  const hiddenKeys = new Set(["runId", "turnId", "actionId"]);
  const entries = Object.entries(asToolRecord(value))
    .filter(([key, item]) =>
      !hiddenKeys.has(key) &&
      (typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 3);

  return entries
    .map(([key, item]) => {
      const text = String(item);
      return `${key}: ${text.length > 34 ? `${text.slice(0, 31)}…` : text}`;
    })
    .join(" · ");
}

function formatElapsedTime(milliseconds: number | undefined) {
  if (milliseconds === undefined) return undefined;
  if (milliseconds < 1000) return "<1 秒";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分`;
}

function getSourceHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "外部来源";
  }
}

function getRetrievalStrategyLabel(strategy: string | undefined) {
  return strategy === "HYBRID"
    ? "混合检索"
    : strategy === "LEXICAL_FALLBACK"
      ? "词法检索"
      : strategy;
}

function getKnowledgeAuthorityLabel(authority: string | undefined) {
  const labels: Record<string, string> = {
    OFFICIAL: "官方资料",
    COURSE_DESIGN: "课程设计",
    TEACHER_EXPERIENCE: "教师经验",
    ANONYMIZED_CASE: "匿名案例",
  };
  return authority ? labels[authority] ?? authority : undefined;
}

function ToolStateIcon({
  size = 16,
  state,
}: {
  size?: number;
  state: ToolVisualState;
}) {
  if (state === "running") {
    return <LoaderCircleIcon aria-hidden="true" className={styles.spin} size={size} />;
  }
  if (state === "error") {
    return <CircleAlertIcon aria-hidden="true" size={size} />;
  }
  if (state === "pending") {
    return <CircleAlertIcon aria-hidden="true" size={size} />;
  }
  if (state === "cancelled") {
    return <XIcon aria-hidden="true" size={size} />;
  }
  return <CircleCheckIcon aria-hidden="true" size={size} />;
}

const KnowledgeSearchToolUI = makeAssistantToolUI<ToolRecord, unknown>({
  toolName: "knowledge-map.search-concepts",
  display: "standalone",
  render: LabKnowledgeSearchTool,
});

const FiveDimensionToolUI = makeAssistantToolUI<ToolRecord, unknown>({
  toolName: "lumi.five_dimension_diagnosis",
  display: "standalone",
  render: LabFiveDimensionTool,
});

const ConfirmActionToolUI = makeAssistantToolUI<ToolRecord, unknown>({
  toolName: "lumi.confirm_action",
  display: "standalone",
  render: LabConfirmActionTool,
});

const groupAssistantMessageParts = groupPartByType({
  reasoning: ["group-process", "group-reasoning"],
  "tool-call": ["group-process", "group-tools"],
  source: ["group-process", "group-sources"],
  data: ["group-process", "group-context"],
  text: ["group-answer"],
  "generative-ui": ["group-next-step"],
});

export function AssistantUiLab() {
  return (
    <AssistantLabRuntimeProvider>
      <KnowledgeSearchToolUI />
      <FiveDimensionToolUI />
      <ConfirmActionToolUI />
      <AssistantLabShell />
    </AssistantLabRuntimeProvider>
  );
}

function AssistantLabShell() {
  const aui = useAui();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<AssistantLabSection>("chat");
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(null);
  const sharedThreadHandled = useRef(false);
  const threadIsEmpty = useAuiState((state) => state.thread.isEmpty);
  useEffect(() => {
    const refresh = () => {
      setActiveProjectIdState(readActiveLabProjectId());
    };
    refresh();
    window.addEventListener(LAB_DATA_EVENT, refresh);
    return () => window.removeEventListener(LAB_DATA_EVENT, refresh);
  }, [threadIsEmpty]);

  useEffect(() => {
    if (sharedThreadHandled.current) return;
    const sharedThreadId = new URLSearchParams(window.location.search).get("thread");
    if (!sharedThreadId) return;
    sharedThreadHandled.current = true;
    void aui.threads().getLoadThreadsPromise().then(async () => {
      try {
        await aui.threads().switchToThread(sharedThreadId);
        setActiveSection("chat");
      } catch {
        // The task may no longer exist or the current account may not have access.
      }
    });
  }, [aui]);

  const toggleSearch = () => {
    if (searchOpen) setQuery("");
    setSearchOpen(!searchOpen);
  };

  const navigateTo = (section: AssistantLabSection) => {
    setActiveSection(section);
    setSidebarOpen(false);
  };

  const startGlobalChat = () => {
    setActiveLabProjectId(null);
    setActiveProjectIdState(null);
    setActiveSection("chat");
    setSidebarOpen(false);
  };

  const selectThread = (threadId: string | undefined) => {
    void threadId;
    setActiveSection("chat");
    setSidebarOpen(false);
  };

  const openProject = (project: LabProject) => {
    setActiveLabProjectId(project.id);
    setActiveProjectIdState(project.id);
    setActiveSection("chat");
    setSidebarOpen(false);
    void aui.threads().switchToNewThread();
  };

  return (
    <main className={styles.lab}>
      <aside
        aria-label="历史对话"
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}
      >
        <div className={styles.sidebarBrand}>
          <Link aria-label="返回 Lumi 首页" className={styles.wordmark} href="/">
            LUMI
          </Link>
          <div className={styles.sidebarBrandActions}>
            <button
              aria-expanded={searchOpen}
              aria-label={searchOpen ? "关闭搜索" : "搜索对话"}
              className={styles.iconButton}
              onClick={toggleSearch}
              title={searchOpen ? "关闭搜索" : "搜索对话"}
              type="button"
            >
              {searchOpen ? (
                <XIcon aria-hidden="true" size={17} />
              ) : (
                <SearchIcon aria-hidden="true" size={17} />
              )}
            </button>
            <button
              aria-label="关闭历史对话"
              className={`${styles.iconButton} ${styles.mobileClose}`}
              onClick={() => setSidebarOpen(false)}
              title="关闭"
              type="button"
            >
              <XIcon aria-hidden="true" size={17} />
            </button>
          </div>
        </div>
        <LabThreadList
          activeSection={activeSection}
          onNavigate={navigateTo}
          onNewChat={startGlobalChat}
          onSelectThread={selectThread}
          query={query}
          searchOpen={searchOpen}
          setQuery={setQuery}
        />
        <LabAccountArea />
      </aside>

      {sidebarOpen ? (
        <button
          aria-label="关闭历史对话"
          className={styles.scrim}
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <section aria-label="与 Lumi 对话" className={styles.workspace}>
        <header className={styles.topbar}>
          <button
            aria-label="打开历史对话"
            className={`${styles.iconButton} ${styles.mobileMenu}`}
            onClick={() => setSidebarOpen(true)}
            title="历史对话"
            type="button"
          >
            <MenuIcon aria-hidden="true" size={18} />
          </button>
          {activeSection === "chat" && threadIsEmpty ? (
            <div className={styles.topbarSpacer} aria-hidden="true" />
          ) : activeSection === "chat" ? (
            <LabThreadHeader />
          ) : (
            <div className={styles.topbarSpacer} aria-hidden="true" />
          )}
        </header>
        {activeSection === "chat" ? (
          <div
            className={styles.threadStage}
          >
            <LabThread />
          </div>
        ) : (
          <AssistantLabSectionView
            activeProjectId={activeProjectId}
            onBackToChat={() => navigateTo("chat")}
            onOpenProject={openProject}
            section={activeSection}
          />
        )}
      </section>
    </main>
  );
}

function LabThreadList({
  activeSection,
  onNavigate,
  onNewChat,
  onSelectThread,
  query,
  searchOpen,
  setQuery,
}: {
  activeSection: AssistantLabSection;
  onNavigate: (section: AssistantLabSection) => void;
  onNewChat: () => void;
  onSelectThread: (threadId: string | undefined) => void;
  query: string;
  searchOpen: boolean;
  setQuery: (query: string) => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const hasArchived = useAuiState(
    (state) => state.threads.archivedThreadIds.length > 0,
  );

  return (
    <ThreadListPrimitive.Root className={styles.threadList}>
      <ThreadListPrimitive.New asChild>
        <button
          className={styles.newThreadButton}
          onClick={onNewChat}
          type="button"
        >
          <PlusIcon aria-hidden="true" size={17} />
          <span>新对话</span>
        </button>
      </ThreadListPrimitive.New>

      <nav aria-label="Lumi 工具" className={styles.sidebarTools}>
        <button
          aria-current={activeSection === "library" ? "page" : undefined}
          onClick={() => onNavigate("library")}
          type="button"
        >
          <LibraryBigIcon aria-hidden="true" size={17} />
          <span>文件库</span>
        </button>
        <button
          aria-current={activeSection === "projects" ? "page" : undefined}
          onClick={() => onNavigate("projects")}
          type="button"
        >
          <FolderIcon aria-hidden="true" size={17} />
          <span>项目</span>
        </button>
        <button
          aria-current={activeSection === "plugins" ? "page" : undefined}
          onClick={() => onNavigate("plugins")}
          type="button"
        >
          <PlugIcon aria-hidden="true" size={17} />
          <span>插件</span>
        </button>
      </nav>

      {searchOpen ? (
        <label className={styles.threadSearch}>
          <SearchIcon aria-hidden="true" size={16} />
          <span className="sr-only">搜索对话</span>
          <input
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索对话"
            type="search"
            value={query}
          />
        </label>
      ) : null}

      <div className={styles.threadListLabel}>
        最近
      </div>
      <div className={styles.threadItems}>
        <ThreadListPrimitive.Items
          components={{
            ThreadListItem: () => (
              <LabThreadListItem
                onSelect={onSelectThread}
                query={query}
              />
            ),
          }}
        />
      </div>

      {hasArchived ? (
        <div className={styles.archivedBlock}>
          <button
            aria-expanded={showArchived}
            className={styles.archivedToggle}
            onClick={() => setShowArchived((current) => !current)}
            type="button"
          >
            <HistoryIcon aria-hidden="true" size={15} />
            <span>已归档</span>
            <ChevronDownIcon aria-hidden="true" size={15} />
          </button>
          {showArchived ? (
            <div className={styles.threadItems}>
              <ThreadListPrimitive.Items
                archived
                components={{ ThreadListItem: LabArchivedThreadListItem }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </ThreadListPrimitive.Root>
  );
}

function LabThreadListItem({
  onSelect,
  query,
}: {
  onSelect: (threadId: string | undefined) => void;
  query: string;
}) {
  const title = useAuiState(
    (state) => state.threadListItem.title ?? "新对话",
  );
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  if (query && !title.toLowerCase().includes(query.trim().toLowerCase())) {
    return null;
  }

  return (
    <ThreadListItemPrimitive.Root className={styles.threadItem}>
      <ThreadListItemPrimitive.Trigger asChild>
        <button onClick={() => onSelect(remoteId)} type="button">
          <span><ThreadListItemPrimitive.Title fallback="新对话" /></span>
        </button>
      </ThreadListItemPrimitive.Trigger>
      <LabThreadMoreMenu />
    </ThreadListItemPrimitive.Root>
  );
}

function LabArchivedThreadListItem() {
  return (
    <ThreadListItemPrimitive.Root className={`${styles.threadItem} ${styles.archivedItem}`}>
      <span><ThreadListItemPrimitive.Title fallback="已归档对话" /></span>
      <LabThreadMoreMenu archived />
    </ThreadListItemPrimitive.Root>
  );
}

function LabThread() {
  const isEmpty = useAuiState((state) => state.thread.isEmpty);

  return (
    <ThreadPrimitive.Root
      className={styles.threadRoot}
      data-empty={isEmpty}
    >
      <ThreadPrimitive.Viewport
        className={styles.threadViewport}
        turnAnchor="bottom"
      >
        <div className={styles.threadInner}>
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <LabWelcome />
          </AuiIf>

          <div className={styles.messageList}>
            <ThreadPrimitive.Messages>
              {() => <LabThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter className={styles.viewportFooter}>
            <ThreadPrimitive.ScrollToBottom asChild>
              <button
                aria-label="回到最新消息"
                className={styles.scrollButton}
                title="回到最新消息"
                type="button"
              >
                <ArrowDownIcon aria-hidden="true" size={17} />
              </button>
            </ThreadPrimitive.ScrollToBottom>
            <AuiIf condition={(state) => state.thread.isEmpty}>
              <LabWelcomeSuggestions />
            </AuiIf>
            <LabComposer />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function LabWelcome() {
  return (
    <div className={styles.welcome}>
      <h1>你今天想一起把什么设计清楚？</h1>
    </div>
  );
}

function LabWelcomeSuggestions() {
  return (
    <div className={styles.welcomeSuggestions}>
      {welcomeSuggestions.map(({ icon: Icon, label, prompt }) => (
        <ThreadPrimitive.Suggestion
          asChild
          key={label}
          prompt={prompt}
          send
        >
          <button type="button">
            <Icon aria-hidden="true" size={16} />
            <span>{label}</span>
          </button>
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
}

function LabThreadMessage() {
  const role = useAuiState((state) => state.message.role);
  return role === "user" ? <LabUserMessage /> : <LabAssistantMessage />;
}

function LabAssistantMessage() {
  const incomplete = useAuiState((state) => Boolean(partialResponseReason(
    state.message.parts as readonly { type: string; name?: string; data?: unknown }[],
  )));
  return (
    <MessagePrimitive.Root className={styles.assistantMessage} data-incomplete={incomplete || undefined}>
      <div className={styles.assistantBody}>
        <LabAssistantParts />
        <LabAnswerGroup />
        <LabPartialAnswerNotice />
        <LabMessageError />
        <div className={styles.messageFooter}>
          <LabAssistantActions />
        </div>
        <LabFollowupSuggestions />
      </div>
    </MessagePrimitive.Root>
  );
}

function LabAssistantParts() {
  return (
    <MessagePrimitive.GroupedParts
      groupBy={groupAssistantMessageParts}
      indicator="no-text"
    >
      {({ part, children }) => {
        switch (part.type) {
          case "group-process":
            return (
              <LabProcessGroup
                indices={part.indices}
                status={part.status.type}
              >
                {children}
              </LabProcessGroup>
            );
          case "group-reasoning":
            return <div className={styles.processReasoning}>{children}</div>;
          case "group-tools":
            return (
              <LabToolGroup indices={part.indices}>
                {children}
              </LabToolGroup>
            );
          case "group-sources":
            return (
              <LabSourcesGroup count={part.indices.length}>
                {children}
              </LabSourcesGroup>
            );
          case "group-context":
            return <div className={styles.processContext}>{children}</div>;
          case "group-answer":
            // The local assistant-ui runtime appends each streaming update to
            // the message. Lumi's adapter deliberately emits whole snapshots,
            // so rendering every text part would show duplicate bodies during
            // a continuation. The stable answer surface below selects the
            // latest snapshot instead.
            return null;
          case "group-next-step":
            return (
              <section
                aria-label="可继续操作"
                className={styles.nextStepGroup}
              >
                <span>下一步</span>
                {children}
              </section>
            );
          case "text":
            return null;
          case "reasoning":
            return <LabReasoningPart {...part} />;
          case "source":
            return <LabSourcePart {...part} />;
          case "tool-call":
            return part.toolUI ?? <LabToolPart {...part} />;
          case "data":
            if (part.name === "lumi-response") {
              return <LabResponseDataPart {...part} />;
            }
            if (part.name === "lumi-execution-progress") {
              return <LabExecutionProgressPart {...part} />;
            }
            if (part.name === "lumi-continuation") return null;
            return part.dataRendererUI;
          case "generative-ui":
            return (
              <MessagePrimitive.GenerativeUI
                components={{ CapabilityChecklist }}
              />
            );
          case "image":
            return <LabAssistantImagePart {...part} />;
          case "file":
            return <LabAssistantFilePart {...part} />;
          case "indicator":
            // Model liveness is already represented by the thinking header
            // and its step stream. Rendering another indicator here repeats
            // the same state and makes it look like two independent tasks.
            return null;
          default:
            return null;
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

/**
 * Thinking duration is driven only by the model-liveness phase.  Tool cards
 * retain their own elapsed timers, so a long retrieval can never overwrite
 * the learner-facing “已思考” duration.
 */
function useThinkingElapsed(thinking: boolean) {
  const startedAt = useRef<number | undefined>(undefined);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!thinking) return;
    startedAt.current ??= Date.now();
    const update = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt.current!) / 1_000)));
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [thinking]);

  useEffect(() => {
    if (thinking || startedAt.current === undefined) return;
    setElapsed(Math.max(0, Math.floor((Date.now() - startedAt.current) / 1_000)));
  }, [thinking]);

  return elapsed;
}

function LabProcessGroup({
  children,
  indices,
  status,
}: PropsWithChildren<{
  indices: readonly number[];
  status: string;
}>) {
  const isActionGroup = useAuiState((state) => indices.every((index) => {
    const part = state.message.parts[index];
    return part?.type === "tool-call"
      && (
        part.toolName === "lumi.confirm_action"
        || part.toolName === "lumi.five_dimension_diagnosis"
      );
  }));
  const hasModelLiveness = useAuiState((state) => indices.some((index) => {
    const part = state.message.parts[index];
    if (!part) return false;
    if (part.type === "reasoning") return part.text.trim().length > 0;
    if (part.type !== "data" || part.name !== "lumi-execution-progress") return false;
    const progress = part.data as LumiExecutionProgressData;
    return Array.isArray(progress.items) && progress.items.length > 0;
  }));
  const messageParts = useAuiState((state) => state.message.parts);
  const messageStatus = useAuiState((state) => state.message.status?.type);
  const steps = useMemo(() => {
    const nextSteps: ThinkingToolStep[] = [];
    const seen = new Set<string>();
    const appendStep = (step: ThinkingToolStep) => {
      const label = step.label.replace(/\s+/g, " ").trim();
      const key = label
        .replace(/^(正在|已|开始|执行|运行|调用)/, "")
        .replace(/[，。；：:]/g, "")
        .toLowerCase();
      if (!label || seen.has(key)) return;
      seen.add(key);
      nextSteps.push({ ...step, label });
    };
    const appendToolStep = (
      part: Extract<(typeof messageParts)[number], { type: "tool-call" }>,
    ) => {
      const running =
        part.status.type === "running" && part.result === undefined;
      const errored =
        part.isError
        || (
          part.status.type === "incomplete"
          && part.status.reason !== "cancelled"
        );
      appendStep({
        id: part.toolCallId,
        label: getToolActionLabel(part.toolName),
        detail: summarizeToolResult(part.toolName, part.result, part.args),
        skillLabel: getToolSkillLabel(part.toolName),
        status: errored
          ? "error"
          : part.status.type === "requires-action"
            ? "pending"
            : running
              ? "running"
              : "complete",
      });
    };
    const progressItems = messageParts
      .filter((part) =>
        part.type === "data" && part.name === "lumi-execution-progress"
      )
      .flatMap((part) => {
        if (part.type !== "data") return [];
        const progress = part.data as unknown as LumiExecutionProgressData;
        return Array.isArray(progress.items) ? progress.items : [];
      })
      .sort((left, right) => left.sequence - right.sequence);
    const toolParts = messageParts.filter((part) => part.type === "tool-call");
    let toolCursor = 0;

    if (progressItems.length > 0) {
      appendStep({
        label: "理解你的问题并确定回答重点",
        status: "complete",
      });

      for (const item of progressItems) {
        if (item.kind === "TOOL_CALL") {
          const toolPart = toolParts[toolCursor];
          if (toolPart?.type === "tool-call") {
            appendToolStep(toolPart);
            toolCursor += 1;
          } else {
            appendStep({
              id: item.id,
              label: "调用辅导工具",
              detail: item.summary || undefined,
              status: item.status === "failed" ? "error" : "complete",
            });
          }
          continue;
        }

        if (item.kind === "TOOL_OBSERVATION") {
          const lastStep = nextSteps.at(-1);
          if (lastStep && item.summary.trim()) {
            lastStep.detail = item.summary.trim();
          } else {
            appendStep({
              id: item.id,
              label: "读取工具结果",
              detail: item.summary || undefined,
              status: item.status === "failed" ? "error" : "complete",
            });
          }
          continue;
        }

        if (item.kind === "MODEL_DECISION") {
          const isFinalAnswer = item.label.includes("形成自然语言");
          appendStep({
            id: item.id,
            label: isFinalAnswer ? "整理并形成回答" : "判断需要补充课程依据",
            detail: isFinalAnswer
              ? "将工具结果与设计建议分层组织"
              : undefined,
            status: item.status === "failed" ? "error" : "complete",
          });
          continue;
        }

        appendStep({
          id: item.id,
          label: item.label,
          detail: item.summary || undefined,
          status: item.status === "failed" ? "error" : "complete",
        });
      }
    } else if (messageParts.some((part) => part.type === "reasoning" && part.text.trim())) {
      // Public run events intentionally never contain hidden chain-of-thought.
      // The live reasoning part is only a liveness summary, so keep the UI
      // honest and present it as an actual processing step.
      appendStep({
        label: "保持模型连接并整理回答",
        status: messageStatus === "running" ? "running" : "complete",
      });
    }

    for (const toolPart of toolParts.slice(toolCursor)) {
      if (toolPart.type === "tool-call") appendToolStep(toolPart);
    }

    const messageRunning = messageStatus === "running";
    if (nextSteps.length === 0) {
      appendStep({
        label: "理解问题并确定回答方向",
        status: messageRunning ? "running" : "complete",
      });
    } else if (
      messageRunning
      && !nextSteps.some((step) => step.status === "running")
    ) {
      appendStep({ label: "组织回答", status: "running" });
    }

    return nextSteps.slice(0, 8);
  }, [messageParts, messageStatus]);
  const thinking =
    status === "running" || status === "requires-action";
  const thinkingElapsed = useThinkingElapsed(thinking);
  if (isActionGroup || !hasModelLiveness) return children;
  const visibleSteps = thinking
    ? steps
    : steps.map((step) =>
        step.status === "running" ? { ...step, status: "complete" as const } : step
      );

  return (
    <>
      <ThinkingTool
        className={styles.thinkingToolAdapter}
        elapsedSeconds={thinkingElapsed}
        steps={visibleSteps}
        streamLabel="处理步骤摘要"
        thinkingLabel="Lumi 正在思考"
        thoughtLabel="已思考"
        state={thinking ? "thinking" : "thought"}
      />
      <div className={styles.processArtifacts}>{children}</div>
    </>
  );
}

function LabSourcesGroup({
  children,
  count,
}: PropsWithChildren<{
  count: number;
}>) {
  return (
    <Sources className={styles.sourcesElement}>
      <SourcesTrigger
        className={styles.sourcesTrigger}
        count={count}
        type="button"
      >
        <FileTextIcon aria-hidden="true" size={15} />
        <span>参考来源</span>
        <small>{count} 条</small>
        <ChevronDownIcon
          aria-hidden="true"
          className={styles.sourcesChevron}
          size={14}
        />
      </SourcesTrigger>
      <SourcesContent className={styles.sourcesContent}>
        {children}
      </SourcesContent>
    </Sources>
  );
}

function LabToolGroup({
  children,
  indices,
}: PropsWithChildren<{ indices: readonly number[] }>) {
  const isActionGroup = useAuiState((state) => indices.every((index) => {
    const part = state.message.parts[index];
    return part?.type === "tool-call"
      && (
        part.toolName === "lumi.confirm_action"
        || part.toolName === "lumi.five_dimension_diagnosis"
      );
  }));
  const messageParts = useAuiState((state) => state.message.parts);
  const summary = useMemo(() => {
    const toolNames = indices
      .map((index) => messageParts[index])
      .filter((part) => part?.type === "tool-call")
      .map((part) => getToolActionLabel(part.toolName));
    const uniqueNames = [...new Set(toolNames)];
    const running = indices.some((index) => {
      const part = messageParts[index];
      return part?.type === "tool-call" && part.status.type === "running";
    });
    const errored = indices.some((index) => {
      const part = messageParts[index];
      return part?.type === "tool-call" && Boolean(part.isError);
    });
    return {
      label: uniqueNames.join("、") || "使用工具",
      running,
      state: errored ? "error" as const : running ? "running" as const : "complete" as const,
    };
  }, [indices, messageParts]);
  if (isActionGroup || indices.length < 2) return children;

  return (
    <details
      className={styles.toolCollection}
      data-state={summary.state}
      open={summary.running || undefined}
    >
      <summary>
        <ToolStateIcon state={summary.state} />
        <span>
          <strong className={summary.running ? styles.shimmerText : undefined}>
            {summary.label}
          </strong>
          <small>{indices.length} 项工具结果</small>
        </span>
        <ChevronDownIcon aria-hidden="true" size={15} />
      </summary>
      <div>{children}</div>
    </details>
  );
}

function LabAnswerGroup() {
  const latestTextPart = useAuiState((state) => latestTextSnapshot(state.message.parts));

  if (!latestTextPart) return null;

  return (
    <section aria-label="Lumi 最终回答" className={styles.answerGroup}>
      <div className={styles.answerGroupBody}>
        <LabTextPart {...latestTextPart} />
      </div>
    </section>
  );
}

function LabUserMessage() {
  const messageId = useAuiState((state) => state.message.id);
  const metadata = useAuiState((state) => state.message.metadata);
  const { getForMessage } = useComposerCapability();
  const capability = getForMessage(messageId)
    ?? requestedCapabilityFromThreadMessage(
      { metadata } as Pick<ThreadMessage, "metadata">,
    );
  const capabilityItem = capability
    ? composerCapabilityItem(capability.id)
    : undefined;

  return (
    <MessagePrimitive.Root className={styles.userMessage}>
      <div className={styles.userAttachments}>
        <MessagePrimitive.Attachments>
          {() => <LabAttachment />}
        </MessagePrimitive.Attachments>
      </div>
      <div className={styles.userBubble}>
        {capabilityItem ? <span className={styles.userCapability}>{capabilityItem.label} Skill</span> : null}
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function LabAssistantImagePart({
  filename,
  image,
}: ImageMessagePartProps) {
  return (
    <figure className={styles.assistantImage}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={filename ?? "Lumi 生成的图片"} src={image} />
      {filename ? <figcaption>{filename}</figcaption> : null}
    </figure>
  );
}

function LabAssistantFilePart({
  data,
  filename,
  mimeType,
}: FileMessagePartProps) {
  return (
    <a
      className={styles.assistantFile}
      download={filename}
      href={data}
    >
      <FileTextIcon aria-hidden="true" size={16} />
      <span>{filename ?? "下载附件"}</span>
      <small>{mimeType}</small>
      <DownloadIcon aria-hidden="true" size={15} />
    </a>
  );
}

function documentCharacterCount(text: string) {
  return text.replace(/\s/g, "").length;
}

function documentTitle(text: string) {
  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]
    ?.replace(/[*_`]/g, "")
    .trim();
  return heading || "Lumi 设计文档";
}

function safeDocumentFileName(title: string) {
  const safe = title.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return `${safe || "lumi-document"}.md`;
}

function LabMarkdownResponse({
  className,
  isStreaming,
  text,
}: {
  className?: string;
  isStreaming: boolean;
  text: string;
}) {
  return (
    <MessageResponse
      className={`${styles.markdown} ${className ?? ""}`}
      controls={{
        code: { copy: true, download: false },
        mermaid: {
          copy: true,
          download: false,
          fullscreen: true,
          panZoom: true,
        },
        table: { copy: true, download: false, fullscreen: true },
      }}
      dir="auto"
      isAnimating={isStreaming}
      lineNumbers={false}
      mode={isStreaming ? "streaming" : "static"}
      translations={{
        copied: "已复制",
        copyCode: "复制",
        copyTable: "复制表格",
        copyTableAsCsv: "复制为 CSV",
        copyTableAsMarkdown: "复制为 Markdown",
        copyTableAsTsv: "复制为 TSV",
        exitFullscreen: "退出全屏",
        viewFullscreen: "全屏查看",
      }}
    >
      {text}
    </MessageResponse>
  );
}

function useLongformPresentation(text: string, isStreaming: boolean) {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const settledTextRef = useRef<string | null>(null);
  const [collapseEligible, setCollapseEligible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isStreaming) {
      settledTextRef.current = null;
      return;
    }

    const content = contentRef.current;
    const section = sectionRef.current;
    if (!content || !section) return;

    const viewport = section.closest(`.${styles.threadViewport}`) as HTMLElement | null;
    let frame: number | undefined;
    const measure = () => {
      frame = undefined;
      const viewportHeight = viewport?.clientHeight ?? 0;
      const nextEligible = shouldCollapseLongform({
        contentHeight: content.scrollHeight,
        isStreaming,
        viewportHeight,
      });
      setCollapseEligible((current) => current === nextEligible ? current : nextEligible);

      if (!nextEligible) {
        setExpanded(false);
        settledTextRef.current = text;
        return;
      }

      if (settledTextRef.current !== text) {
        settledTextRef.current = text;
        setExpanded(false);
      }
    };
    const scheduleMeasure = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const observer = typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(scheduleMeasure);
    observer?.observe(content);
    if (viewport) observer?.observe(viewport);
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [isStreaming, text]);

  const collapseToSectionStart = () => {
    setExpanded(false);
    window.requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      sectionRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  return {
    collapseEligible,
    collapseToSectionStart,
    contentRef,
    expanded,
    sectionRef,
    setExpanded,
  };
}

function LabLongform({
  children,
  incomplete,
  isStreaming,
  reason,
  text,
}: PropsWithChildren<{
  incomplete: boolean;
  isStreaming: boolean;
  reason?: PartialResponseReason;
  text: string;
}>) {
  const {
    collapseEligible,
    collapseToSectionStart,
    contentRef,
    expanded,
    sectionRef,
    setExpanded,
  } = useLongformPresentation(text, isStreaming);
  const title = documentTitle(text);
  const characterCount = documentCharacterCount(text);
  const collapsed = !isStreaming && collapseEligible && !expanded;
  const showLongformActions = collapseEligible && !isStreaming;
  const download = () => {
    const href = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = safeDocumentFileName(title);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  };
  const print = () => {
    setExpanded(true);
    document.body.dataset.lumiDocumentPrint = "true";
    const clear = () => { delete document.body.dataset.lumiDocumentPrint; };
    window.addEventListener("afterprint", clear, { once: true });
    window.setTimeout(clear, 5_000);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });
  };

  return (
    <section
      className={styles.longform}
      data-collapsed={collapsed || undefined}
      ref={sectionRef}
    >
      <div className={styles.longformBody}>
        <div className={styles.longformContent} ref={contentRef}>
          {children}
        </div>
        {collapsed ? <div aria-hidden="true" className={styles.longformVeil} /> : null}
      </div>
      {incomplete ? (
        <LabPartialAnswerCallout
          actionClassName={showLongformActions ? styles.longformContinueActions : styles.partialContinueActions}
          buttonClassName={showLongformActions ? styles.longformContinueButton : styles.partialContinueButton}
          className={showLongformActions ? styles.longformIncomplete : styles.partialAnswerNotice}
          reason={reason}
        />
      ) : null}
      {showLongformActions ? (
        <div className={styles.longformActions}>
          <button
            className={styles.longformToggleButton}
            data-expanded={expanded || undefined}
            onClick={() => expanded ? collapseToSectionStart() : setExpanded(true)}
            type="button"
          >
            {collapsed ? "展开全文" : "收起"}
          </button>
          <span aria-hidden="true" className={styles.longformActionDivider}>·</span>
          <span className={styles.longformMeta}>约 {characterCount.toLocaleString()} 字</span>
          <span aria-hidden="true" className={styles.longformActionDivider}>·</span>
          <button className={styles.longformSecondaryAction} onClick={download} type="button">
            {incomplete ? "下载已有部分" : "下载 .md"}
          </button>
          {!incomplete ? (
            <>
              <span aria-hidden="true" className={styles.longformActionDivider}>·</span>
              <button className={styles.longformSecondaryAction} onClick={print} type="button">导出 PDF</button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LabTextPart({ text, status }: TextMessagePartProps) {
  const isStreaming = status.type === "running";
  const continuationPrefix = useAuiState((state) => {
    const part = state.message.parts.find((candidate) => (
      candidate.type === "data" && candidate.name === "lumi-continuation"
    ));
    const data = part?.type === "data" && part.data && typeof part.data === "object"
      ? part.data as { instantPrefix?: unknown; seamOffset?: unknown; attempt?: unknown }
      : undefined;
    return typeof data?.instantPrefix === "string" ? data.instantPrefix : "";
  });
  const continuationSeamOffset = useAuiState((state) => {
    const part = state.message.parts.find((candidate) => (
      candidate.type === "data" && candidate.name === "lumi-continuation"
    ));
    const data = part?.type === "data" && part.data && typeof part.data === "object"
      ? part.data as { seamOffset?: unknown }
      : undefined;
    return typeof data?.seamOffset === "number" ? data.seamOffset : 0;
  });
  const visibleText = useSmoothStream(
    text,
    isStreaming,
    undefined,
    continuationSeamOffset > 0 ? continuationPrefix : undefined,
  );
  const incompleteReason = useAuiState((state) => partialResponseReason(
    state.message.parts as readonly { type: string; name?: string; data?: unknown }[],
  ));
  const hasSeam = continuationSeamOffset > 0 && visibleText.length > continuationSeamOffset;
  const incomplete = status.type === "incomplete" || Boolean(incompleteReason);
  return (
    <LabLongform
      incomplete={incomplete}
      isStreaming={isStreaming}
      reason={incompleteReason}
      text={visibleText}
    >
      {!hasSeam ? <LabMarkdownResponse isStreaming={isStreaming} text={visibleText} /> : (
        <div className={styles.markdownContinuation}>
          <LabMarkdownResponse
            className={styles.markdownSegment}
            isStreaming={isStreaming}
            text={visibleText.slice(0, continuationSeamOffset)}
          />
          <span
            aria-label="从这里继续生成"
            className={styles.continuationSeam}
            data-active={hasSeam || undefined}
          />
          <LabMarkdownResponse
            className={styles.markdownSegment}
            isStreaming={isStreaming}
            text={visibleText.slice(continuationSeamOffset)}
          />
        </div>
      )}
    </LabLongform>
  );
}

function LabReasoningPart({ text, status }: ReasoningMessagePartProps) {
  const running = status.type === "running";
  return (
    <p
      aria-live={running ? "polite" : undefined}
      className={styles.reasoningTranscript}
      data-running={running}
    >
      {text}
    </p>
  );
}

function LabSourcePart(props: SourceMessagePartProps) {
  if (props.sourceType === "document") {
    return (
      <div
        aria-label={`课程来源：${props.title}`}
        className={styles.sourcePart}
        data-source-type="document"
        title={props.title}
      >
        <FileTextIcon aria-hidden="true" size={15} />
        <span className={styles.sourceTitle}>{props.title}</span>
        <small>课程资料</small>
      </div>
    );
  }

  const sourceTitle = props.title ?? getSourceHostname(props.url);
  return (
    <a
      aria-label={`打开外部来源：${sourceTitle}`}
      className={styles.sourcePart}
      data-source-type="url"
      href={props.url}
      rel="noreferrer"
      target="_blank"
      title={sourceTitle}
    >
      <FileTextIcon aria-hidden="true" size={15} />
      <span className={styles.sourceTitle}>{sourceTitle}</span>
      <small>{getSourceHostname(props.url)}</small>
      <ExternalLinkIcon aria-hidden="true" size={14} />
    </a>
  );
}

function LabToolPart({
  args,
  isError,
  result,
  status,
  timing,
  toolName,
}: ToolCallMessagePartProps) {
  const running = status.type === "running" && result === undefined;
  const state: ToolVisualState = isError
    ? "error"
    : status.type === "requires-action"
      ? "pending"
      : status.type === "incomplete"
        ? status.reason === "cancelled" ? "cancelled" : "error"
        : running
          ? "running"
          : "complete";
  const displayName = getToolDisplayName(toolName);
  const argsSummary = summarizeToolArgs(args);
  const liveElapsed = useToolCallElapsed();
  const elapsed = formatElapsedTime(
    liveElapsed ??
    (timing?.completedAt === undefined ? undefined : timing.completedAt - timing.startedAt),
  );
  const elementState = state === "running"
    ? "input-available" as const
    : state === "pending"
      ? "approval-requested" as const
      : state === "error"
        ? "output-error" as const
        : state === "cancelled"
          ? "output-denied" as const
          : "output-available" as const;
  const resultSummary = summarizeToolResult(toolName, result, args);

  return (
    <Tool
      className={styles.toolPart}
      data-state={state}
      defaultOpen={running || isError}
    >
      <ToolHeader
        className={styles.toolElementHeader}
        state={elementState}
        statusLabel={[
          getToolStateLabel(state),
          elapsed,
        ].filter(Boolean).join(" · ")}
        title={running ? `正在${getToolActionLabel(toolName)}` : displayName}
        toolName={toolName}
        type="dynamic-tool"
      />
      <ToolContent className={styles.toolElementContent}>
        {argsSummary ? (
          <div>
            <span>请求</span>
            <p>{argsSummary}</p>
          </div>
        ) : null}
        <div>
          <span>结果</span>
          <p>{resultSummary ?? (running ? "正在获取结果" : getToolStateLabel(state))}</p>
        </div>
      </ToolContent>
    </Tool>
  );
}

function LabKnowledgeSearchTool({
  args,
  isError,
  result,
  status,
}: ToolCallMessagePartProps<ToolRecord, unknown>) {
  const output = asToolRecord(result);
  const retrieval = asToolRecord(output.retrieval);
  const items = Array.isArray(output.items)
    ? output.items.map(asToolRecord)
    : [];
  const running = status.type === "running" && result === undefined;
  const state: ToolVisualState = isError ? "error" : running ? "running" : "complete";
  const strategy = getRetrievalStrategyLabel(readToolString(retrieval, "strategy"));
  const elapsed = formatElapsedTime(useToolCallElapsed());

  return (
    <details
      className={styles.knowledgeTool}
      data-state={state}
      open={running || isError || undefined}
    >
      <summary className={styles.toolCardSummary}>
        <div>
          <SearchIcon aria-hidden="true" size={17} />
          <div>
            <strong className={running ? styles.shimmerText : undefined}>
              {running ? "正在检索课程知识库" : "课程知识库"}
            </strong>
            <span>只读取当前课程包中的可追溯内容</span>
          </div>
        </div>
        <span className={styles.toolSummaryMeta}>
          {elapsed ? <time>{elapsed}</time> : null}
          <span className={styles.toolStatus} data-state={state}>
            <ToolStateIcon size={14} state={state} />
            {running ? "检索中" : isError ? "检索失败" : `${items.length} 条依据`}
          </span>
          <ChevronDownIcon aria-hidden="true" size={15} />
        </span>
      </summary>
      <div className={styles.toolCardBody}>
        <div className={styles.toolQuery}>
          <span>检索问题</span>
          <p>{readToolString(args, "query") ?? "课程概念"}</p>
        </div>
        {items.length > 0 ? (
          <div className={styles.knowledgeResults}>
            {items.map((item, index) => {
              const facts = readToolStringList(item, "facts");
              const scope = readToolString(item, "scope");
              const authority = getKnowledgeAuthorityLabel(readToolString(item, "authority"));
              const verifiedDate = readToolString(item, "verifiedDate");
              return (
                <article key={readToolString(item, "id") ?? `${index}`}>
                  <span className={styles.knowledgeResultIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{readToolString(item, "title") ?? "课程依据"}</strong>
                    <p>{facts[0] ?? scope ?? "已命中当前课程包中的相关条目。"}</p>
                    {authority || scope || verifiedDate ? (
                      <div className={styles.knowledgeResultMeta}>
                        {authority ? <span>{authority}</span> : null}
                        {scope ? <span>{scope}</span> : null}
                        {verifiedDate ? <time dateTime={verifiedDate}>{verifiedDate}</time> : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : !running && !isError ? (
          <p className={styles.toolEmpty}>当前课程包没有命中可追溯条目。</p>
        ) : null}
        {!running && strategy ? (
          <footer>检索方式：{strategy}</footer>
        ) : null}
      </div>
    </details>
  );
}

const FIVE_DIMENSIONS = [
  ["01", "目标", "传达对象、使用场景与要解决的问题"],
  ["02", "创意转译", "抽象意图如何变成可见、可感的关系"],
  ["03", "构成与层级", "观看入口、阅读顺序与信息权重"],
  ["04", "形式语言", "字体、色彩、图形与质感是否同向"],
  ["05", "工艺与规范", "尺寸、媒介、输出与交付条件"],
] as const;

function LabFiveDimensionTool(props: ToolCallMessagePartProps<ToolRecord, unknown>) {
  const resultStatus = readToolString(asToolRecord(props.result), "status");
  const state: ToolVisualState = props.isError
    ? "error"
    : props.status.type === "running" && props.result === undefined
      ? "running"
      : resultStatus === "EXECUTED"
        ? "complete"
        : resultStatus === "REJECTED"
          ? "cancelled"
          : "pending";
  const elapsed = formatElapsedTime(useToolCallElapsed());
  const expanded = state === "running" || state === "pending" || state === "error";
  return (
    <details
      className={styles.diagnosisTool}
      data-state={state}
      open={expanded || undefined}
    >
      <summary className={styles.toolCardSummary}>
        <div>
          <ClipboardListIcon aria-hidden="true" size={18} />
          <div>
            <strong className={state === "running" ? styles.shimmerText : undefined}>
              {state === "running" ? "正在准备五维会诊" : "五维会诊"}
            </strong>
            <span>基于当前可见材料逐项确认</span>
          </div>
        </div>
        <span className={styles.toolSummaryMeta}>
          {elapsed ? <time>{elapsed}</time> : null}
          <span className={styles.toolStatus} data-state={state}>
            <ToolStateIcon size={14} state={state} />
            {getToolStateLabel(state)}
          </span>
          <ChevronDownIcon aria-hidden="true" size={15} />
        </span>
      </summary>
      <div className={styles.toolCardBody}>
        <ol className={styles.dimensionList}>
          {FIVE_DIMENSIONS.map(([number, label, description]) => (
            <li key={number}>
              <span>{number}</span>
              <div><strong>{label}</strong><p>{description}</p></div>
            </li>
          ))}
        </ol>
        <div className={styles.diagnosisClosure}>
          <strong>本轮收束</strong>
          <p>确认哪里已经成立，并只选择下一处最影响目标的修改。收束横跨五维，不作为第六维。</p>
        </div>
        {props.isError ? (
          <p className={styles.toolInlineError} role="alert">会诊操作未能载入，请稍后重试。</p>
        ) : (
          <LabApprovalControls {...props} approveLabel="开始会诊" />
        )}
      </div>
    </details>
  );
}

function LabConfirmActionTool(props: ToolCallMessagePartProps<ToolRecord, unknown>) {
  const label = readToolString(props.args, "label") ?? "继续这一步";
  const description = readToolString(props.args, "description");
  const actionType = readToolString(props.args, "type")?.toLowerCase().replaceAll("_", "-");
  const resultStatus = readToolString(asToolRecord(props.result), "status");
  const state: ToolVisualState = props.isError
    ? "error"
    : props.status.type === "running" && props.result === undefined
      ? "running"
      : resultStatus === "EXECUTED"
        ? "complete"
        : resultStatus === "REJECTED"
          ? "cancelled"
          : "pending";
  return (
    <PlanTool
      className={styles.planToolAdapter}
      plan={{
        id: actionType,
        title: label,
        summary: description,
      }}
      state={state === "running" ? "pending" : "idle"}
      actions={props.isError ? (
        <span className={styles.planInlineError} role="alert">计划未能载入</span>
      ) : (
        <LabApprovalControls
          {...props}
          approveLabel="按这个计划继续"
          rejectLabel="我想调整"
          variant="plan"
        />
      )}
    />
  );
}

type ApprovalResponse = {
  action?: {
    status?: "EXECUTED" | "REJECTED";
    navigation?: { target: string; focus: string | null } | null;
  };
};

function LabApprovalControls({
  args,
  approveLabel,
  rejectLabel = "暂不进行",
  result,
  variant = "default",
}: ToolCallMessagePartProps<ToolRecord, unknown> & {
  approveLabel: string;
  rejectLabel?: string;
  variant?: "default" | "plan";
}) {
  const resultStatus = readToolString(asToolRecord(result), "status");
  const [state, setState] = useState<"idle" | "pending" | "approved" | "rejected" | "error">(
    resultStatus === "EXECUTED" ? "approved" : resultStatus === "REJECTED" ? "rejected" : "idle",
  );
  const [message, setMessage] = useState("");

  const decide = async (decision: "APPROVE" | "REJECT") => {
    const runId = readToolString(args, "runId");
    const actionId = readToolString(args, "actionId");
    if (!runId || !actionId) {
      setState("error");
      setMessage("这条旧记录缺少运行标识，无法继续执行。");
      return;
    }
    setState("pending");
    setMessage("");
    try {
      const response = await fetch(
        `/api/agent/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(actionId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, idempotencyKey: crypto.randomUUID() }),
        },
      );
      const payload = await response.json() as ApprovalResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "操作未完成");
      const approved = payload.action?.status === "EXECUTED";
      setState(approved ? "approved" : "rejected");
      setMessage(approved
        ? payload.action?.navigation
          ? `已确认，目标：${payload.action.navigation.target}`
          : "已确认。"
        : "已取消这一步。");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "操作未完成");
    }
  };

  if (state === "approved" || state === "rejected") {
    return (
      <div
        aria-live="polite"
        className={styles.approvalResult}
        data-state={state}
        data-variant={variant}
      >
        {state === "approved" ? (
          <CircleCheckIcon aria-hidden="true" size={16} />
        ) : (
          <XIcon aria-hidden="true" size={16} />
        )}
        <span>{message || (state === "approved" ? "已确认。" : "已取消这一步。")}</span>
      </div>
    );
  }

  return (
    <div className={styles.approvalControls} data-variant={variant}>
      <button disabled={state === "pending"} onClick={() => void decide("REJECT")} type="button">{rejectLabel}</button>
      <button disabled={state === "pending"} onClick={() => void decide("APPROVE")} type="button">
        {state === "pending" ? "处理中…" : approveLabel}
      </button>
      {state === "error" ? <p role="alert">{message}</p> : null}
    </div>
  );
}

function LabExecutionProgressPart({
  data,
}: DataMessagePartProps<LumiExecutionProgressData>) {
  const progress = data as unknown as LumiExecutionProgressData;
  const items: LumiExecutionProgressData["items"] = Array.isArray(progress.items)
    ? progress.items
    : [];
  if (items.length === 0) return null;
  const streaming = progress.state === "streaming";
  const todos: TodoItem[] = items.map((item) => ({
    content: item.label,
    status: item.status === "completed"
      ? "completed"
      : item.status === "failed"
        ? "failed"
        : "pending",
  }));
  return (
    <TodoTool
      className={styles.todoToolAdapter}
      state={streaming ? "streaming" : "idle"}
      todos={todos}
    />
  );
}

type PartialResponseReason = "MODEL_TIMEOUT" | "MODEL_CONNECTION_INTERRUPTED" | "MODEL_OUTPUT_TRUNCATED" | "CANCELLED";

type LumiResponseData = {
  eyebrow?: string;
  title?: string;
  whyThisStep?: string;
  uncertainty?: string;
  basis?: string[];
  incomplete?: {
    reason?: PartialResponseReason;
  };
  routingReceipt?: {
    schema?: "specialty-route-receipt/v1";
    coursePackId?: "general-design" | "digital-interaction" | "book-design";
    coursePackVersion?: "1";
    reason?: "GENERAL_DEFAULT" | "MESSAGE_MATCH" | "INTERFACE_CONTEXT" | "STUDENT_DECLARED";
  };
};

function partialResponseReason(parts: readonly { type: string; name?: string; data?: unknown }[]) {
  const response = parts.find((part) => part.type === "data" && part.name === "lumi-response");
  return (response?.data as LumiResponseData | undefined)?.incomplete?.reason;
}

function LabPartialAnswerNotice() {
  const reason = useAuiState((state) => {
    const parts = state.message.parts as readonly {
      type: string;
      name?: string;
      data?: unknown;
      text?: unknown;
    }[];
    return partialResponseReason(parts);
  });
  const hasText = useAuiState((state) => {
    const parts = state.message.parts as readonly {
      type: string;
      name?: string;
      data?: unknown;
      text?: unknown;
    }[];
    return parts.some((part) => part.type === "text" && typeof part.text === "string" && part.text.length > 0);
  });
  if (!reason || hasText) return null;
  return <LabPartialAnswerCallout reason={reason} />;
}

function LabPartialAnswerCallout({
  actionClassName = styles.partialContinueActions,
  buttonClassName = styles.partialContinueButton,
  className = styles.partialAnswerNotice,
  reason,
}: {
  actionClassName?: string;
  buttonClassName?: string;
  className?: string;
  reason?: PartialResponseReason;
}) {
  const description = reason === "MODEL_TIMEOUT"
    ? "模型响应超时；已保留已写正文。"
    : reason === "CANCELLED"
      ? "已停止；已保留已写正文。"
      : reason === "MODEL_OUTPUT_TRUNCATED"
        ? "本次输出达到长度上限；已保留已写正文。"
        : "模型连接中断；已保留已写正文。";
  return (
    <div aria-live="polite" className={className} role="status">
      <div>
        <strong>回答未完成</strong>
        <span>{description}</span>
      </div>
      <ActionBarPrimitive.Root autohide="never" className={actionClassName}>
        <ActionBarPrimitive.Reload asChild>
          <button className={buttonClassName} type="button">继续生成</button>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </div>
  );
}

function LabResponseDataPart({ data }: DataMessagePartProps<LumiResponseData>) {
  // The structured payload remains available to the runtime and to the
  // incomplete-answer notice, but ordinary answers no longer carry a noisy
  // “why/uncertainty/capability” footer.
  if (
    process.env.NODE_ENV === "production"
    || process.env.NEXT_PUBLIC_E2E_HARNESS_RECEIPT !== "true"
    || data.routingReceipt?.schema !== "specialty-route-receipt/v1"
    || !data.routingReceipt.coursePackId
    || !data.routingReceipt.reason
  ) return null;
  return (
    <output aria-label="Lumi 路由回执" className={styles.routingReceipt}>
      <strong>本地路由回执</strong>
      <code>{data.routingReceipt.coursePackId}@{data.routingReceipt.coursePackVersion}</code>
      <span>{data.routingReceipt.reason}</span>
    </output>
  );
}

function CapabilityChecklist({
  items = [],
  title = "可继续操作",
}: {
  items?: string[];
  title?: string;
}) {
  const [checked, setChecked] = useState<boolean[]>(() => items.map(() => false));
  return (
    <section className={styles.generatedCard}>
      <header>
        <strong>{title}</strong>
        <span>Generative UI</span>
      </header>
      {items.map((item, index) => (
        <label key={item}>
          <input
            checked={checked[index] ?? false}
            onChange={() =>
              setChecked((current) =>
                current.map((value, itemIndex) =>
                  itemIndex === index ? !value : value,
                ),
              )
            }
            type="checkbox"
          />
          <span>{item}</span>
        </label>
      ))}
    </section>
  );
}

function LabMessageError() {
  const retainsPartialAnswer = useAuiState((state) => Boolean(partialResponseReason(
    state.message.parts as readonly { type: string; name?: string; data?: unknown }[],
  )));
  if (retainsPartialAnswer) return null;
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className={styles.messageError}>
        <CircleAlertIcon aria-hidden="true" size={17} />
        <div>
          <strong>生成未完成</strong>
          <ErrorPrimitive.Message />
        </div>
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
}

function LabAssistantActions() {
  const canRetry = useAuiState((state) => state.message.status?.type === "incomplete");
  return (
    <ActionBarPrimitive.Root
      autohide="never"
      className={styles.actionBar}
      hideWhenRunning
    >
      <ActionBarPrimitive.Copy asChild>
        <LabCopyButton />
      </ActionBarPrimitive.Copy>
      {canRetry ? (
        <ActionBarPrimitive.Reload asChild>
          <LabIconButton label="继续生成">
            <RefreshCwIcon aria-hidden="true" size={15} />
          </LabIconButton>
        </ActionBarPrimitive.Reload>
      ) : null}
      <AuiIf condition={(state) => state.message.speech == null}>
        <ActionBarPrimitive.Speak asChild>
          <LabIconButton label="朗读">
            <Volume2Icon aria-hidden="true" size={15} />
          </LabIconButton>
        </ActionBarPrimitive.Speak>
      </AuiIf>
      <AuiIf condition={(state) => state.message.speech != null}>
        <ActionBarPrimitive.StopSpeaking asChild>
          <LabIconButton label="停止朗读">
            <VolumeXIcon aria-hidden="true" size={15} />
          </LabIconButton>
        </ActionBarPrimitive.StopSpeaking>
      </AuiIf>
      <ActionBarPrimitive.FeedbackPositive asChild>
        <LabIconButton label="有帮助">
          <ThumbsUpIcon aria-hidden="true" size={15} />
        </LabIconButton>
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative asChild>
        <LabIconButton label="没帮助">
          <ThumbsDownIcon aria-hidden="true" size={15} />
        </LabIconButton>
      </ActionBarPrimitive.FeedbackNegative>
      <ActionBarPrimitive.ExportMarkdown asChild>
        <LabIconButton label="导出 Markdown">
          <DownloadIcon aria-hidden="true" size={15} />
        </LabIconButton>
      </ActionBarPrimitive.ExportMarkdown>
    </ActionBarPrimitive.Root>
  );
}

function LabCopyButton({ ...props }: React.ComponentPropsWithoutRef<"button">) {
  const copied = useAuiState((state) => state.message.isCopied);
  return (
    <LabIconButton label={copied ? "已复制" : "复制"} {...props}>
      {copied ? (
        <CheckIcon aria-hidden="true" size={15} />
      ) : (
        <CopyIcon aria-hidden="true" size={15} />
      )}
    </LabIconButton>
  );
}

function LabIconButton({
  children,
  label,
  ...props
}: PropsWithChildren<
  React.ComponentPropsWithoutRef<"button"> & { label: string }
>) {
  return (
    <button
      aria-label={label}
      className={styles.iconButton}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

function LabFollowupSuggestions() {
  const isVisible = useAuiState((state) =>
    state.message.isLast
    && !state.thread.isEmpty
    && !state.thread.isRunning
  );
  const suggestionCount = useAuiState(
    (state) => state.thread.suggestions.length,
  );
  if (!isVisible) return null;

  return (
    <section aria-label="建议的后续操作" className={styles.followups}>
      {suggestionCount > 0 ? (
        <ThreadPrimitive.Suggestions>
          {() => (
            <SuggestionPrimitive.Trigger send asChild>
              <button type="button">
                <span><SuggestionPrimitive.Title /></span>
                <ExternalLinkIcon aria-hidden="true" size={14} />
              </button>
            </SuggestionPrimitive.Trigger>
          )}
        </ThreadPrimitive.Suggestions>
      ) : (
        fallbackFollowupSuggestions.map((suggestion) => (
          <ThreadPrimitive.Suggestion
            asChild
            key={suggestion.label}
            prompt={suggestion.prompt}
            send
          >
            <button type="button">
              <span>{suggestion.label}</span>
              <ExternalLinkIcon aria-hidden="true" size={14} />
            </button>
          </ThreadPrimitive.Suggestion>
        ))
      )}
    </section>
  );
}

function threadMessageRunId(message: ThreadMessage) {
  const custom = message.metadata?.custom as { runId?: unknown } | undefined;
  return typeof custom?.runId === "string" ? custom.runId : undefined;
}

function LabComposer() {
  const aui = useAui();
  const isEmpty = useAuiState((state) => state.thread.isEmpty);
  const draft = useAuiState((state) => state.composer.text);
  const threadRunning = useAuiState((state) => state.thread.isRunning);
  const taskId = useAuiState((state) => state.threadListItem.remoteId);
  const historyRunId = useAuiState((state) => (
    [...state.thread.messages]
      .reverse()
      .map(threadMessageRunId)
      .find((runId): runId is string => Boolean(runId))
  ));
  const hasAttachments = useAuiState((state) => state.composer.attachments.length > 0);
  const incompleteAssistantId = useAuiState((state) => (
    [...state.thread.messages]
      .reverse()
      .find((message) => message.role === "assistant" && message.status.type === "incomplete")
      ?.id ?? null
  ));
  const { clear, select, selected } = useComposerCapability();
  const [isActive, setIsActive] = useState(false);
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [extensionPlacement, setExtensionPlacement] = useState<"above" | "below">("below");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [interventionDraftState, setInterventionDraftState] = useState<{
    taskId?: string;
    value: string;
  }>({ taskId, value: "" });
  const interventions = useAssistantLabInterventions({
    taskId,
    historyRunId,
    threadRunning,
  });
  const interventionDraft = interventionDraftState.taskId === taskId
    ? interventionDraftState.value
    : "";
  const setInterventionDraft = (value: string) => {
    setInterventionDraftState({ taskId, value });
  };
  const visibleExtensionsOpen =
    extensionsOpen && !interventions.canIntervene;
  const prefersReducedMotion = useReducedMotion();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const extensionPanelRef = useRef<HTMLDivElement>(null);
  const hasDraft = (
    interventions.canIntervene ? interventionDraft : draft
  ).trim().length > 0;
  const showPlaceholder = !hasDraft && !isActive;
  const canRotatePlaceholder = showPlaceholder && prefersReducedMotion !== true;
  const selectedCapabilityItem = selected
    ? composerCapabilityItem(selected.id)
    : undefined;
  const SelectedCapabilityIcon = selectedCapabilityItem?.icon;

  useEffect(() => {
    if (!canRotatePlaceholder) return;

    const timer = window.setInterval(() => {
      setPlaceholderIndex((current) => (current + 1) % composerPlaceholders.length);
    }, 3600);

    return () => window.clearInterval(timer);
  }, [canRotatePlaceholder]);

  useEffect(() => {
    if (!visibleExtensionsOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node | null)) {
        setExtensionsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [visibleExtensionsOpen]);

  useEffect(() => {
    if (!visibleExtensionsOpen) return;

    const updateExtensionPlacement = () => {
      const shell = shellRef.current;
      if (!shell) return;

      const shellRect = shell.getBoundingClientRect();
      const panelHeight =
        extensionPanelRef.current?.getBoundingClientRect().height ??
        Math.min(320, Math.max(220, window.innerHeight * 0.58));
      const gap = 12;
      const availableBelow = window.innerHeight - shellRect.bottom - gap;
      const nextPlacement = availableBelow >= panelHeight ? "below" : "above";

      setExtensionPlacement((current) =>
        current === nextPlacement ? current : nextPlacement,
      );
    };

    const frame = window.requestAnimationFrame(updateExtensionPlacement);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateExtensionPlacement);
    if (shellRef.current) resizeObserver?.observe(shellRef.current);
    if (extensionPanelRef.current) resizeObserver?.observe(extensionPanelRef.current);
    window.addEventListener("resize", updateExtensionPlacement);
    window.addEventListener("scroll", updateExtensionPlacement, true);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateExtensionPlacement);
      window.removeEventListener("scroll", updateExtensionPlacement, true);
    };
  }, [visibleExtensionsOpen]);

  const toggleExtensions = () => {
    if (extensionsOpen) {
      setExtensionsOpen(false);
      return;
    }

    const shellRect = shellRef.current?.getBoundingClientRect();
    const panelHeight = Math.min(320, Math.max(220, window.innerHeight * 0.58));
    const availableBelow = shellRect
      ? window.innerHeight - shellRect.bottom - 12
      : 0;
    setExtensionPlacement(availableBelow >= panelHeight ? "below" : "above");
    setExtensionsOpen(true);
  };

  const continueIncompleteAnswer = (event: FormEvent<HTMLFormElement>) => {
    if (!incompleteAssistantId || hasAttachments || !isContinuationIntent(draft)) return;
    event.preventDefault();
    clear();
    aui.threads().thread("main").composer().setText("");
    aui.threads().thread("main").message({ id: incompleteAssistantId }).reload();
  };

  const submitIntervention = async (mode: "FOLLOW_UP" | "STEER") => {
    const accepted = await interventions.submit(interventionDraft, mode);
    if (accepted) setInterventionDraft("");
  };

  return (
    <ComposerPrimitive.Root className={styles.composer} onSubmit={continueIncompleteAnswer}>
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          className={styles.composerShell}
          data-active={isActive || hasDraft}
          data-compact={!isActive && !hasDraft}
          data-draft={hasDraft}
          data-empty={isEmpty}
          data-extension-open={visibleExtensionsOpen}
          data-extension-placement={extensionPlacement}
          data-intervening={interventions.canIntervene}
          ref={shellRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setIsActive(false);
            }
          }}
          onDragOverCapture={(event) => {
            if (!interventions.canIntervene) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onDropCapture={(event) => {
            if (!interventions.canIntervene) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onFocus={() => setIsActive(true)}
        >
          {visibleExtensionsOpen ? (
            <div
              aria-label="扩展能力面板"
              className={styles.composerExtensionPanel}
              ref={extensionPanelRef}
              role="menu"
            >
              <div className={styles.composerExtensionHeader}>
                <strong>扩展能力</strong>
                <span>为下一条消息添加处理方式</span>
              </div>
              {composerExtensionGroups.map((group) => (
                <section className={styles.composerExtensionGroup} key={group.label}>
                  <h2>{group.label}</h2>
                  <div className={styles.composerExtensionItems}>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isSelected = Boolean(
                        item.capabilityId && item.capabilityId === selected?.id,
                      );
                      const itemContent = (
                        <>
                          <span className={styles.composerExtensionIcon}>
                            <Icon aria-hidden="true" size={17} />
                          </span>
                          <span className={styles.composerExtensionMeta}>
                            <strong>{item.label}</strong>
                            <small>{item.description}</small>
                          </span>
                          {isSelected ? (
                            <span className={styles.composerExtensionStatus} data-selected="true">
                              <CheckIcon aria-hidden="true" size={12} />
                              已选择
                            </span>
                          ) : item.kind === "unavailable" ? (
                            <span className={styles.composerExtensionStatus}>
                              {item.statusLabel ?? "后续"}
                            </span>
                          ) : null}
                        </>
                      );

                      if (item.kind === "attachment") {
                        return (
                          <ComposerPrimitive.AddAttachment asChild key={item.id}>
                            <button
                              className={styles.composerExtensionItem}
                              onClick={() => setExtensionsOpen(false)}
                              role="menuitem"
                              type="button"
                            >
                              {itemContent}
                            </button>
                          </ComposerPrimitive.AddAttachment>
                        );
                      }

                      if (item.kind === "capability" && item.capabilityId) {
                        return (
                          <button
                            className={styles.composerExtensionItem}
                            data-selected={isSelected}
                            key={item.id}
                            onClick={() => {
                              select(item.capabilityId!);
                              setExtensionsOpen(false);
                              setIsActive(true);
                              window.requestAnimationFrame(() => inputRef.current?.focus());
                            }}
                            role="menuitem"
                            type="button"
                          >
                            {itemContent}
                          </button>
                        );
                      }

                      return (
                        <button
                          aria-disabled="true"
                          className={styles.composerExtensionItem}
                          disabled
                          key={item.id}
                          role="menuitem"
                          type="button"
                        >
                          {itemContent}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
          {interventions.items.length > 0 ? (
            <section
              aria-label="后续消息队列"
              aria-live="polite"
              className={styles.queueList}
            >
              {interventions.items.map((intervention) => (
                <div
                  className={styles.queueItem}
                  data-status={intervention.status}
                  key={intervention.id}
                >
                  <span className={styles.queueMode}>
                    {intervention.requestedMode === "STEER" ? "改方向" : "下一轮"}
                  </span>
                  <span className={styles.queueMessage}>
                    {intervention.content}
                  </span>
                  <span className={styles.queueStatus}>
                    {assistantLabInterventionStatusLabel(intervention)}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
          <div className={styles.composerAttachments}>
            <ComposerPrimitive.Attachments>
              {() => <LabAttachment removable />}
            </ComposerPrimitive.Attachments>
          </div>
          <div className={styles.composerInputRow}>
            <LabIconButton
              aria-expanded={visibleExtensionsOpen}
              aria-haspopup="menu"
              className={`${styles.iconButton} ${styles.extensionToggle}`}
              disabled={interventions.canIntervene}
              label="打开扩展能力面板"
              onClick={toggleExtensions}
              title={interventions.canIntervene
                ? "本轮结束后可添加作品"
                : "打开扩展能力面板"}
            >
              <PlusIcon aria-hidden="true" size={19} />
            </LabIconButton>
            {!interventions.canIntervene
            && selectedCapabilityItem
            && SelectedCapabilityIcon ? (
              <button
                aria-label={`移除${selectedCapabilityItem.label}`}
                className={styles.composerCapabilityChip}
                onClick={clear}
                title="仅作用于下一条消息；点击移除"
                type="button"
              >
                <SelectedCapabilityIcon aria-hidden="true" size={14} />
                <span>{selectedCapabilityItem.label}</span>
                <XIcon aria-hidden="true" size={12} />
              </button>
            ) : null}
            <div className={styles.composerTextField}>
              {interventions.canIntervene ? (
                <textarea
                  aria-label="给 Lumi 发送消息"
                  enterKeyHint="send"
                  maxLength={2_000}
                  onChange={(event) => setInterventionDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key !== "Enter"
                      || event.shiftKey
                      || event.nativeEvent.isComposing
                    ) {
                      return;
                    }
                    event.preventDefault();
                    void submitIntervention("FOLLOW_UP");
                  }}
                  placeholder=" "
                  ref={inputRef}
                  rows={1}
                  value={interventionDraft}
                />
              ) : (
                <ComposerPrimitive.Input
                  aria-label="给 Lumi 发送消息"
                  enterKeyHint="send"
                  maxRows={hasDraft ? undefined : 1}
                  placeholder=" "
                  ref={inputRef}
                  rows={1}
                  unstable_focusOnScrollToBottom={false}
                  unstable_focusOnThreadSwitched={false}
                />
              )}
              <div aria-hidden="true" className={styles.composerPlaceholder}>
                {interventions.canIntervene ? (
                  showPlaceholder ? (
                    <span className={styles.composerPlaceholderText}>
                      运行中可补充文字，Enter 将追加到下一轮
                    </span>
                  ) : null
                ) : prefersReducedMotion ? (
                  showPlaceholder ? (
                    <span className={styles.composerPlaceholderText}>
                      {composerPlaceholders[0]}
                    </span>
                  ) : null
                ) : (
                  <AnimatePresence initial={false} mode="wait">
                    {showPlaceholder ? (
                      <motion.span
                        animate="animate"
                        className={styles.composerPlaceholderText}
                        exit="exit"
                        initial="initial"
                        key={placeholderIndex}
                        variants={composerPlaceholderContainerVariants}
                      >
                        {Array.from(composerPlaceholders[placeholderIndex]).map(
                          (character, index) => (
                            <motion.span
                              className={styles.composerPlaceholderLetter}
                              key={`${character}-${index}`}
                              variants={composerPlaceholderLetterVariants}
                            >
                              {character === " " ? "\u00a0" : character}
                            </motion.span>
                          ),
                        )}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                )}
              </div>
            </div>
            <div className={styles.composerActions}>
              {interventions.canIntervene ? (
                <LabIconButton
                  disabled
                  label="语音输入"
                  title="本轮结束后可使用语音"
                >
                  <MicIcon aria-hidden="true" size={17} />
                </LabIconButton>
              ) : (
                <>
                  <AuiIf condition={(state) => state.composer.dictation == null}>
                    <ComposerPrimitive.Dictate asChild>
                      <LabIconButton label="语音输入">
                        <MicIcon aria-hidden="true" size={17} />
                      </LabIconButton>
                    </ComposerPrimitive.Dictate>
                  </AuiIf>
                  <AuiIf condition={(state) => state.composer.dictation != null}>
                    <ComposerPrimitive.StopDictation asChild>
                      <LabIconButton label="停止语音输入">
                        <SquareIcon aria-hidden="true" size={14} />
                      </LabIconButton>
                    </ComposerPrimitive.StopDictation>
                  </AuiIf>
                </>
              )}
            </div>
            <AuiIf condition={(state) => (
              !state.thread.isRunning && !interventions.canIntervene
            )}>
              <ComposerPrimitive.Send asChild>
                <button
                  aria-label="发送消息"
                  className={styles.sendButton}
                  title="发送消息"
                  type="submit"
                >
                  <ArrowUpIcon aria-hidden="true" size={19} strokeWidth={1.8} />
                </button>
              </ComposerPrimitive.Send>
            </AuiIf>
            <AuiIf condition={(state) => state.thread.isRunning}>
              <ComposerPrimitive.Cancel asChild>
                <button
                  aria-label="停止生成"
                  className={`${styles.sendButton} ${styles.stopButton}`}
                  title="停止生成"
                  type="button"
                >
                  <span aria-hidden="true" className={styles.stopArrowGhost}>
                    <ArrowUpIcon size={19} strokeWidth={1.8} />
                  </span>
                  <span aria-hidden="true" className={styles.stopMorph} />
                </button>
              </ComposerPrimitive.Cancel>
            </AuiIf>
          </div>
          {interventions.canIntervene ? (
            <div className={styles.interventionControls}>
              <p className={styles.interventionHint}>
                当前运行中：文字会先保存到服务器；作品与语音将在本轮结束后恢复。
              </p>
              <div className={styles.interventionActions}>
                <button
                  className={styles.interventionButton}
                  disabled={interventions.busy || !interventionDraft.trim()}
                  onClick={() => void submitIntervention("STEER")}
                  type="button"
                >
                  改变当前方向
                </button>
                <button
                  className={styles.interventionButton}
                  disabled={interventions.busy || !interventionDraft.trim()}
                  onClick={() => void submitIntervention("FOLLOW_UP")}
                  type="button"
                >
                  追加到下一轮
                </button>
              </div>
            </div>
          ) : null}
          {interventions.error ? (
            <p className={styles.interventionError} role="alert">
              {interventions.error}
            </p>
          ) : null}
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
}

function LabAttachment({ removable = false }: { removable?: boolean }) {
  const type = useAuiState((state) => state.attachment.type);
  const name = useAuiState((state) => state.attachment.name);
  const status = useAuiState((state) => state.attachment.status.type);
  const file = useAuiState((state) => state.attachment.file);
  const content = useAuiState((state) => state.attachment.content);
  const [localPreview, setLocalPreview] = useState<{
    file: File;
    url: string;
  } | null>(null);
  const localPreviewUrl =
    localPreview && localPreview.file === file ? localPreview.url : null;
  const contentPreviewUrl = content?.find((part) => part.type === "image")?.image;
  const previewUrl = type === "image" ? localPreviewUrl ?? contentPreviewUrl : null;
  const fileSizeLabel = file?.size === undefined
    ? type === "image" ? "图片" : "文件"
    : file.size < 1024
      ? `${file.size} B`
      : file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

  useEffect(() => {
    if (type !== "image" || !file) return;

    const nextPreviewUrl = URL.createObjectURL(file);
    const animationFrame = window.requestAnimationFrame(() => {
      setLocalPreview({ file, url: nextPreviewUrl });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [file, type]);

  if (removable) {
    return (
      <AttachmentPrimitive.Root
        className={styles.composerAttachmentChip}
        data-image={type === "image"}
        data-status={status}
      >
        <div className={styles.attachmentChipVisual}>
          {type === "image" && previewUrl ? (
            // The URL is a browser-created object URL or attachment data URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" src={previewUrl} />
          ) : (
            <FileTextIcon aria-hidden="true" size={16} />
          )}
        </div>
        <div className={styles.attachmentChipMeta}>
          <span className={styles.attachmentChipName}>
            <AttachmentPrimitive.Name />
          </span>
          <small>{status === "running" ? "正在导入" : fileSizeLabel}</small>
        </div>
        {status === "running" ? (
          <LoaderCircleIcon
            aria-label="正在处理附件"
            className={`${styles.attachmentChipLoading} ${styles.spin}`}
            size={14}
          />
        ) : null}
        <AttachmentPrimitive.Remove asChild>
          <button
            aria-label={`移除附件 ${name}`}
            className={styles.attachmentChipRemove}
            title="移除附件"
            type="button"
          >
            <XIcon aria-hidden="true" size={12} />
          </button>
        </AttachmentPrimitive.Remove>
      </AttachmentPrimitive.Root>
    );
  }

  return (
    <AttachmentPrimitive.Root
      className={`${styles.composerAttachmentChip} ${styles.messageAttachmentChip}`}
      data-image={type === "image"}
      data-status={status}
    >
      <div className={styles.attachmentChipVisual}>
        {type === "image" && previewUrl ? (
          // The URL is a browser-created object URL or attachment data URL.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" src={previewUrl} />
        ) : type === "image" ? (
          <ImageIcon aria-hidden="true" size={16} />
        ) : (
          <FileTextIcon aria-hidden="true" size={16} />
        )}
      </div>
      <div className={styles.attachmentChipMeta}>
        <span className={styles.attachmentChipName}>
          <AttachmentPrimitive.Name />
        </span>
        <small>{status === "running" ? "正在导入" : fileSizeLabel}</small>
      </div>
      {status === "running" ? (
        <LoaderCircleIcon
          aria-label="正在处理附件"
          className={`${styles.attachmentChipLoading} ${styles.spin}`}
          size={14}
        />
      ) : null}
      {removable ? (
        <AttachmentPrimitive.Remove asChild>
          <button aria-label="移除附件" title="移除附件" type="button">
            <XIcon aria-hidden="true" size={14} />
          </button>
        </AttachmentPrimitive.Remove>
      ) : (
        null
      )}
    </AttachmentPrimitive.Root>
  );
}

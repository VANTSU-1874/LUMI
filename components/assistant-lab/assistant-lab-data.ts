export const LAB_DATA_EVENT = "lumi:assistant-ui-lab:data";
import type { AgentRequestedCapabilityId } from "@/lib/agent/requested-capability";

export const LAB_ACTIVE_PROJECT_KEY = "lumi:assistant-ui-lab:active-project:v1";

const OUTPUTS_KEY = "lumi:assistant-ui-lab:outputs:v1";
const PROJECTS_KEY = "lumi:assistant-ui-lab:projects:v1";
const ACCOUNT_KEY = "lumi:assistant-ui-lab:account:v1";
const SETTINGS_KEY = "lumi:assistant-ui-lab:settings:v1";

export type LabOutput = {
  id: string;
  kind: "image" | "file";
  name: string;
  mimeType: string;
  createdAt: string;
  sourceTitle: string;
  previewUrl?: string;
  content?: string;
};

export type LabProject = {
  id: string;
  name: string;
  createdAt: string;
};

export type LabPlugin = {
  id: string;
  name: string;
  description: string;
  kind: "plugin" | "skill";
  status: "AVAILABLE" | "AUTHORIZATION_REQUIRED";
  capabilityId?: AgentRequestedCapabilityId;
  authorizationUrl?: string;
};

export type LabAccount = {
  isSignedIn: boolean;
  name: string;
  plan: string;
  avatarUrl?: string;
};

export type LabSettings = {
  theme: "system" | "light";
  language: "zh-CN" | "en";
  desktopNotifications: boolean;
  emailNotifications: boolean;
  responseStyle: "professional" | "concise" | "exploratory";
  warmth: "reduced" | "balanced" | "enhanced";
  enthusiasm: "reduced" | "balanced" | "enhanced";
  headingsAndLists: "reduced" | "balanced" | "enhanced";
  emoji: "reduced" | "balanced" | "enhanced";
  quickAnswers: boolean;
  suggestedPrompts: boolean;
  customInstructions: string;
  voice: "lumi" | "calm" | "bright";
  autoplayVoice: boolean;
  saferResponses: boolean;
};

export const DEFAULT_LAB_ACCOUNT: LabAccount = {
  isSignedIn: true,
  name: "ArloTang",
  plan: "Pro",
};

export const DEFAULT_LAB_SETTINGS: LabSettings = {
  theme: "system",
  language: "zh-CN",
  desktopNotifications: true,
  emailNotifications: false,
  responseStyle: "professional",
  warmth: "reduced",
  enthusiasm: "reduced",
  headingsAndLists: "reduced",
  emoji: "reduced",
  quickAnswers: true,
  suggestedPrompts: true,
  customInstructions: "",
  voice: "lumi",
  autoplayVoice: false,
  saferResponses: true,
};

export const LAB_PLUGIN_CATALOG = [
  {
    id: "course-reference",
    name: "课程资料检索",
    description: "从当前课程包检索可追溯概念、案例、制作步骤与依据。",
    kind: "skill",
    status: "AVAILABLE",
    capabilityId: "course-reference",
  },
  {
    id: "book-design",
    name: "书籍设计 Skill",
    description: "读取书籍项目状态、信息编排、装帧与印前规范。",
    kind: "skill",
    status: "AVAILABLE",
    capabilityId: "book-design",
  },
  {
    id: "design-calculation",
    name: "设计计算",
    description: "计算比例、尺寸、色彩、纸张与视频参数。",
    kind: "skill",
    status: "AVAILABLE",
    capabilityId: "design-calculation",
  },
  {
    id: "process-record",
    name: "项目过程记录",
    description: "读取当前项目状态、阶段记录与已验证证据。",
    kind: "skill",
    status: "AVAILABLE",
    capabilityId: "process-record",
  },
  {
    id: "evidence-troubleshooting",
    name: "证据排障",
    description: "依据项目记录定位软件故障、信号断点与证据缺口。",
    kind: "skill",
    status: "AVAILABLE",
    capabilityId: "evidence-troubleshooting",
  },
  {
    id: "public-research",
    name: "公开资料研究",
    description: "在本轮明确授权后检索公开网页并返回可核对出处。",
    kind: "skill",
    status: "AVAILABLE",
    capabilityId: "public-research",
  },
  {
    id: "skill-installer",
    name: "Skill 安装",
    description: "检查 Skill 来源、安全边界、风险等级与安装方案。",
    kind: "skill",
    status: "AVAILABLE",
    capabilityId: "skill-installer",
  },
  {
    id: "skill-creator",
    name: "Skill 创建",
    description: "把教学或创作流程整理成可复用、可验证的 Skill。",
    kind: "skill",
    status: "AVAILABLE",
    capabilityId: "skill-creator",
  },
  {
    id: "touchdesigner-cases",
    name: "TouchDesigner 案例库",
    description: "检索课程案例、节点网络、效果路径与参数关系。",
    kind: "plugin",
    status: "AVAILABLE",
    capabilityId: "touchdesigner-cases",
  },
  {
    id: "figma",
    name: "Figma",
    description: "读取设计稿、评论、变量与组件信息。",
    kind: "plugin",
    status: "AUTHORIZATION_REQUIRED",
    authorizationUrl: "https://www.figma.com/login",
  },
  {
    id: "notion",
    name: "Notion",
    description: "读取已授权的项目文档与知识库。",
    kind: "plugin",
    status: "AUTHORIZATION_REQUIRED",
    authorizationUrl: "https://www.notion.so/login",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "读取已授权的云端文件、文档与表格。",
    kind: "plugin",
    status: "AUTHORIZATION_REQUIRED",
    authorizationUrl: "https://drive.google.com/",
  },
  {
    id: "canva",
    name: "Canva",
    description: "连接设计项目、品牌与视觉资产。",
    kind: "plugin",
    status: "AUTHORIZATION_REQUIRED",
    authorizationUrl: "https://www.canva.com/login/",
  },
  {
    id: "slack",
    name: "Slack",
    description: "读取已授权的项目频道与讨论记录。",
    kind: "plugin",
    status: "AUTHORIZATION_REQUIRED",
    authorizationUrl: "https://slack.com/signin",
  },
] as const satisfies readonly LabPlugin[];

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function notify(
  section:
    | "outputs"
    | "projects"
    | "active-project"
    | "account"
    | "settings",
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LAB_DATA_EVENT, { detail: { section } }));
}

export function readLabOutputs() {
  return readJson<LabOutput[]>(OUTPUTS_KEY, []);
}

export function removeLabOutput(id: string) {
  writeJson(OUTPUTS_KEY, readLabOutputs().filter((item) => item.id !== id));
  notify("outputs");
}

export function recordLabOutputsForPrompt(prompt: string) {
  const asksForImage =
    /(生成|制作|输出|导出).{0,10}(图片|图像|海报|视觉稿|效果图)|(?:图片|图像|海报).{0,8}(生成|制作|输出)/i.test(prompt);
  const asksForFile =
    /(生成|制作|输出|导出).{0,10}(文件|文档|报告|方案|markdown|pdf|docx|ppt)|(?:文件|文档|报告).{0,8}(生成|制作|输出|导出)/i.test(prompt);
  if (!asksForImage && !asksForFile) return [];

  const createdAt = new Date().toISOString();
  const stamp = createdAt.slice(0, 19).replace(/[T:]/g, "-");
  const sourceTitle = prompt.trim().slice(0, 48) || "Lumi 对话输出";
  const next: LabOutput[] = [];

  if (asksForImage) {
    next.push({
      id: makeId("image"),
      kind: "image",
      name: `Lumi-视觉输出-${stamp}.png`,
      mimeType: "image/png",
      createdAt,
      sourceTitle,
      previewUrl: "/media/lumi-demo-interface.png",
    });
  }

  if (asksForFile) {
    next.push({
      id: makeId("file"),
      kind: "file",
      name: `Lumi-设计方案-${stamp}.md`,
      mimeType: "text/markdown",
      createdAt,
      sourceTitle,
      content: `# Lumi 设计方案\n\n来源请求：${sourceTitle}\n\n## 当前结论\n\n- 明确设计目标与使用场景\n- 检查构成、层级和形式语言\n- 记录下一处可验证的修改\n`,
    });
  }

  writeJson(OUTPUTS_KEY, [...next, ...readLabOutputs()].slice(0, 60));
  notify("outputs");
  return next;
}

export function readLabProjects() {
  return readJson<LabProject[]>(PROJECTS_KEY, []);
}

export function createLabProject(name: string) {
  const project: LabProject = {
    id: makeId("project"),
    name: name.trim(),
    createdAt: new Date().toISOString(),
  };
  writeJson(PROJECTS_KEY, [project, ...readLabProjects()]);
  notify("projects");
  return project;
}

export function removeLabProject(id: string) {
  writeJson(PROJECTS_KEY, readLabProjects().filter((item) => item.id !== id));
  if (readActiveLabProjectId() === id) setActiveLabProjectId(null);
  notify("projects");
}

export function readActiveLabProjectId() {
  if (!canUseStorage()) return null;
  return window.localStorage.getItem(LAB_ACTIVE_PROJECT_KEY);
}

export function setActiveLabProjectId(id: string | null) {
  if (!canUseStorage()) return;
  if (id) window.localStorage.setItem(LAB_ACTIVE_PROJECT_KEY, id);
  else window.localStorage.removeItem(LAB_ACTIVE_PROJECT_KEY);
  notify("active-project");
}

export function readLabPlugins(): LabPlugin[] {
  return LAB_PLUGIN_CATALOG.map((plugin) => ({ ...plugin }));
}

export function readLabAccount() {
  return { ...DEFAULT_LAB_ACCOUNT, ...readJson<Partial<LabAccount>>(ACCOUNT_KEY, {}) };
}

export function setLabAccount(account: LabAccount) {
  writeJson(ACCOUNT_KEY, account);
  notify("account");
}

export function readLabSettings() {
  return { ...DEFAULT_LAB_SETTINGS, ...readJson<Partial<LabSettings>>(SETTINGS_KEY, {}) };
}

export function updateLabSettings(patch: Partial<LabSettings>) {
  const settings = { ...readLabSettings(), ...patch };
  writeJson(SETTINGS_KEY, settings);
  notify("settings");
  return settings;
}

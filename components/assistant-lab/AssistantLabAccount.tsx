"use client";

import {
  AudioLinesIcon,
  BellIcon,
  ChartNoAxesColumnIncreasingIcon,
  CircleHelpIcon,
  CircleUserRoundIcon,
  CreditCardIcon,
  DatabaseIcon,
  HardDriveIcon,
  KeyRoundIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isLumiAccountRole } from "@/lib/auth/account-model";
import { authClient } from "@/lib/auth/better-auth-client";
import {
  StudentOnboardingProfileSchema,
  type StudentOnboardingProfile,
} from "@/lib/domain/student-onboarding";

import {
  LAB_DATA_EVENT,
  type LabAccount,
  type LabSettings,
  readLabSettings,
  updateLabSettings,
} from "./assistant-lab-data";
import { StudentMemorySettings } from "./StudentMemorySettings";
import { StudentOnboardingSettings } from "./StudentOnboardingSettings";
import styles from "./assistant-lab.module.css";

type LabSettingsSection =
  | "general"
  | "notifications"
  | "personalization"
  | "voice"
  | "billing"
  | "usage"
  | "data"
  | "storage"
  | "safety"
  | "security"
  | "account";

type LabAccountAreaProps = {
  navigate?: (href: string) => void;
};

type UnifiedSessionUser = {
  id: string;
  role: "STUDENT" | "TEACHER";
  name?: string;
  alias?: string;
};

function defaultNavigation(href: string) {
  window.location.assign(href);
}

export function labLoginHrefFor(pathname: string, search = "") {
  return `/login?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;
}

const settingsSections: Array<{
  id: LabSettingsSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "general", label: "常规", icon: SettingsIcon },
  { id: "notifications", label: "通知", icon: BellIcon },
  { id: "personalization", label: "个性化", icon: SlidersHorizontalIcon },
  { id: "voice", label: "语音", icon: AudioLinesIcon },
  { id: "billing", label: "账单", icon: CreditCardIcon },
  { id: "usage", label: "使用情况", icon: ChartNoAxesColumnIncreasingIcon },
  { id: "data", label: "数据管理", icon: DatabaseIcon },
  { id: "storage", label: "存储空间", icon: HardDriveIcon },
  { id: "safety", label: "内容安全", icon: ShieldCheckIcon },
  { id: "security", label: "账户安全与登录", icon: KeyRoundIcon },
  { id: "account", label: "账户", icon: CircleUserRoundIcon },
];

export function LabAccountArea({ navigate = defaultNavigation }: LabAccountAreaProps) {
  const session = authClient.useSession();
  const [unifiedUser, setUnifiedUser] = useState<UnifiedSessionUser | null>(null);
  const [unifiedPending, setUnifiedPending] = useState(true);
  const [settingsSection, setSettingsSection] = useState<LabSettingsSection | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [preferredName, setPreferredName] = useState<string | null>(null);
  const user = session.data?.user;
  const role = isLumiAccountRole(user?.role) ? user.role : null;
  const effectiveRole = role ?? unifiedUser?.role ?? null;
  const account: LabAccount = {
    isSignedIn: Boolean((user && role) || unifiedUser),
    name: (effectiveRole === "STUDENT" ? preferredName : null)
      ?? user?.name
      ?? unifiedUser?.name
      ?? unifiedUser?.alias
      ?? (effectiveRole === "TEACHER" ? "课程教师" : "课程学生"),
    plan: effectiveRole === "TEACHER" ? "教师账户" : "学生账户",
    avatarUrl: user?.image ?? undefined,
  };

  useEffect(() => {
    if (session.isPending || (user && role)) return;

    const controller = new AbortController();
    void fetch("/api/account/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.json() as { user?: UnifiedSessionUser };
        return payload.user && isLumiAccountRole(payload.user.role)
          ? payload.user
          : null;
      })
      .then((nextUser) => {
        if (!controller.signal.aborted) setUnifiedUser(nextUser);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnifiedUser(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setUnifiedPending(false);
      });

    return () => controller.abort();
  }, [role, session.isPending, user]);

  useEffect(() => {
    if (effectiveRole !== "STUDENT") return;
    const controller = new AbortController();
    void fetch("/api/agent/onboarding", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const parsed = StudentOnboardingProfileSchema.safeParse(await response.json());
        return parsed.success ? parsed.data : null;
      })
      .then((profile) => {
        if (!controller.signal.aborted && profile) setPreferredName(profile.displayName);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [effectiveRole]);

  const goToLogin = () => {
    navigate(labLoginHrefFor(window.location.pathname, window.location.search));
  };

  if (session.isPending || (!(user && role) && unifiedPending)) {
    return (
      <div className={styles.sidebarFooter}>
        <div aria-label="正在确认账户" className={styles.accountTrigger}>
          <LabAvatar account={account} />
          <span className={styles.accountIdentity}>
            <strong>正在确认账户</strong>
            <small>请稍候</small>
          </span>
        </div>
      </div>
    );
  }

  if (!account.isSignedIn) {
    return (
      <div className={styles.sidebarFooter}>
        <button
          aria-label="登录 Lumi"
          className={styles.accountTrigger}
          onClick={goToLogin}
          type="button"
        >
          <LabAvatar account={account} />
          <span className={styles.accountIdentity}>
            <strong>登录 Lumi</strong>
            <small>未登录</small>
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className={styles.sidebarFooter}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                aria-label={account.isSignedIn ? "打开账户菜单" : "打开登录菜单"}
                className={styles.accountTrigger}
                type="button"
              />
            }
          >
            <LabAvatar account={account} />
            <span className={styles.accountIdentity}>
              <strong>{account.isSignedIn ? account.name : "登录 Lumi"}</strong>
              <small>{account.isSignedIn ? account.plan : "未登录"}</small>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className={styles.accountMenu}
            side="top"
            sideOffset={8}
          >
            <DropdownMenuItem
              className={styles.accountMenuHeader}
              onClick={() => setSettingsSection("account")}
            >
              <LabAvatar account={account} />
              <span className={styles.accountIdentity}>
                <strong>{account.name}</strong>
                <small>{account.plan}</small>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className={styles.menuSeparator} />
            <DropdownMenuItem
              className={styles.accountMenuItem}
              onClick={() => setSettingsSection("personalization")}
            >
              <SlidersHorizontalIcon aria-hidden="true" size={18} />
              <span>个性化</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={styles.accountMenuItem}
              onClick={() => setSettingsSection("account")}
            >
              <CircleUserRoundIcon aria-hidden="true" size={18} />
              <span>个人资料</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={styles.accountMenuItem}
              onClick={() => setSettingsSection("general")}
            >
              <SettingsIcon aria-hidden="true" size={18} />
              <span>设置</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className={styles.menuSeparator} />
            <DropdownMenuItem
              className={styles.accountMenuItem}
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelpIcon aria-hidden="true" size={18} />
              <span>帮助</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={styles.accountMenuItem}
              onClick={() => setLogoutOpen(true)}
            >
              <LogOutIcon aria-hidden="true" size={18} />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <LabSettingsDialog
        account={account}
        isStudent={effectiveRole === "STUDENT"}
        onOnboardingSaved={(profile) => setPreferredName(profile.displayName)}
        onOpenChange={(open) => {
          if (!open) setSettingsSection(null);
        }}
        onSectionChange={setSettingsSection}
        section={settingsSection}
      />

      <LabCompactDialog
        description="Lumi 会围绕你的课程、作品和历史对话继续提供设计支持。遇到账号或班级问题时，请联系课程教师。"
        onOpenChange={setHelpOpen}
        open={helpOpen}
        title="Lumi 帮助"
      />

      <Dialog onOpenChange={setLogoutOpen} open={logoutOpen}>
        <DialogContent className={styles.compactDialog} showCloseButton={false}>
          <DialogTitle className={styles.compactDialogTitle}>退出当前账户？</DialogTitle>
          <DialogDescription className={styles.compactDialogDescription}>
            退出后需要重新输入邮箱和密码。已经保存的课程、作品与对话不会被删除。
          </DialogDescription>
          <div className={styles.compactDialogActions}>
            <button onClick={() => setLogoutOpen(false)} type="button">取消</button>
            <button
              className={styles.dangerButton}
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                await Promise.allSettled([
                  authClient.signOut(),
                  fetch("/api/account/logout", {
                    method: "POST",
                    credentials: "same-origin",
                  }),
                ]);
                setLogoutOpen(false);
                navigate("/login");
              }}
              type="button"
            >
              {signingOut ? "正在退出…" : "退出登录"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LabAvatar({ account }: { account: LabAccount }) {
  return (
    <span
      aria-hidden="true"
      className={styles.accountAvatar}
      data-has-image={Boolean(account.isSignedIn && account.avatarUrl)}
      data-signed-in={account.isSignedIn}
      style={account.isSignedIn && account.avatarUrl
        ? { backgroundImage: `url(${account.avatarUrl})` }
        : undefined}
    >
      {account.isSignedIn ? <UserRoundIcon size={17} /> : "L"}
    </span>
  );
}

function LabSettingsDialog({
  account,
  isStudent,
  onOnboardingSaved,
  onOpenChange,
  onSectionChange,
  section,
}: {
  account: LabAccount;
  isStudent: boolean;
  onOnboardingSaved: (profile: StudentOnboardingProfile) => void;
  onOpenChange: (open: boolean) => void;
  onSectionChange: (section: LabSettingsSection) => void;
  section: LabSettingsSection | null;
}) {
  const [settings, setSettings] = useState<LabSettings>(() => readLabSettings());

  useEffect(() => {
    const refresh = () => setSettings(readLabSettings());
    window.addEventListener(LAB_DATA_EVENT, refresh);
    return () => window.removeEventListener(LAB_DATA_EVENT, refresh);
  }, []);

  const update = (patch: Partial<LabSettings>) => {
    setSettings(updateLabSettings(patch));
  };
  const activeSection = section ?? "general";
  const activeLabel = settingsSections.find((item) => item.id === activeSection)?.label ?? "设置";

  return (
    <Dialog onOpenChange={onOpenChange} open={section !== null}>
      <DialogContent className={styles.settingsDialog} showCloseButton={false}>
        <div className={styles.settingsShell}>
          <aside className={styles.settingsNavigation}>
            <button
              aria-label="关闭设置"
              className={styles.settingsCloseButton}
              onClick={() => onOpenChange(false)}
              title="关闭"
              type="button"
            >
              <XIcon aria-hidden="true" size={20} />
            </button>
            <nav aria-label="设置栏目">
              {settingsSections.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    aria-current={activeSection === item.id ? "page" : undefined}
                    key={item.id}
                    onClick={() => onSectionChange(item.id)}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
          <section className={styles.settingsContent}>
            <header className={styles.settingsHeader}>
              <DialogTitle className={styles.settingsTitle}>{activeLabel}</DialogTitle>
              <button
                aria-label="关闭设置"
                className={styles.settingsMobileClose}
                onClick={() => onOpenChange(false)}
                title="关闭"
                type="button"
              >
                <XIcon aria-hidden="true" size={20} />
              </button>
            </header>
            <DialogDescription className="sr-only">
              调整 Lumi 的账户、界面和个性化选项。
            </DialogDescription>
            <div className={styles.settingsBody}>
              <LabSettingsSectionContent
                account={account}
                isStudent={isStudent}
                onOnboardingSaved={onOnboardingSaved}
                onSettingsChange={update}
                section={activeSection}
                settings={settings}
              />
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LabSettingsSectionContent({
  account,
  isStudent,
  onOnboardingSaved,
  onSettingsChange,
  section,
  settings,
}: {
  account: LabAccount;
  isStudent: boolean;
  onOnboardingSaved: (profile: StudentOnboardingProfile) => void;
  onSettingsChange: (patch: Partial<LabSettings>) => void;
  section: LabSettingsSection;
  settings: LabSettings;
}) {
  if (section === "general") {
    return (
      <div className={styles.settingsRows}>
        <SettingSelectRow
          description="跟随系统或保持浅色界面。"
          label="外观"
          onChange={(value) => onSettingsChange({ theme: value as LabSettings["theme"] })}
          options={[{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }]}
          value={settings.theme}
        />
        <SettingSelectRow
          description="控制界面和辅助说明使用的语言。"
          label="语言"
          onChange={(value) => onSettingsChange({ language: value as LabSettings["language"] })}
          options={[{ value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" }]}
          value={settings.language}
        />
      </div>
    );
  }

  if (section === "notifications") {
    return (
      <div className={styles.settingsRows}>
        <SettingToggleRow checked={settings.desktopNotifications} description="Lumi 完成长任务时在本机提醒。" label="桌面通知" onChange={(checked) => onSettingsChange({ desktopNotifications: checked })} />
        <SettingToggleRow checked={settings.emailNotifications} description="正式账户接入后用于接收重要通知。" label="邮件通知" onChange={(checked) => onSettingsChange({ emailNotifications: checked })} />
      </div>
    );
  }

  if (section === "personalization") {
    return (
      <div className={styles.settingsRows}>
        <SettingSelectRow
          description="设置 Lumi 回应你的基本风格和语调。"
          label="基本风格和语调"
          onChange={(value) => onSettingsChange({ responseStyle: value as LabSettings["responseStyle"] })}
          options={[
            { value: "professional", label: "专业可靠" },
            { value: "concise", label: "直接简洁" },
            { value: "exploratory", label: "启发探索" },
          ]}
          value={settings.responseStyle}
        />
        <div className={styles.settingsSubheading}>
          <strong>特征</strong>
          <span>在基本风格和语调的基础上选择额外的自定义项。</span>
        </div>
        <SettingSelectRow compact label="温和体贴" onChange={(value) => onSettingsChange({ warmth: value as LabSettings["warmth"] })} options={toneOptions} value={settings.warmth} />
        <SettingSelectRow compact label="热情洋溢" onChange={(value) => onSettingsChange({ enthusiasm: value as LabSettings["enthusiasm"] })} options={toneOptions} value={settings.enthusiasm} />
        <SettingSelectRow compact label="标题和列表" onChange={(value) => onSettingsChange({ headingsAndLists: value as LabSettings["headingsAndLists"] })} options={toneOptions} value={settings.headingsAndLists} />
        <SettingSelectRow compact label="表情符号" onChange={(value) => onSettingsChange({ emoji: value as LabSettings["emoji"] })} options={toneOptions} value={settings.emoji} />
        <SettingToggleRow checked={settings.quickAnswers} description="在适合的场景先给出清晰、简短的直接回答。" label="快速回答" onChange={(checked) => onSettingsChange({ quickAnswers: checked })} />
        <SettingToggleRow checked={settings.suggestedPrompts} description="根据当前设计项目生成可继续追问的建议。" label="建议提示词" onChange={(checked) => onSettingsChange({ suggestedPrompts: checked })} />
        <label className={styles.instructionsField}>
          <span>自定义指令</span>
          <textarea
            onChange={(event) => onSettingsChange({ customInstructions: event.currentTarget.value })}
            placeholder="补充你的工作习惯、偏好和长期要求"
            rows={5}
            value={settings.customInstructions}
          />
        </label>
        {isStudent ? (
          <>
            <SettingsSummary
              detail="昵称、专业、自评和兴趣都可修改或清空；自评只作为软提示，不会覆盖五维诊断档案。"
              title="学习偏好与入门资料"
            />
            <StudentOnboardingSettings onSaved={onOnboardingSaved} />
          </>
        ) : null}
      </div>
    );
  }

  if (section === "voice") {
    return (
      <div className={styles.settingsRows}>
        <SettingSelectRow label="声音" onChange={(value) => onSettingsChange({ voice: value as LabSettings["voice"] })} options={[{ value: "lumi", label: "Lumi" }, { value: "calm", label: "沉静" }, { value: "bright", label: "明快" }]} value={settings.voice} />
        <SettingToggleRow checked={settings.autoplayVoice} description="导师回复完成后自动朗读。" label="自动播放语音" onChange={(checked) => onSettingsChange({ autoplayVoice: checked })} />
      </div>
    );
  }

  if (section === "billing") {
    return <SettingsSummary title={account.plan} detail="当前课程账号不产生单独账单。" />;
  }
  if (section === "usage") {
    return <SettingsSummary title="使用情况" detail="对话、文件库与项目由 Lumi 后端保存；界面偏好保存在本机。" />;
  }
  if (section === "data") {
    return isStudent ? (
      <div className={styles.settingsRows}>
        <SettingsSummary title="数据管理" detail="对话历史已由 Lumi 后端统一保存；长期记忆按用途分级，并向你完整开放查看。" />
        <StudentMemorySettings />
      </div>
    ) : (
      <SettingsSummary
        title="数据管理"
        detail="对话历史已由 Lumi 后端统一保存；导出与数据保留策略尚待接入。"
      />
    );
  }
  if (section === "storage") {
    return <SettingsSummary title="本机存储" detail="localStorage 仅保存界面偏好，不保存对话、文件库或项目内容。" />;
  }
  if (section === "safety") {
    return (
      <div className={styles.settingsRows}>
        <SettingToggleRow checked={settings.saferResponses} description="对不确定或高风险内容保留必要提示。" label="更安全的回答" onChange={(checked) => onSettingsChange({ saferResponses: checked })} />
      </div>
    );
  }
  if (section === "security") {
    return <SettingsSummary title="登录与安全" detail="当前账号使用 Better Auth 邮箱密码会话。退出后需要重新验证身份。" />;
  }

  return (
    <div className={styles.settingsRows}>
      <div className={styles.profileBlock}>
        <LabAvatar account={account} />
        <div>
          <strong>{account.name}</strong>
          <span>{account.plan}</span>
        </div>
      </div>
      <label className={styles.profileNameField}>
        <span>账号名称</span>
        <input
          readOnly
          value={account.name}
        />
      </label>
      <SettingsSummary title="账号类型" detail={account.plan} />
    </div>
  );
}

const toneOptions = [
  { value: "reduced", label: "减弱" },
  { value: "balanced", label: "平衡" },
  { value: "enhanced", label: "增强" },
];

function SettingSelectRow({
  compact = false,
  description,
  label,
  onChange,
  options,
  value,
}: {
  compact?: boolean;
  description?: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
}) {
  return (
    <label className={styles.settingRow} data-compact={compact}>
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <select onChange={(event) => onChange(event.currentTarget.value)} value={value}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function SettingToggleRow({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.settingRow}>
      <span>
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className={styles.settingsSwitch}>
        <input checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} type="checkbox" />
        <i aria-hidden="true" />
      </span>
    </label>
  );
}

function SettingsSummary({ detail, title }: { detail: string; title: string }) {
  return (
    <div className={styles.settingsSummary}>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function LabCompactDialog({
  description,
  onOpenChange,
  open,
  title,
}: {
  description: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className={styles.compactDialog}>
        <DialogTitle className={styles.compactDialogTitle}>{title}</DialogTitle>
        <DialogDescription className={styles.compactDialogDescription}>{description}</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

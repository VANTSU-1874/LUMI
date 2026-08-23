"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { SignInFlowShell } from "@/components/ui/sign-in-flow-1";
import { cn } from "@/components/ui/utils";
import {
  destinationForAccountRole,
  isLumiAccountRole,
  type LumiAccountRole,
} from "@/lib/auth/account-model";
import { authClient } from "@/lib/auth/better-auth-client";
import { notifySessionInvalidated } from "@/lib/auth/client-session-events";

type AuthMode = "SIGN_IN" | "SIGN_UP";

type SplitLoginEntryProps = {
  initialMode?: AuthMode;
  initialRole?: LumiAccountRole;
  navigate?: (href: string) => void;
};

const inputClassName =
  "lumi-auth-field min-h-12 w-full rounded-full border border-white/15 bg-white/[0.04] px-4 text-sm text-white outline-none backdrop-blur-[2px] transition-colors placeholder:text-white/[0.28] hover:border-white/25 focus:bg-white/[0.07] disabled:cursor-wait disabled:opacity-55";

function defaultNavigation(href: string) {
  window.location.assign(href);
}

async function clearAuthenticatedSession() {
  await Promise.allSettled([
    authClient.signOut(),
    fetch("/api/account/logout", {
      method: "POST",
      credentials: "same-origin",
    }),
  ]);
  notifySessionInvalidated();
}

function requestedReturnPath() {
  const submitted = new URLSearchParams(window.location.search).get("returnTo");
  if (
    !submitted
    || !submitted.startsWith("/")
    || submitted.startsWith("//")
    || submitted.includes("\\")
  ) {
    return null;
  }
  return submitted;
}

function destinationAfterAuth(role: LumiAccountRole) {
  const requested = requestedReturnPath();
  if (role === "STUDENT" && requested) {
    if (
      requested === "/student"
      || requested.startsWith("/student?")
      || requested === "/assistant-lab"
      || requested.startsWith("/assistant-lab?")
    ) {
      return requested;
    }
  }
  if (
    role === "TEACHER"
    && requested
    && (requested === "/teacher" || requested.startsWith("/teacher?"))
  ) {
    return requested;
  }
  return destinationForAccountRole(role);
}

function betterAuthErrorMessage(error: { code?: string; message?: string }) {
  if (
    error.code === "INVALID_EMAIL_OR_PASSWORD"
    || error.code === "INVALID_PASSWORD"
  ) {
    return "邮箱或密码不正确";
  }
  if (
    error.code === "USER_ALREADY_EXISTS"
    || error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
  ) {
    return "这个邮箱已经注册，可以直接登录";
  }
  if (error.code === "TOO_MANY_REQUESTS") {
    return "尝试次数过多，请稍后再试";
  }
  if (error.code === "INVALID_ORIGIN") {
    return "登录请求来源无效，请刷新页面后重试";
  }
  if (error.code === "FAILED_TO_CREATE_USER") {
    return "账号没有创建成功，请稍后重试；如果这个邮箱已注册，请直接返回登录";
  }
  return error.message || "暂时无法完成登录，请稍后重试";
}

async function responseError(response: Response) {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === "object" && payload !== null) {
      if ("code" in payload && typeof payload.code === "string") {
        return betterAuthErrorMessage({
          code: payload.code,
          message: "message" in payload && typeof payload.message === "string"
            ? payload.message
            : undefined,
        });
      }
      if ("error" in payload && typeof payload.error === "string") {
        return payload.error;
      }
      if ("message" in payload && typeof payload.message === "string") {
        return payload.message;
      }
    }
  } catch {
    // A non-JSON failure receives the generic user-facing message below.
  }
  return "暂时无法创建账号，请稍后重试";
}

function FlowField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="grid gap-2 text-left text-xs font-medium text-white/[0.58]">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function SplitLoginEntry({
  initialMode = "SIGN_IN",
  initialRole = "STUDENT",
  navigate = defaultNavigation,
}: SplitLoginEntryProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [role, setRole] = useState<LumiAccountRole>(
    initialMode === "SIGN_UP" ? "STUDENT" : initialRole,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const studentTabRef = useRef<HTMLButtonElement>(null);
  const teacherTabRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const isSignUp = mode === "SIGN_UP";
  const studentSelected = role === "STUDENT";
  const roleLabel = studentSelected ? "学生" : "教师";

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function switchMode(nextMode: AuthMode) {
    if (pending || nextMode === mode) return;
    setMode(nextMode);
    if (nextMode === "SIGN_UP") setRole("STUDENT");
    setError(null);
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
  }

  function chooseRole(nextRole: LumiAccountRole) {
    setRole(nextRole);
    setError(null);
  }

  function selectAndFocus(nextRole: LumiAccountRole) {
    chooseRole(nextRole);
    const target = nextRole === "STUDENT"
      ? studentTabRef.current
      : teacherTabRef.current;
    target?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextRole: LumiAccountRole | undefined;
    if (event.key === "Home") nextRole = "STUDENT";
    if (event.key === "End") nextRole = "TEACHER";
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      nextRole = studentSelected ? "TEACHER" : "STUDENT";
    }
    if (nextRole) {
      event.preventDefault();
      selectAndFocus(nextRole);
    }
  }

  async function signIn() {
    const result = await authClient.signIn.email({
      email: email.trim().toLowerCase(),
      password,
      rememberMe,
    });
    if (result.error) {
      setError(betterAuthErrorMessage(result.error));
      return;
    }

    const sessionResult = await authClient.getSession({
      query: { disableCookieCache: true },
    });
    const authenticatedRole = sessionResult.data?.user.role;
    if (!isLumiAccountRole(authenticatedRole)) {
      await clearAuthenticatedSession();
      setError("账号身份信息不完整，请联系课程教师");
      return;
    }

    if (authenticatedRole !== role) {
      await clearAuthenticatedSession();
      setError(authenticatedRole === "TEACHER"
        ? "这个邮箱是教师账号，请切换到“教师登录”"
        : "这个邮箱是学生账号，请切换到“学生登录”");
      return;
    }
    navigate(destinationAfterAuth(authenticatedRole));
  }

  async function signUp() {
    if (password !== passwordConfirmation) {
      setError("两次输入的密码不一致");
      return;
    }

    const response = await fetch("/api/account/register", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        role: "STUDENT",
        rememberMe,
      }),
    });
    if (!response.ok) {
      setError(await responseError(response));
      return;
    }

    const payload: unknown = await response.json();
    const createdRole = typeof payload === "object"
      && payload !== null
      && "user" in payload
      && typeof payload.user === "object"
      && payload.user !== null
      && "role" in payload.user
      ? payload.user.role
      : undefined;
    if (!isLumiAccountRole(createdRole)) {
      setError("账号已经创建，但身份信息读取失败，请重新登录");
      setMode("SIGN_IN");
      return;
    }
    navigate(destinationAfterAuth(createdRole));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (isSignUp) {
        await signUp();
      } else {
        await signIn();
      }
    } catch {
      setError("网络连接异常，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <SignInFlowShell mode={mode} onModeChange={switchMode}>
      <AnimatePresence initial={false} mode="wait">
        <motion.section
          aria-labelledby="login-title"
          className={cn(
            "w-full text-center",
            isSignUp ? "max-w-[32rem]" : "max-w-sm",
          )}
          key={mode}
          initial={{ opacity: 0, x: mode === "SIGN_IN" ? -80 : 80 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: mode === "SIGN_IN" ? -80 : 80 }}
          transition={{ duration: 0.38, ease: "easeOut" }}
        >
          <header className="mb-7 space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-white/[0.36]">
              {isSignUp ? "Create account" : "Welcome back"}
            </p>
            <h1
              className="text-[2.5rem] font-bold leading-[1.08] tracking-[-0.045em] text-white sm:text-[3rem]"
              id="login-title"
            >
              {isSignUp ? "创建学生账号" : `${roleLabel}端登录`}
            </h1>
            <p className="text-lg font-light text-white/[0.48] sm:text-xl">
              {isSignUp
                ? "加入课程，开始你的设计项目。"
                : `使用${roleLabel}账号进入对应工作台。`}
            </p>
          </header>

          {isSignUp ? (
            <div className="mx-auto mb-5 max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white/[0.48]">
              <strong className="block text-white/80">学生自主注册</strong>
              教师账号由课程管理员预置，已有教师账号请返回登录。
            </div>
          ) : (
            <div
              aria-label="登录身份"
              className="mx-auto mb-5 flex w-fit items-center rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-sm"
              role="tablist"
            >
            <button
              aria-controls="flow-student-entry-panel"
              aria-selected={studentSelected}
              className={cn(
                "min-h-11 whitespace-nowrap rounded-full px-5 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-55",
                studentSelected
                  ? "bg-white text-black active:bg-white/85"
                  : "text-white/50 hover:text-white active:bg-white/10 active:text-white",
              )}
              disabled={pending}
              id="flow-student-entry-tab"
              onClick={() => chooseRole("STUDENT")}
              onKeyDown={handleTabKeyDown}
              ref={studentTabRef}
              role="tab"
              tabIndex={studentSelected ? 0 : -1}
              type="button"
            >
              学生登录
            </button>
            <button
              aria-controls="flow-teacher-entry-panel"
              aria-selected={!studentSelected}
              className={cn(
                "min-h-11 whitespace-nowrap rounded-full px-5 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-55",
                !studentSelected
                  ? "bg-white text-black active:bg-white/85"
                  : "text-white/50 hover:text-white active:bg-white/10 active:text-white",
              )}
              disabled={pending}
              id="flow-teacher-entry-tab"
              onClick={() => chooseRole("TEACHER")}
              onKeyDown={handleTabKeyDown}
              ref={teacherTabRef}
              role="tab"
              tabIndex={studentSelected ? -1 : 0}
              type="button"
            >
              教师登录
            </button>
            </div>
          )}

          {!isSignUp ? (
            <p
              aria-labelledby={studentSelected
                ? "flow-student-entry-tab"
                : "flow-teacher-entry-tab"}
              className="mx-auto mb-5 max-w-sm text-sm leading-6 text-white/[0.42]"
              id={studentSelected
                ? "flow-student-entry-panel"
                : "flow-teacher-entry-panel"}
              role="tabpanel"
            >
              登录后进入{roleLabel}工作台。
            </p>
          ) : null}

          <form className="space-y-4" onSubmit={submit}>
            <div className={cn("grid gap-4", isSignUp && "sm:grid-cols-2")}>
              {isSignUp ? (
                <FlowField label="姓名或常用称呼">
                  <input
                    autoComplete="name"
                    className={inputClassName}
                    disabled={pending}
                    maxLength={50}
                    minLength={2}
                    name="name"
                    onChange={(event) => setName(event.target.value)}
                    placeholder="怎么称呼你"
                    required
                    value={name}
                  />
                </FlowField>
              ) : null}

              <FlowField label="邮箱">
                <input
                  autoComplete="email"
                  className={inputClassName}
                  disabled={pending}
                  inputMode="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  required
                  type="email"
                  value={email}
                />
              </FlowField>

              <FlowField label="密码">
                <span className="relative block">
                  <input
                    autoComplete={isSignUp ? "new-password" : "current-password"}
                    className={cn(inputClassName, "pr-12")}
                    disabled={pending}
                    maxLength={128}
                    minLength={8}
                    name="password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={isSignUp ? "至少 8 位" : "输入密码"}
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    className="absolute inset-y-0 right-3 grid w-8 place-items-center rounded-full text-white/[0.38] transition-colors hover:text-white disabled:cursor-wait"
                    disabled={pending}
                    onClick={() => setShowPassword((value) => !value)}
                    type="button"
                  >
                    {showPassword
                      ? <EyeOffIcon aria-hidden="true" size={18} />
                      : <EyeIcon aria-hidden="true" size={18} />}
                  </button>
                </span>
              </FlowField>

              {isSignUp ? (
                <FlowField label="确认密码">
                  <input
                    autoComplete="new-password"
                    className={inputClassName}
                    disabled={pending}
                    maxLength={128}
                    minLength={8}
                    name="passwordConfirmation"
                    onChange={(event) =>
                      setPasswordConfirmation(event.target.value)}
                    placeholder="再输入一次密码"
                    required
                    type={showPassword ? "text" : "password"}
                    value={passwordConfirmation}
                  />
                </FlowField>
              ) : null}
            </div>

            <label className="mx-auto flex w-fit cursor-pointer items-center gap-2.5 text-xs text-white/[0.48]">
              <input
                checked={rememberMe}
                className="h-4 w-4 accent-white"
                disabled={pending}
                onChange={(event) => setRememberMe(event.target.checked)}
                type="checkbox"
              />
              <span>在这台设备上保持登录</span>
            </label>

            {error ? (
              <p
                className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"
                ref={errorRef}
                role="alert"
                tabIndex={-1}
              >
                {error}
              </p>
            ) : null}

            <motion.button
              className="flex min-h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/[0.88] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-55"
              disabled={pending}
              type="submit"
              whileTap={pending ? undefined : { scale: 0.985 }}
            >
              {pending ? (
                <LoaderCircleIcon
                  aria-hidden="true"
                  className="animate-spin"
                  size={17}
                />
              ) : null}
              {pending
                ? isSignUp ? "正在创建账号…" : "正在登录…"
                : isSignUp ? "创建账号并进入" : `登录${roleLabel}端`}
            </motion.button>
          </form>

          <p className="mt-5 text-sm text-white/40">
            {isSignUp ? "已经有账号？" : "还没有账号？"}{" "}
            <button
              className="text-white/80 underline-offset-4 transition-colors hover:text-white hover:underline"
              disabled={pending}
              onClick={() => switchMode(isSignUp ? "SIGN_IN" : "SIGN_UP")}
              type="button"
            >
              {isSignUp ? "返回登录" : "创建账号"}
            </button>
          </p>

          <p className="mx-auto mt-8 max-w-sm text-xs leading-5 text-white/25">
            当前使用邮箱与密码登录。第三方登录和邮件找回尚未启用。
          </p>
        </motion.section>
      </AnimatePresence>
    </SignInFlowShell>
  );
}

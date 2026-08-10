import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

import styles from "./lumi-ui.module.css";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function LumiButton({
  children,
  variant = "primary",
  size = "medium",
  busy = false,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  size?: "small" | "medium" | "large";
  busy?: boolean;
}) {
  return <button
    {...props}
    aria-busy={busy || undefined}
    className={cx(styles.button, styles[`button_${variant}`], styles[`button_${size}`], className)}
    disabled={disabled || busy}
  >
    {busy ? <span aria-hidden="true" className={styles.buttonSpinner} /> : null}
    <span>{busy ? "请稍候" : children}</span>
  </button>;
}

type FieldShellProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
};

function FieldShell({ id, label, hint, error, optional, children }: FieldShellProps) {
  return <div className={styles.field}>
    <div className={styles.fieldLabelRow}>
      <label className={styles.fieldLabel} htmlFor={id}>{label}</label>
      {optional ? <span className={styles.fieldOptional}>可选</span> : null}
    </div>
    {children}
    {error ? <p className={styles.fieldError} id={`${id}-error`} role="alert">{error}</p> : null}
    {!error && hint ? <p className={styles.fieldHint} id={`${id}-hint`}>{hint}</p> : null}
  </div>;
}

export function LumiInput({
  id,
  label,
  hint,
  error,
  optional,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
}) {
  return <FieldShell error={error} hint={hint} id={id} label={label} optional={optional}>
    <input
      {...props}
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      aria-invalid={Boolean(error) || undefined}
      className={cx(styles.input, error && styles.inputError, className)}
      id={id}
    />
  </FieldShell>;
}

export function LumiTextarea({
  id,
  label,
  hint,
  error,
  optional,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
}) {
  return <FieldShell error={error} hint={hint} id={id} label={label} optional={optional}>
    <textarea
      {...props}
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      aria-invalid={Boolean(error) || undefined}
      className={cx(styles.input, styles.textarea, error && styles.inputError, className)}
      id={id}
    />
  </FieldShell>;
}

export function LumiCard({
  children,
  tone = "default",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  tone?: "default" | "quiet" | "raised";
}) {
  return <section {...props} className={cx(styles.card, styles[`card_${tone}`], className)}>{children}</section>;
}

export function LumiTag({
  children,
  accent = false,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { accent?: boolean }) {
  return <span {...props} className={cx(styles.tag, accent && styles.tagAccent, className)}>{children}</span>;
}

export function LumiNotice({
  title,
  children,
  tone = "neutral",
  className,
}: {
  title: string;
  children: ReactNode;
  tone?: "neutral" | "accent" | "error";
  className?: string;
}) {
  return <aside className={cx(styles.notice, styles[`notice_${tone}`], className)}>
    <span aria-hidden="true" className={styles.noticeMark} />
    <div>
      <strong>{title}</strong>
      <div className={styles.noticeBody}>{children}</div>
    </div>
  </aside>;
}

export function LumiLoading({ label = "正在加载…", compact = false }: { label?: string; compact?: boolean }) {
  return <div aria-live="polite" className={cx(styles.loading, compact && styles.loadingCompact)} role="status">
    <span aria-hidden="true" className={styles.loadingTrack}><span /></span>
    <span>{label}</span>
  </div>;
}

export function LumiSkeleton({ lines = 3, label = "正在载入内容" }: { lines?: number; label?: string }) {
  return <div aria-label={label} aria-live="polite" className={styles.skeleton} role="status">
    {Array.from({ length: lines }, (_, index) => <span key={index} style={{ width: `${96 - index * 13}%` }} />)}
  </div>;
}

export function LumiEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return <div className={styles.state}>
    <span aria-hidden="true" className={styles.emptyGlyph}>○</span>
    <h3>{title}</h3>
    <p>{description}</p>
    {action ? <div className={styles.stateAction}>{action}</div> : null}
  </div>;
}

export function LumiErrorState({
  title = "这一步暂时没有完成",
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return <div className={cx(styles.state, styles.errorState)} role="alert">
    <span aria-hidden="true" className={styles.errorGlyph}>!</span>
    <h3>{title}</h3>
    <p>{description}</p>
    {onRetry ? <div className={styles.stateAction}><LumiButton onClick={onRetry} size="small" variant="secondary">重试</LumiButton></div> : null}
  </div>;
}

export function LumiProgress({
  value,
  label,
  detail,
  indeterminate = false,
}: {
  value: number;
  label: string;
  detail?: string;
  indeterminate?: boolean;
}) {
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  return <div className={styles.progress}>
    <div className={styles.progressLabel}>
      <span>{label}</span>
      <span className="lumi-mixed-text">{indeterminate ? "正在进行" : `${normalized}%`}</span>
    </div>
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={indeterminate ? undefined : normalized}
      className={`${styles.progressTrack} ${indeterminate ? styles.progressTrackIndeterminate : ""}`}
      role="progressbar"
    >
      <span style={indeterminate ? undefined : { width: `${normalized}%` }} />
    </div>
    {detail ? <p>{detail}</p> : null}
  </div>;
}

"use client";

import { FormEvent, useRef, useState } from "react";

export function LumiContactDialog({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  function openDialog() {
    setCopied(false);
    dialogRef.current?.showModal();
  }

  function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setDraft(
      [
        "Lumi 鹿鸣课程演示预约",
        `称呼：${formData.get("name") || ""}`,
        `课程：${formData.get("course") || ""}`,
        `联系方式：${formData.get("contact") || ""}`,
        `想了解的内容：${formData.get("message") || ""}`,
      ].join("\n"),
    );
  }

  async function copyDraft() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft);
    setCopied(true);
  }

  return (
    <>
      <button
        className={className ?? (compact ? "lumi-f35-contact-link" : undefined)}
        id={compact ? undefined : "contact"}
        onClick={openDialog}
        type="button"
      >
        {compact ? "联系我们" : (
          <>
            <span>Contact Us</span>
            <span aria-hidden="true">↗</span>
          </>
        )}
      </button>
      <dialog
        className="lumi-f35-contact-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        ref={dialogRef}
      >
        <button
          className="lumi-f35-dialog-close"
          onClick={() => dialogRef.current?.close()}
          title="关闭"
          type="button"
          aria-label="关闭联系表单"
        >
          ×
        </button>
        <div className="lumi-f35-contact-head">
          <p className="lumi-f35-eyebrow">CONTACT US</p>
          <h2>想在你的课上试试，写信给我们</h2>
          <p>先生成一段预约内容，再粘贴到你常用的联系渠道。这里不会静默提交或保存信息。</p>
        </div>
        <form onSubmit={createDraft}>
          <label>
            <span>怎么称呼你</span>
            <input name="name" required />
          </label>
          <label>
            <span>课程名称</span>
            <input name="course" required />
          </label>
          <label>
            <span>你的联系方式</span>
            <input name="contact" required />
          </label>
          <label>
            <span>想了解什么</span>
            <textarea name="message" rows={3} required />
          </label>
          <button className="lumi-f35-form-submit" type="submit">生成预约内容</button>
        </form>
        {draft ? (
          <div className="lumi-f35-contact-draft">
            <textarea aria-label="生成的预约内容" readOnly rows={6} value={draft} />
            <button onClick={copyDraft} type="button">{copied ? "已复制" : "复制预约内容"}</button>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

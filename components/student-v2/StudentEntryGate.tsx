"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { LumiButton, LumiInput, LumiNotice } from "@/components/design-system/LumiUI";

import styles from "./student-app.module.css";

export function StudentEntryGate({
  busy,
  error,
  onEnter,
}: {
  busy: boolean;
  error: string;
  onEnter: (classCode: string, alias: string) => Promise<boolean>;
}) {
  const [classCode, setClassCode] = useState("");
  const [alias, setAlias] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onEnter(classCode, alias);
  }

  return <main className={styles.entryPage}>
    <div className={styles.entryBrand}>
      <Link aria-label="返回 Lumi 首页" href="/">Lumi <small>鹿鸣</small></Link>
      <p>DESIGN LEARNING COMPANION</p>
    </div>
    <section className={styles.entryPanel} aria-labelledby="student-entry-title">
      <div className={styles.entryCopy}>
        <p className={styles.kicker}>学生入口</p>
        <h1 className="lumi-cn-display" id="student-entry-title">带着一个还没想清楚的问题，进来就好。</h1>
        <p>使用教师发放的班级邀请码与匿名编号。Lumi 只用这些信息恢复你的课程与成长记录。</p>
        <Link className={styles.demoEntry} href="/student?demo=1">
          <span><b>先用演示学生身份体验</b><small>不需要班级码 · 所有内容明确标为演示数据</small></span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
      <form className={styles.entryForm} onSubmit={submit}>
        <LumiInput autoComplete="off" id="lumi-class-code" label="班级邀请码" maxLength={64} onChange={(event) => setClassCode(event.target.value)} placeholder="例如：LUMI-2026" required value={classCode} />
        <LumiInput autoComplete="one-time-code" hint="仅含字母、数字与短横线。" id="lumi-student-alias" label="匿名编号" maxLength={32} minLength={12} onChange={(event) => setAlias(event.target.value.toUpperCase())} pattern="[A-Za-z0-9\-]+" placeholder="例如：7K9M-2Q4R-P8TX" required value={alias} />
        {error ? <LumiNotice title="暂时无法进入" tone="error">{error}</LumiNotice> : null}
        <LumiButton busy={busy} size="large" type="submit">进入学习空间</LumiButton>
        <div className={styles.entryLinks}>
          <Link href="/privacy">隐私与学习证据说明</Link>
          <Link href="/teacher">教师入口</Link>
        </div>
      </form>
    </section>
  </main>;
}

"use client";

import ClaudeChatInput from "@/components/ui/claude-style-chat-input";

import styles from "./claude-style-chat-input-prototype.module.css";

export function ClaudeStyleChatInputPrototype() {
  return (
    <main className={styles.page}>
      <section className={styles.stage} aria-labelledby="prototype-title">
        <p className={styles.eyebrow}>21st registry · 原组件直装预览</p>
        <h1 id="prototype-title">Lumi 的对话输入原型</h1>
        <p className={styles.intro}>
          这是 Claude-style-chat-input 的原始交互外观，尚未接入 Lumi 的课程知识库、作品上传或运行记录。
        </p>
        <div className={styles.composerFrame}>
          <ClaudeChatInput onSendMessage={() => undefined} />
        </div>
        <p className={styles.disclaimer}>
          原型中的发送、模型选择和附件仅演示组件本身，不会调用 Lumi 或写入对话。
        </p>
      </section>
    </main>
  );
}

"use client";

import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  Clock3Icon,
  FileImageIcon,
  FileTextIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import styles from "./agent-elements-preview.module.css";

type Attachment = {
  id: string;
  name: string;
  size: string;
  image?: boolean;
};

const INITIAL_ATTACHMENTS: Attachment[] = [
  { id: "poster", name: "海报-第二版.png", size: "2.4 MB", image: true },
  { id: "brief", name: "项目意图.md", size: "4.1 KB" },
];

const SUGGESTIONS = [
  "点评我的设计",
  "查找课程资料",
  "下一步改哪里？",
];

export function AgentElementsPreview() {
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [attachments, setAttachments] = useState(INITIAL_ATTACHMENTS);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(true);
  const [toolGroupOpen, setToolGroupOpen] = useState(false);
  const [question, setQuestion] = useState<string | null>(null);
  const [errorVisible, setErrorVisible] = useState(true);

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  };

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroTopline}>
          <span>DEV / VISUAL BENCH</span>
          <span>21ST AGENT ELEMENTS · LUMI</span>
          <span>MOCK DATA · NO MODEL CALL</span>
        </div>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.kicker}>Agent UI components / proofing sheet 01</p>
            <h1>把状态展示出来，<em>再决定</em>要不要接入。</h1>
            <p className={styles.lede}>
              这个开发页只用于比较输入、附件、推理、检索、工具组和确认问题的视觉语言。
              组件先以本地视觉候选呈现，所有内容都是假数据，不会写入对话，也不会调用模型。
            </p>
          </div>
          <aside className={styles.heroNote}>
            <span className={styles.noteIndex}>00</span>
            <strong>当前结论</strong>
            <p>保留 assistant-ui 作运行骨架；把这里看中的零件逐个接回，而不是整套替换。</p>
          </aside>
        </div>
      </header>

      <div className={styles.legend}>
        <span><i className={styles.dotReady} />完成</span>
        <span><i className={styles.dotRunning} />进行中</span>
        <span><i className={styles.dotAccent} />可操作</span>
        <span className={styles.legendHint}>点击卡片里的控件体验状态变化</span>
      </div>

      <section className={styles.canvas} aria-label="Agent Elements 视觉展示">
        <PreviewSection
          index="01"
          title="Suggestions / Input Bar"
          description="快捷提示词与输入栏的组合；先看密度、层级和附件状态。"
        >
          <div className={styles.composerDemo}>
            <div className={styles.suggestionRow}>
              {SUGGESTIONS.map((item) => (
                <button
                  className={styles.suggestion}
                  key={item}
                  onClick={() => setDraft(item)}
                  type="button"
                >
                  <SparklesIcon aria-hidden="true" size={13} />
                  {item}
                </button>
              ))}
            </div>
            <div className={styles.inputBar} data-streaming={streaming}>
              <textarea
                aria-label="模拟提问"
                onChange={(event) => setDraft(event.currentTarget.value)}
                placeholder="问 Lumi 一个问题……"
                rows={2}
                value={draft}
              />
              <div className={styles.inputBarFooter}>
                <span className={styles.inputMeta}>
                  <PaperclipIcon aria-hidden="true" size={15} />
                  <span>{attachments.length} 个附件</span>
                </span>
                <button
                  aria-label={streaming ? "停止模拟生成" : "发送模拟消息"}
                  className={styles.sendButton}
                  onClick={() => setStreaming((current) => !current)}
                  title={streaming ? "停止" : "发送"}
                  type="button"
                >
                  {streaming ? (
                    <span className={styles.stopGlyph} aria-hidden="true" />
                  ) : (
                    <ArrowUpIcon aria-hidden="true" size={16} />
                  )}
                </button>
              </div>
            </div>
            <p className={styles.demoCaption}>
              {streaming ? "模拟流式状态：再次点击停止" : "点击上方建议词，观察输入内容如何被填入"}
            </p>
          </div>
        </PreviewSection>

        <PreviewSection
          index="02"
          title="File Attachment"
          description="图片缩略图、文件芯片、移除动作和图片预览的最小组合。"
        >
          <div className={styles.attachmentDemo}>
            <div className={styles.attachmentStage}>
              {attachments.map((attachment) => (
                <AttachmentChip
                  attachment={attachment}
                  key={attachment.id}
                  onRemove={() => removeAttachment(attachment.id)}
                />
              ))}
              {attachments.length === 0 ? (
                <button
                  className={styles.restoreButton}
                  onClick={() => setAttachments(INITIAL_ATTACHMENTS)}
                  type="button"
                >
                  恢复示例附件
                </button>
              ) : null}
            </div>
            <p className={styles.demoCaption}>悬停查看移除按钮；点击图片缩略图查看放大态（此处以静态预览代替）。</p>
          </div>
        </PreviewSection>

        <PreviewSection
          index="03"
          title="Thinking / Search"
          description="把进行中的推理和课程资料检索收成轻量、可展开的行。"
        >
          <div className={styles.stackDemo}>
            <StateRow
              icon={<LoaderCircleIcon className={styles.spin} aria-hidden="true" size={16} />}
              label="正在整理作品与意图"
              meta="进行中"
              onClick={() => setThinkingOpen((current) => !current)}
              open={thinkingOpen}
            />
            {thinkingOpen ? (
              <div className={styles.thinkingBody}>
                <p>先确认这张海报的目标与观看场景，再判断形式语言是否真的服务于目标。</p>
                <span>streaming text / collapsible content</span>
              </div>
            ) : null}

            <StateRow
              icon={<CircleCheckIcon aria-hidden="true" size={16} />}
              label="已检索课程知识库"
              meta="3 条依据"
              onClick={() => setSearchOpen((current) => !current)}
              open={searchOpen}
            />
            {searchOpen ? (
              <div className={styles.searchBody}>
                <div className={styles.searchQuery}><SearchIcon aria-hidden="true" size={14} />“目标受众与信息层级”</div>
                <article><strong>版式设计 · 信息层级</strong><span>主标题、辅助信息与行动提示需要形成明确阅读入口。</span></article>
                <article><strong>品牌与 VI · 视觉一致性</strong><span>形式语言应围绕使用场景保持同向，而不是单独追求装饰性。</span></article>
                <footer>检索策略：当前课程包优先</footer>
              </div>
            ) : null}
          </div>
        </PreviewSection>

        <PreviewSection
          index="04"
          title="Tool Group"
          description="多步执行的收束形式；展开看细节，收起不打断阅读。"
        >
          <div className={styles.toolGroupDemo}>
            <button
              aria-expanded={toolGroupOpen}
              className={styles.toolGroupHeader}
              onClick={() => setToolGroupOpen((current) => !current)}
              type="button"
            >
              <span className={styles.toolGroupStatus}><CircleCheckIcon aria-hidden="true" size={16} /></span>
              <span className={styles.toolGroupTitle}>本轮完成 3 个步骤</span>
              <span className={styles.toolGroupMeta}><Clock3Icon aria-hidden="true" size={13} /> 8.4s</span>
              <ChevronDownIcon className={toolGroupOpen ? styles.chevronOpen : ""} aria-hidden="true" size={16} />
            </button>
            {toolGroupOpen ? (
              <div className={styles.toolRows}>
                <ToolRow icon={<SearchIcon aria-hidden="true" size={14} />} label="检索课程资料" detail="3 条依据" />
                <ToolRow icon={<FileImageIcon aria-hidden="true" size={14} />} label="读取作品图像" detail="海报-第二版.png" />
                <ToolRow icon={<SparklesIcon aria-hidden="true" size={14} />} label="整理五维会诊" detail="等待你的确认" pending />
              </div>
            ) : null}
          </div>
        </PreviewSection>

        <PreviewSection
          index="05"
          title="Question / Error"
          description="确认与失败都要告诉学生下一步是什么，而不是只显示状态颜色。"
        >
          <div className={styles.questionGrid}>
            <div className={styles.questionDemo}>
              <div className={styles.questionHeader}>
                <span>澄清问题</span>
                <small>1 / 2</small>
              </div>
              <h3>这张海报主要面向谁？</h3>
              <div className={styles.optionList}>
                {["校内学生", "家长与访客", "社会公众"].map((item) => (
                  <label className={styles.option} key={item} data-selected={question === item}>
                    <input
                      checked={question === item}
                      name="audience"
                      onChange={() => setQuestion(item)}
                      type="radio"
                    />
                    <span>{item}</span>
                    {question === item ? <CheckIcon aria-hidden="true" size={14} /> : null}
                  </label>
                ))}
              </div>
              <div className={styles.questionActions}>
                <button onClick={() => setQuestion(null)} type="button">跳过</button>
                <button disabled={!question} type="button">确认选择</button>
              </div>
            </div>
            {errorVisible ? (
              <div className={styles.errorDemo} role="alert">
                <div className={styles.errorIcon}><CircleAlertIcon aria-hidden="true" size={17} /></div>
                <div>
                  <strong>生成未完成</strong>
                  <p>连接暂时中断。你的作品已经保存，可以重试这次回答。</p>
                  <button onClick={() => setErrorVisible(false)} type="button">我知道了</button>
                </div>
                <button aria-label="关闭错误提示" className={styles.dismissButton} onClick={() => setErrorVisible(false)} type="button">
                  <XIcon aria-hidden="true" size={15} />
                </button>
              </div>
            ) : (
              <button className={styles.restoreError} onClick={() => setErrorVisible(true)} type="button">恢复错误态</button>
            )}
          </div>
        </PreviewSection>
      </section>

      <footer className={styles.footer}>
        <span>仅开发预览 · 不代表最终 Lumi 视觉定稿</span>
        <span>下一步：选定零件后再接入 assistant-ui</span>
      </footer>
    </main>
  );
}

function PreviewSection({
  children,
  description,
  index,
  title,
}: {
  children: React.ReactNode;
  description: string;
  index: string;
  title: string;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <span>{index}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  return (
    <div className={styles.attachmentChip}>
      {attachment.image ? (
        <div className={styles.artworkThumb} aria-label="作品缩略图" role="img">
          <span>目标</span><i />
        </div>
      ) : (
        <div className={styles.fileIcon}><FileTextIcon aria-hidden="true" size={16} /></div>
      )}
      <div className={styles.attachmentCopy}>
        <strong title={attachment.name}>{attachment.name}</strong>
        <span>{attachment.size}</span>
      </div>
      <button aria-label={`移除 ${attachment.name}`} onClick={onRemove} type="button">
        <XIcon aria-hidden="true" size={14} />
      </button>
    </div>
  );
}

function StateRow({
  icon,
  label,
  meta,
  onClick,
  open,
}: {
  icon: React.ReactNode;
  label: string;
  meta: string;
  onClick: () => void;
  open: boolean;
}) {
  return (
    <button aria-expanded={open} className={styles.stateRow} onClick={onClick} type="button">
      <span className={styles.stateIcon}>{icon}</span>
      <span className={styles.stateLabel}>{label}</span>
      <span className={styles.stateMeta}>{meta}</span>
      <ChevronDownIcon className={open ? styles.chevronOpen : ""} aria-hidden="true" size={15} />
    </button>
  );
}

function ToolRow({
  detail,
  icon,
  label,
  pending = false,
}: {
  detail: string;
  icon: React.ReactNode;
  label: string;
  pending?: boolean;
}) {
  return (
    <div className={styles.toolRow}>
      <span className={pending ? styles.toolIconPending : styles.toolIcon}>{icon}</span>
      <strong>{label}</strong>
      <span>{detail}</span>
      {pending ? <LoaderCircleIcon className={styles.spin} aria-hidden="true" size={14} /> : <CircleCheckIcon aria-hidden="true" size={14} />}
    </div>
  );
}

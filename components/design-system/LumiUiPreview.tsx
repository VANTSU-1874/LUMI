import {
  LumiButton,
  LumiCard,
  LumiEmptyState,
  LumiErrorState,
  LumiInput,
  LumiLoading,
  LumiNotice,
  LumiProgress,
  LumiSkeleton,
  LumiTag,
  LumiTextarea,
} from "./LumiUI";
import styles from "./lumi-ui-preview.module.css";

const colors = [
  ["校样纸", "#EEEAE1", "var(--lumi-color-bg)"],
  ["纸面", "#F7F4ED", "var(--lumi-color-surface)"],
  ["墨色", "#23201C", "var(--lumi-color-ink)"],
  ["次墨", "#676158", "var(--lumi-color-ink-muted)"],
  ["细线", "#D6D0C4", "var(--lumi-color-line)"],
  ["朱砂", "#B23A2F", "var(--lumi-color-accent)"],
] as const;

function Section({ index, title, description, children }: {
  index: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return <section className={styles.section}>
    <header className={styles.sectionHeader}>
      <span>{index}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
    <div className={styles.sectionBody}>{children}</div>
  </section>;
}

export function LumiUiPreview() {
  return <main className={styles.page}>
    <header className={styles.hero}>
      <p>F2 / Design system</p>
      <h1 className="lumi-cn-display">让界面退后一步，<br />让作品站到前面。</h1>
      <div className={styles.heroMeta}>
        <span>Lumi 鹿鸣</span>
        <span>校样纸 / 墨 / 朱砂</span>
        <span>2026.07</span>
      </div>
    </header>

    <Section description="中性纸面承担空间，墨色承担信息，朱砂只标记关键动作与状态。" index="01" title="颜色与令牌">
      <div className={styles.swatches}>
        {colors.map(([name, hex, value]) => <article key={name}>
          <span className={styles.swatch} style={{ background: value }} />
          <strong>{name}</strong>
          <code>{hex}</code>
        </article>)}
      </div>
      <div className={styles.darkSample} data-lumi-theme="dark">
        <p>深色令牌只预留接口，不作为学生评图默认背景。</p>
        <div className={styles.darkActions}><LumiButton size="small">关键动作</LumiButton><LumiButton size="small" variant="secondary">次要动作</LumiButton></div>
      </div>
    </Section>

    <Section description="中文正文使用 1.78 行高；正文不加字距，标题只做轻微紧排。" index="02" title="中文排版">
      <div className={styles.typeGrid}>
        <article>
          <span>DISPLAY / 首页标题</span>
          <h3 className="lumi-cn-display">设计不是把答案<br />交给学生。</h3>
        </article>
        <article>
          <span>HEADING / 应用标题</span>
          <h3 className="lumi-cn-heading">先确认最影响目标的一处</h3>
          <p className="lumi-cn-body lumi-mixed-text">在 1920 × 1080 的屏幕上，观众从 2 m 外先看到主纹样；靠近后，TouchDesigner 让细节由模糊连续变清晰。</p>
          <small>中英混排、数字与标点使用浏览器原生中文间距规则。</small>
        </article>
      </div>
    </Section>

    <Section description="按钮状态靠层级、边框与文字表达，不再引入第二种强调色。" index="03" title="按钮与标签">
      <div className={styles.componentRows}>
        <div><LumiButton>提交作品</LumiButton><LumiButton variant="secondary">保存草稿</LumiButton><LumiButton variant="quiet">稍后再说</LumiButton></div>
        <div><LumiButton size="small">小按钮</LumiButton><LumiButton size="large">开始使用</LumiButton><LumiButton disabled>不可用</LumiButton><LumiButton busy>提交中</LumiButton></div>
        <div><LumiTag>课程资料</LumiTag><LumiTag accent>当前课程</LumiTag><LumiTag>演示数据</LumiTag></div>
      </div>
    </Section>

    <Section description="标签、提示、错误都与控件建立明确关系；焦点状态不依赖颜色之外的暗示。" index="04" title="输入控件">
      <div className={styles.formGrid}>
        <LumiInput defaultValue="LUMI-2026" hint="由任课教师提供，不区分大小写。" id="preview-class-code" label="班级邀请码" />
        <LumiInput error="匿名编号只使用字母、数字或短横线。" id="preview-alias" label="匿名编号" placeholder="例如：A-07" />
        <LumiInput disabled id="preview-course" label="当前课程" value="数字交互文创设计" />
        <LumiTextarea hint="先说目标与场景，不用急着写成完整方案。" id="preview-question" label="你现在想解决什么？" placeholder="我想让观众靠近时看见纹样细节，但不知道怎么让动作和主题发生关系……" />
      </div>
    </Section>

    <Section description="卡片只承担分组，不用大阴影和高饱和背景争夺作品注意力。" index="05" title="卡片与提示">
      <div className={styles.cardGrid}>
        <LumiCard><LumiTag>五维总览</LumiTag><h3>创意转译</h3><p>靠近与纹样显影形成了可见联系，动作不只是开关。</p></LumiCard>
        <LumiCard tone="quiet"><LumiTag>依据</LumiTag><h3>只说看得见的事实</h3><p>静态图不能证明交互时序，需要补一段连续状态录屏。</p></LumiCard>
        <LumiCard tone="raised"><LumiTag accent>重点深谈</LumiTag><h3>下一次无讲解测试</h3><p>先确认观众是否知道该靠近，再决定改提示、映射还是反馈。</p></LumiCard>
      </div>
      <div className={styles.noticeGrid}>
        <LumiNotice title="作品已上传">Lumi 正在阅读作品与本轮意图，这通常需要十几秒。</LumiNotice>
        <LumiNotice title="演示数据" tone="accent">本页内容用于界面检视，不代表真实学生或真实模型结果。</LumiNotice>
        <LumiNotice title="传输暂时中断" tone="error">运行仍在后台继续，页面会自动恢复状态，不需要重复提交。</LumiNotice>
      </div>
    </Section>

    <Section description="等待必须解释正在发生什么；空态与错误态给出下一步，不写含糊的“出错了”。" index="06" title="加载、空态与错误态">
      <div className={styles.stateGrid}>
        <LumiCard><LumiLoading label="正在理解作品与意图…" /><LumiSkeleton lines={4} /></LumiCard>
        <LumiProgress detail="上传完成后会进入作品阅读阶段，请不要重复点击。" label="正在上传作品" value={68} />
        <LumiEmptyState action={<LumiButton size="small" variant="secondary">开始第一次对话</LumiButton>} description="提问或上传作品后，本课程的对话会保存在这里。" title="还没有设计对话" />
        <LumiErrorState description="网络恢复后可以继续读取同一次运行；你的作品无需重新上传。" />
      </div>
    </Section>
  </main>;
}

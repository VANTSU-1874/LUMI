import { ArrowRight, CircleAlert, Clock3, FileCheck2, LibraryBig, UsersRound } from "lucide-react";
import Link from "next/link";

import { DemoBadge } from "@/components/common/DemoBadge";
import type { ClassAnalytics } from "@/lib/domain/teacher";

const stageLabels: Record<ClassAnalytics["stages"][number]["stage"], string> = {
  DIAGNOSTIC: "诊断",
  LOGIC_CARD: "逻辑卡",
  TOOL_PATH: "工具路径",
  BUILD: "构建",
  TROUBLESHOOT: "排障",
  TRANSFER: "迁移",
  COMPLETE: "完成",
};

function countEvidence(analytics: ClassAnalytics) {
  return analytics.evidence.byVerification.reduce((total, item) => total + item.count, 0);
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

export function TeacherDashboardOverview({
  analytics,
  reviewReady,
  governanceMaterials,
  onOpenLearner,
  onShowStudents,
}: {
  analytics: ClassAnalytics;
  reviewReady: number | null;
  governanceMaterials: number | null;
  onOpenLearner: (studentId: string) => void;
  onShowStudents: () => void;
}) {
  const included = analytics.dataCounts.included;
  const maxStage = Math.max(1, ...analytics.stages.map((item) => item.count));
  const evidenceTotal = countEvidence(analytics);
  const topIssues = analytics.logicIssues.slice(0, 5);
  const recentStudents = [...analytics.students]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 8);

  return (
    <div className="teacherWorkspaceGrid" data-ui="classroom-overview">
      <dl className="teacherMetricStrip" aria-label="课堂真实指标">
        <div className="teacherMetric"><dt>本班纳入学生</dt><dd>{included}</dd><small>真实 {analytics.dataCounts.real} 人{analytics.dataCounts.demonstration ? ` · 演示 ${analytics.dataCounts.demonstration} 人` : ""}</small></div>
        <div className="teacherMetric"><dt>需要教师支持</dt><dd>{analytics.supportNeeded}</dd><small>按现有课堂判断聚合</small></div>
        <div className="teacherMetric"><dt>课堂证据</dt><dd>{evidenceTotal}</dd><small>按当前验证状态汇总</small></div>
        <div className="teacherMetric"><dt>Wiki 教师可审</dt><dd>{reviewReady ?? "—"}</dd><small>{governanceMaterials === null ? "正在核对准备度" : `${governanceMaterials} 条治理材料`}</small></div>
      </dl>

      {analytics.dataCounts.demonstration > 0 ? (
        <div className="teacherNotice" role="status">
          <CircleAlert aria-hidden="true" size={18} />
          <p><strong><span>真实教学指标</span> / <span>演示指标</span>分开计算</strong>真实 {analytics.dataCounts.real} 人 · 演示 {analytics.dataCounts.demonstration} 人；上方“本班纳入学生”为当前开关下的合计。</p>
        </div>
      ) : null}

      <div className="teacherPanels">
        <section className="teacherPanel" aria-labelledby="class-progress-heading">
          <header className="teacherPanelHeader"><div><h2 id="class-progress-heading">{analytics.class.name}</h2><p>学习阶段分布 · 更新于 {formatUpdatedAt(analytics.updatedAt)}</p></div><button className="teacherButton" onClick={onShowStudents} type="button"><UsersRound size={15} />全部学生</button></header>
          <div className="teacherStageList">
            {analytics.stages.map((item) => (
              <div className="teacherStageRow" key={item.stage}>
                <span>{stageLabels[item.stage]}</span>
                <span className="teacherStageTrack" aria-label={`${stageLabels[item.stage]} ${item.count} 人`}><span className="teacherStageFill" style={{ width: `${(item.count / maxStage) * 100}%` }} /></span>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="teacherPanel" aria-labelledby="today-tasks-heading">
          <header className="teacherPanelHeader"><div><h2 id="today-tasks-heading">今日待办</h2><p>只列出真实可行动项</p></div></header>
          <div className="teacherTaskList">
            <div className="teacherTask"><span className="teacherTaskIndex">01</span><div><strong>需要支持的学生</strong><p>{analytics.supportNeeded ? `${analytics.supportNeeded} 人需要教师介入` : "当前没有被标记为需要支持的学生"}</p></div><span className={`teacherStatus ${analytics.supportNeeded ? "teacherStatusAttention" : ""}`}>{analytics.supportNeeded}</span></div>
            <div className="teacherTask"><span className="teacherTaskIndex">02</span><div><strong>证据复核</strong><p>{evidenceTotal ? `当前课堂共有 ${evidenceTotal} 条证据` : "当前没有课堂证据"}</p></div><FileCheck2 aria-hidden="true" size={16} /></div>
            <div className="teacherTask"><span className="teacherTaskIndex">03</span><div><strong>灵感 Wiki</strong><p>{reviewReady === null ? "正在核对严格 ReviewPack" : reviewReady === 0 ? "当前无需教师操作" : `${reviewReady} 个 ReviewPack 等待判断`}</p></div><Link aria-label="打开灵感 Wiki 私有工作区" href="/teacher/inspiration-wiki"><ArrowRight size={16} /></Link></div>
          </div>
        </section>
      </div>

      <div className="teacherPanels">
        <section className="teacherPanel" aria-labelledby="recent-students-heading">
          <header className="teacherPanelHeader"><div><h2 id="recent-students-heading">最近学生动态</h2><p>显示 API 返回的最近更新时间，不生成概念稿趋势</p></div><Clock3 aria-hidden="true" size={16} /></header>
          {recentStudents.length ? <div className="teacherTableScroll"><table className="teacherTable"><thead><tr><th>学生</th><th>阶段</th><th>状态</th><th>更新时间</th></tr></thead><tbody>{recentStudents.map((student) => <tr key={student.id}><td><button aria-label={`查看${student.alias}`} className="teacherAliasButton" onClick={() => onOpenLearner(student.id)} type="button">{student.alias}</button> {student.dataType === "DEMONSTRATION_DATA" ? <DemoBadge /> : null}</td><td>{student.stage ? stageLabels[student.stage] : "未开始"}</td><td><span className={`teacherStatus ${student.needsSupport ? "teacherStatusAttention" : ""}`}>{student.needsSupport ? "需支持" : "进行中"}</span></td><td>{formatUpdatedAt(student.updatedAt)}</td></tr>)}</tbody></table></div> : <p className="teacherEmpty">当前班级还没有学生记录。</p>}
        </section>

        <article className="teacherPanel" aria-labelledby="evidence-summary-heading">
          <header className="teacherPanelHeader"><div><h2 id="evidence-summary-heading">证据来源与验证</h2><p>当前班级聚合</p></div><FileCheck2 aria-hidden="true" size={16} /></header>
          {analytics.evidence.byVerification.length ? <div className="teacherTaskList">{analytics.evidence.byVerification.map((item, index) => <div className="teacherTask" key={item.key}><span className="teacherTaskIndex">{String(index + 1).padStart(2, "0")}</span><div><strong>{item.key}</strong><p>按当前验证状态统计</p></div><span>{item.count}</span></div>)}</div> : <p className="teacherEmpty">暂无证据</p>}
        </article>
      </div>

      {topIssues.length ? <section className="teacherPanel" aria-labelledby="logic-issues-heading"><header className="teacherPanelHeader"><div><h2 id="logic-issues-heading">常见逻辑问题</h2><p>仅显示当前 API 聚合结果</p></div></header><div className="teacherTableScroll"><table className="teacherTable"><thead><tr><th>问题</th><th>数量</th></tr></thead><tbody>{topIssues.map((item) => <tr key={item.key}><td>{item.key}</td><td>{item.count}</td></tr>)}</tbody></table></div></section> : null}
      {reviewReady === 0 && governanceMaterials !== null ? <section className="teacherPanel" aria-labelledby="wiki-readiness-summary"><header className="teacherPanelHeader"><div><h2 id="wiki-readiness-summary">灵感 Wiki 准备度</h2><p>严格 ReviewPack 与原始治理材料分开计数</p></div><LibraryBig aria-hidden="true" size={16} /></header><p className="teacherEmpty"><strong>0 / {governanceMaterials} 可审，当前无需教师操作。</strong><br />治理材料不会冒充教师审核任务。进入独立工作区查看九道准备门与来源规则。</p></section> : null}
    </div>
  );
}

export function TeacherStudentsTable({ analytics, onOpenLearner }: { analytics: ClassAnalytics; onOpenLearner: (studentId: string) => void }) {
  return <section className="teacherPanel" aria-labelledby="all-students-heading"><header className="teacherPanelHeader"><div><h2 id="all-students-heading">{analytics.class.name} · 学生与班级</h2><p>{analytics.studentsMeta.returned} / {analytics.studentsMeta.total} 名学生</p></div></header>{analytics.students.length ? <div className="teacherTableScroll"><table aria-label="班级学习者阶段与支持需求" className="teacherTable"><thead><tr><th>学生</th><th>数据类型</th><th>阶段</th><th>支持</th><th>操作</th></tr></thead><tbody>{analytics.students.map((student) => <tr key={student.id}><td>{student.alias}</td><td>{student.dataType === "DEMONSTRATION_DATA" ? <DemoBadge /> : "真实数据"}</td><td>{student.stage ? stageLabels[student.stage] : "未开始"}</td><td>{student.needsSupport ? "需要" : "否"}</td><td><button aria-label={`查看${student.alias}`} className="teacherAliasButton" onClick={() => onOpenLearner(student.id)} type="button">打开复核</button></td></tr>)}</tbody></table></div> : <p className="teacherEmpty">当前班级没有可显示的学生。</p>}</section>;
}

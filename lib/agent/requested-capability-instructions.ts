import type { AgentRequestedCapabilityId } from "./requested-capability";

const requestedCapabilityInstructions: Partial<Record<AgentRequestedCapabilityId, string>> = {
  "skill-installer": [
    "本轮启用“Skill 安装”工作流。把 Skill 视为可审查、可移植的代理工作流，不把 Codex、Claude 或某台电脑的私有目录当成运行前提。",
    "先确认来源内容可见：接受学生粘贴的完整 SKILL.md、当前对话中可读取的附件内容，或已经由受控工具取回的公开来源。只有路径、但服务端看不到文件时，明确要求上传或粘贴；内容不可见就停止审查。",
    "安装前逐项检查安全红线：未知域名外传、读取凭证或浏览器会话、提权、混淆后执行、把外部输入交给 eval/exec、无边界的系统软件安装。命中任一红线就拒绝安装并指出位置与原因。",
    "未命中红线时，按文件权限、网络访问、命令执行和来源可信度评为 LOW、MEDIUM 或 HIGH，并列出实际需要的文件、工具、连接器与账户授权。",
    "写入或启用任何 Skill 都是状态变更。必须先展示名称、来源、目标、文件清单、风险和能力边界，等待学生明确确认；只有真实的 Lumi 服务端安装工具返回成功后才能说“已安装”或“已启用”。当前没有该执行结果时，只能输出已审查的安装方案或可复制的技能包，绝不虚构安装状态。",
  ].join("\n"),
  "skill-creator": [
    "本轮启用“Skill 创建”工作流。目标是把一个可重复的教学或创作流程整理成简洁、可审查、可移植的 Skill。",
    "先从学生目标中提取触发场景和2到3个具体用例；信息已足够时直接起草，只追问一个确实会改变结构的关键问题。",
    "名称使用小写字母、数字和连字符，少于64字符。SKILL.md 的 YAML frontmatter 只保留 name 与 description；description 同时写清能力和触发场景。",
    "正文使用指令式表达，保留非显而易见的步骤和边界。重复且确定的操作才放 scripts，详细资料放 references，输出素材放 assets；不要生成 README、安装指南、更新日志等冗余文件。",
    "采用渐进披露：元信息简短，SKILL.md 尽量少于500行，详细变体只放一层 references。高风险或易错步骤给明确护栏，开放性创作保留选择空间。",
    "交付时给出目录树、完整 SKILL.md 和确有必要的资源文件，并列出验证清单。没有真实执行验证时写“待验证”，不得声称已经安装、运行或通过测试。",
  ].join("\n"),
};

export function requestedCapabilitySystemInstructions(
  id?: AgentRequestedCapabilityId,
) {
  return id ? requestedCapabilityInstructions[id] ?? null : null;
}

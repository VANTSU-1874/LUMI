import Link from "next/link";

export default function PrivacyPage() {
  return <main className="mx-auto min-h-screen max-w-3xl space-y-6 px-5 py-10">
    <header><p className="text-sm font-semibold tracking-widest text-indigo-700">Lumi 鹿鸣</p><h1 className="mt-2 text-3xl font-bold">隐私与学习证据说明</h1><p className="mt-3 text-slate-600">Lumi 鹿鸣是一名面向多类艺术设计任务的通用设计导师。本原型以匿名学习编号运行，只处理回答设计问题、推进创作和教师复核所需的最少信息。</p></header>
    <section aria-labelledby="purpose"><h2 id="purpose" className="text-xl font-bold">收集目的与收集内容</h2><p className="mt-2">收集目的仅限理解创作意图、回答设计问题、推进制作、记录由你主动提交的学习证据、提供排障建议、支持持续辅导和教师教学复核。收集内容包括匿名编号、课程回答、数值、文本、PNG/JPEG/WebP截图及你主动提交的外部视频链接。为在后续会话继续辅导，系统还可保存少量长期学习记忆，例如已掌握概念、反复卡点、学习偏好、项目事实和已纠正的误解；记忆使用匿名学习编号关联，不以姓名作为身份字段，写入前会遮蔽手机号、邮箱和学校配置的学号。</p></section>
    <section aria-labelledby="data-boundary"><h2 id="data-boundary" className="text-xl font-bold">匿名、私有与演示数据边界</h2><p className="mt-2">匿名学习数据以匿名学习编号关联，不以姓名作为身份字段；私有学习证据只向学生本人和所管理班级的授权教师提供，不进入公开页面；预置演示数据会明确标注，并在教师统计中默认排除，不作为真实课堂成效。</p></section>
    <section aria-labelledby="retention"><h2 id="retention" className="text-xl font-bold">保留期限与删除策略</h2><p className="mt-2">学习证据原则上在一个学期内保留。期末可由学生申请或自行删除，也可由任课教师按课程安排执行删除或匿名汇总；系统不会在未配置清理流程时声称已经自动删除。长期学习记忆用于跨会话辅导，在教师删除或课程执行统一清理前保留。学生可在工作台删除证据，教师可在授权范围内查看并逐条删除长期记忆和学习证据。逐条删除长期记忆后，该条目立即不再作为独立长期记忆参与后续召回；其来源的原始对话和当前任务滚动摘要属于学习过程记录，不在这次逐条删除范围内，仍按本节所述保留和申请删除流程处理。如果私有证据文件的首次清理失败，系统会在请求结束阶段重试，并在下次服务启动时扫描清理未完成的删除标记。</p></section>
    <section aria-labelledby="access"><h2 id="access" className="text-xl font-bold">教师访问</h2><p className="mt-2">任课教师只能访问所管理班级的学习证据和长期学习记忆，用于定位共性问题、复核系统判断和提供教学支持。长期记忆不会进入班级公开汇总；证据文件不放在公开目录，也不会通过公开链接访问。</p></section>
    <section aria-labelledby="ai"><h2 id="ai" className="text-xl font-bold">AI服务提供方与数据传输</h2><p className="mt-2">启用模型辅助时，系统会先遮蔽大陆手机号、邮箱和学校配置的学号，再向服务器配置的AI服务提供方发送当前问题、当前项目简报与学习状态、最多八个最近原文回合、当前任务的滚动摘要、最多四条相关长期记忆，以及回答所需的已核验证据片段、课程资料或工具结果；若本轮提交作品图且模型视觉能力已启用，还会发送该作品图。长期记忆写入语义索引时，向配置的向量服务发送的仅是本轮最多三条脱敏候选片段；后续语义召回只发送脱敏查询并在服务器本地比较已保存的向量，不会每轮向向量服务批量重发长期记忆正文。密钥只保存在服务器。模型不可用时仍保留已输入卡片和证据，继续确定性课程规则，语义审查保持待处理，绝不自动判定通过。</p></section>
    <section aria-labelledby="voice"><h2 id="voice" className="text-xl font-bold">语音输入</h2><p className="mt-2">语音输入由浏览器提供的语音识别能力完成，需要学生主动启用麦克风并授权。本系统服务器不接收或保存原始录音，只在学生检查并主动发送后接收识别出的文字；语音不会自动提交。手动发送后，识别文字与键盘输入一样，遵循上文的数据保留与AI服务传输规则。部分浏览器可能把音频发送到其语音识别服务处理，具体规则由所用浏览器决定；学生可以始终改用键盘输入。</p></section>
    <section aria-labelledby="demo"><h2 id="demo" className="text-xl font-bold">演示数据</h2><p className="mt-2">比赛预置案例会明确标注“预置演示数据”，教师分析默认排除演示数据，不与真实课堂数据混合。</p></section>
    <section aria-labelledby="video"><h2 id="video" className="text-xl font-bold">不收集人脸视频</h2><p className="mt-2">MVP不接收摄像头原始视频或人脸视频上传；如需说明动态效果，请提交不含个人信息的外部HTTPS视频链接。</p></section>
    <nav aria-label="隐私页导航"><Link className="font-semibold text-indigo-700 underline" href="/">返回入口</Link></nav>
  </main>;
}

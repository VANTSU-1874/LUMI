export const DIAGNOSTIC_DIMENSIONS = [
  "decomposition",
  "signalUnderstanding",
  "mappingDesign",
  "troubleshooting",
  "transfer",
] as const;

export type DiagnosticDimension = (typeof DIAGNOSTIC_DIMENSIONS)[number];

export type DiagnosticQuestion = {
  id: string;
  scenario: string;
  dimension: DiagnosticDimension;
  options: ReadonlyArray<{
    id: string;
    label: string;
    score: 1 | 2 | 3 | 4;
  }>;
};

const QUESTION_SET_V1: ReadonlyArray<DiagnosticQuestion> = [
  {
    id: "distance-visual-plan",
    scenario:
      "你要做一个互动投影：观众越靠近石刻图像，画面细节越清晰。动手前，你会怎样安排这件事？",
    dimension: "decomposition",
    options: [
      { id: "distance-visual-plan-a", label: "先做完整视觉效果，接入传感器后根据现场表现统一调整", score: 1 },
      { id: "distance-visual-plan-b", label: "先分别测试距离采集和画面变化，确认可用后再进行整体联调", score: 2 },
      { id: "distance-visual-plan-c", label: "先界定距离范围与画面目标，再分开验证输入、换算和输出", score: 3 },
      { id: "distance-visual-plan-d", label: "先写清动作、信号、映射与反馈，再为每一段设置验证标准", score: 4 },
    ],
  },
  {
    id: "one-shot-plan",
    scenario:
      "观众第一次走到展台前时播放一段欢迎动画，停留期间不能反复播放。你会先拆成哪些关键环节？",
    dimension: "decomposition",
    options: [
      { id: "one-shot-plan-a", label: "把检测进入和播放动画分开测试，再用固定等待时间限制重复", score: 2 },
      { id: "one-shot-plan-b", label: "拆成进入检测、播放锁定和离开复位，并分别检查基本效果", score: 3 },
      { id: "one-shot-plan-c", label: "拆成状态变化、单次锁定、离开复位，并为异常停留设计验证", score: 4 },
      { id: "one-shot-plan-d", label: "先完成感应与播放的整体流程，再根据重复现象补充限制条件", score: 1 },
    ],
  },
  {
    id: "distance-jitter-signal",
    scenario:
      "观众站着不动，距离读数却在 98、103、99、105 厘米之间跳动，画面因此闪烁。你首先会怎样理解这些读数？",
    dimension: "signalUnderstanding",
    options: [
      { id: "distance-jitter-signal-a", label: "先记录一段连续数据并取短时平均，再观察画面是否稳定", score: 3 },
      { id: "distance-jitter-signal-b", label: "先量出静止波动范围，再比较平滑、迟滞和持续时间判定", score: 4 },
      { id: "distance-jitter-signal-c", label: "先按每个新读数更新画面，再用较慢动画遮住局部闪烁", score: 1 },
      { id: "distance-jitter-signal-d", label: "先设置单一距离阈值并增加延时，再观察误触发是否减少", score: 2 },
    ],
  },
  {
    id: "entry-state-signal",
    scenario:
      "感应区每秒都报告“有人”，但欢迎动画只应在观众刚进入时触发一次。哪种判断最合适？",
    dimension: "signalUnderstanding",
    options: [
      { id: "entry-state-signal-a", label: "比较前后两次状态，只在无人变为有人时触发，离开后复位", score: 4 },
      { id: "entry-state-signal-b", label: "持续收到有人状态时按固定周期触发，并适当延长触发周期", score: 1 },
      { id: "entry-state-signal-c", label: "收到有人状态后启动冷却计时，计时结束即可再次触发", score: 2 },
      { id: "entry-state-signal-d", label: "检测到有人后锁定本次播放，连续无人一段时间后复位", score: 3 },
    ],
  },
  {
    id: "distance-visual-mapping",
    scenario:
      "传感器给出 50–300 厘米的距离，画面清晰度范围是 0–100%。为了让靠近时自然变清晰，你会怎样设计变化关系？",
    dimension: "mappingDesign",
    options: [
      { id: "distance-visual-mapping-a", label: "直接按距离比例调整清晰度，再限制超过画面范围的数值", score: 1 },
      { id: "distance-visual-mapping-b", label: "将距离反向换算到清晰度范围，并为近端远端设置边界", score: 3 },
      { id: "distance-visual-mapping-c", label: "先标定有效距离，再反向映射、限制边界并按体验调整曲线", score: 4 },
      { id: "distance-visual-mapping-d", label: "把距离分成近中远三档，对应三种清晰度并现场调整阈值", score: 2 },
    ],
  },
  {
    id: "one-shot-mapping",
    scenario:
      "欢迎动画播完后，观众仍站在感应区。怎样的规则最能保证本次停留只播放一次、下一位观众仍可触发？",
    dimension: "mappingDesign",
    options: [
      { id: "one-shot-mapping-a", label: "播放后设置较长冷却时间，冷却结束后允许下一次播放", score: 2 },
      { id: "one-shot-mapping-b", label: "从无人到有人时播放并锁定，确认离开后复位再等待下一位", score: 4 },
      { id: "one-shot-mapping-c", label: "播放后保持锁定，连续检测到无人一段时间后解除锁定", score: 3 },
      { id: "one-shot-mapping-d", label: "动画结束后立即解除播放锁定，依靠动画时长减少重复", score: 1 },
    ],
  },
  {
    id: "digishow-osc-td-break",
    scenario:
      "DigiShow 能看到距离变化，但 TouchDesigner 画面不动，中间通过 OSC 传递。你会按什么顺序查找断链位置？",
    dimension: "troubleshooting",
    options: [
      { id: "digishow-osc-td-break-a", label: "先检查接收端有无数据，再回查地址、端口和发送状态", score: 3 },
      { id: "digishow-osc-td-break-b", label: "先统一重启三个环节，再检查画面工程是否恢复响应", score: 1 },
      { id: "digishow-osc-td-break-c", label: "先核对两端地址和端口，再调整画面中对应的控制参数", score: 2 },
      { id: "digishow-osc-td-break-d", label: "逐段验证发送值、OSC地址端口、接收值和画面参数绑定", score: 4 },
    ],
  },
  {
    id: "jitter-troubleshoot",
    scenario:
      "距离控制画面时出现闪烁。你既不确定是传感器抖动，还是画面规则写错了，下一步怎么做最有效？",
    dimension: "troubleshooting",
    options: [
      { id: "jitter-troubleshoot-a", label: "记录原始距离并用固定测试值驱动画面，分别隔离输入与映射", score: 4 },
      { id: "jitter-troubleshoot-b", label: "先增加输入平滑和画面过渡，再比较闪烁是否明显减少", score: 2 },
      { id: "jitter-troubleshoot-c", label: "同步调整传感器频率和画面阈值，用多组参数快速试验", score: 1 },
      { id: "jitter-troubleshoot-d", label: "先观察原始距离稳定性，再单独验证画面规则和变化边界", score: 3 },
    ],
  },
  {
    id: "distance-to-sound-transfer",
    scenario:
      "原作品用距离控制画面明暗，现在改为控制声音音量。你会怎样迁移原有思路？",
    dimension: "transfer",
    options: [
      { id: "distance-to-sound-transfer-a", label: "保留原有距离数值，直接作为音量控制值并限制最大音量", score: 1 },
      { id: "distance-to-sound-transfer-b", label: "保留输入和换算结构，重标安全音量、方向与听感变化曲线", score: 4 },
      { id: "distance-to-sound-transfer-c", label: "保留距离输入，将远近简单对应为高低两个固定音量档位", score: 2 },
      { id: "distance-to-sound-transfer-d", label: "保留距离范围与反向关系，重新映射到安全音量并试听调整", score: 3 },
    ],
  },
  {
    id: "presence-to-touch-transfer",
    scenario:
      "原先作品由“观众进入区域”一次性点亮图案，现在改成“观众第一次触摸按钮”点亮。你会保留和改变什么？",
    dimension: "transfer",
    options: [
      { id: "presence-to-touch-transfer-a", label: "保留状态变化、单次锁定和复位结构，替换输入并验证按钮防抖", score: 4 },
      { id: "presence-to-touch-transfer-b", label: "保留锁定与离开复位思路，把进入事件换成按钮按下事件", score: 3 },
      { id: "presence-to-touch-transfer-c", label: "保留原流程的播放部分，将每次按钮按下都视为新的触发", score: 1 },
      { id: "presence-to-touch-transfer-d", label: "把进入检测替换为按钮按下，并增加固定时间的重复限制", score: 2 },
    ],
  },
];

export const QUESTION_SETS = {
  v1: QUESTION_SET_V1,
} as const satisfies Record<string, ReadonlyArray<DiagnosticQuestion>>;

export type QuestionSetVersion = keyof typeof QUESTION_SETS;

export const CURRENT_QUESTION_SET_VERSION: QuestionSetVersion = "v1";

// Compatibility aliases for callers that always mean the current set.
export const QUESTIONS = QUESTION_SETS[CURRENT_QUESTION_SET_VERSION];
export const QUESTION_SET_VERSION = CURRENT_QUESTION_SET_VERSION;

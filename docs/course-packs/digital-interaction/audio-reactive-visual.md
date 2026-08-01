# 声音驱动画面：真实案例证据与教学最小链

本说明用于把去标识 TouchDesigner 课程工程快照转写成可供智能体引用的教学知识。它解释工程中已经存在的关系，不代表教师人工经验，也不代表软件所有版本的通用菜单说明。

## 工程证据

- `1.1.2声音驱动画面` 主工程快照：`data/touchdesigner/structures/453c740b9575229c78d5b381a5ba4cc71432586fdfc24daae4df5d0b9508d141.json`。
  - `audioAnalysis/audiofilein1` 提供音频；`audioAnalysis/analyze1` 的 `function` 保存为 `rmspower`。
  - `audioAnalysis/out1` 输出处理后的声音层级；工程入口的 `null1` 和 `select1` 继续选择可用控制信号。
  - `project2` 与 `project3` 都从各自的 `in1` 接收控制值，再通过 `Math`、`Lag`、`Limit` 或 `Count` 等节点整理数值。
  - 整理后的数值被视觉参数引用，例如 `project3/ramp1` 的 `period` 引用 `null2` 的 `kick`，`project3/switch1` 的 `index` 引用 `null1` 的 `kick`。
- `1.2.4动态玻璃扭曲` 备份快照：`data/touchdesigner/structures/1aede0184897ebd60ba81e56f9886415f8982b1118aa33249908f8ee6f5488f6.json`。
  - 其中保存了一条更短、便于观察的控制链：`Audio Device In CHOP → Analyze CHOP（RMS Power）→ Filter CHOP → Math CHOP → Null CHOP`。
  - 最终 `Null CHOP` 的值由视觉节点参数引用，形成“声音数值改变—视觉参数改变”的可观察关系。

## 教学最小链

学生第一次搭建时，不复制完整主工程，只验证五个关系：

1. 输入：使用 `Audio File In CHOP` 或 `Audio Device In CHOP` 得到持续变化的声音通道。
2. 分析：使用 `Analyze CHOP`，以 `RMS Power` 把复杂波形归纳为可观察的强度值。
3. 稳定：根据现场数值决定是否加入 `Filter CHOP` 或 `Lag CHOP`，避免视觉参数剧烈跳动。
4. 映射：使用 `Math CHOP` 把声音数值换算到目标视觉参数需要的范围，并用 `Null CHOP` 形成清晰出口。
5. 输出：先只让一个视觉参数引用 `Null CHOP` 的通道；确认输入、分析值、映射值和画面参数依次发生变化，再扩展效果。

## 排障证据

“声音有数值但画面不动”不能直接归因于某个节点。应依次记录：

1. 声音输入节点是否持续变化；
2. `Analyze CHOP` 是否输出强度值；
3. `Math CHOP` 或其他映射节点的输出范围是否适合目标参数；
4. 视觉参数是否实际引用了最终控制通道；
5. 修改控制值后，目标画面参数和最终输出是否同步变化。

只有看见断点所在层，才进入对应节点的参数检查。智能体不能凭模型常识补写工程快照中没有保存的菜单命令。

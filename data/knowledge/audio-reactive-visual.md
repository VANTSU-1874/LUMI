---
id: audio-reactive-visual
title: 声音驱动画面的真实工程最小链
topic: TOUCHDESIGNER_FOUNDATIONS
authority: ANONYMIZED_CASE
localDocument: docs/course-packs/digital-interaction/audio-reactive-visual.md
verifiedDate: 2026-07-15
scope: 去标识TouchDesigner工程快照中声音输入、RMS分析、数值整理、参数引用与分层排障
tags: ["TouchDesigner", "声音驱动", "声音", "画面", "Audio File In", "Audio Device In", "Analyze", "RMS Power", "Filter", "Lag", "Math", "Null", "CHOP", "参数引用", "排障"]
facts: [{"id":"td-audio-five-link-chain","text":"课程真实工程可抽象为声音输入、RMS强度分析、数值稳定、范围映射和视觉参数引用五个关系。"},{"id":"td-audio-case-evidence","text":"主工程保存了Audio File In、Analyze的RMS Power、Math或Lag等数值整理节点，以及视觉参数对控制通道的引用。"},{"id":"td-audio-debug-layers","text":"声音有数值但画面不动时，应分别观察输入值、分析值、映射值和目标画面参数，定位第一个不再变化的层。"}]
actions: [{"id":"td-observe-upstream","text":"先观察声音输入和Analyze的RMS强度值是否持续变化。"},{"id":"td-build-audio-minimal-chain","text":"按输入、Analyze、Filter或Lag、Math、Null和一个视觉参数的顺序搭建最小链。"},{"id":"td-check-audio-binding","text":"再确认视觉参数实际引用最终Null通道，并比较引用前后的参数变化。"}]
---
这条知识来自课程已经解析的TouchDesigner工程快照。第一次搭建时，先用Audio File In CHOP或Audio Device In CHOP获得声音通道，再用Analyze CHOP的RMS Power得到强度值。根据数值是否抖动，选择Filter CHOP或Lag CHOP进行稳定；用Math CHOP换算范围，以Null CHOP作为清晰出口；最后只让一个视觉参数引用这个控制通道。

排障时逐层观察输入值、Analyze输出、Math输出和目标画面参数。只有确认前一层在变化而后一层没有变化，才能把问题定位到这一段。工程快照能够证明上述节点关系和参数引用，但没有保存所有软件版本的菜单操作，因此智能体不得补写未登记的菜单命令。

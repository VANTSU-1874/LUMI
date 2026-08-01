---
id: td-analyze-chop
title: Analyze CHOP：把一段通道归纳为可观察数值
topic: TOUCHDESIGNER_FOUNDATIONS
authority: OFFICIAL
url: https://docs.derivative.ca/Analyze_CHOP
verifiedDate: 2026-07-17
scope: Analyze CHOP的Average、Maximum、Minimum、Sum、RMS Power和峰值分析功能
tags: ["TouchDesigner", "Analyze CHOP", "RMS Power", "平均值", "最大值", "峰值", "声音强度", "CHOP"]
facts: [{"id":"td-analyze-functions","text":"Analyze CHOP可对通道执行Average、Maximum、Minimum、Sum、RMS Power和多种峰值分析。"},{"id":"td-analyze-rms","text":"RMS Power计算通道的均方根，可把一段波形归纳为强度数值。"}]
actions: [{"id":"td-observe-upstream","text":"先在Analyze之前确认输入通道和样本确实在变化。"},{"id":"td-compare-analyze-function","text":"根据要观察的是平均、极值、总量还是强度选择函数，并对比输出。"}]
---
Analyze CHOP适合把许多样本压缩为更容易驱动参数的数值。声音驱动画面常用RMS Power观察能量，但如果目标是抓峰值、最高点或总量，应选择对应函数。函数名正确并不保证结果适用，还要观察输入时域、通道数量和输出范围。

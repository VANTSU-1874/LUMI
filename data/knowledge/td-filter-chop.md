---
id: td-filter-chop
title: Filter CHOP：平滑信号并保留前后对照
topic: TOUCHDESIGNER_FOUNDATIONS
authority: OFFICIAL
url: https://docs.derivative.ca/Filter_CHOP
verifiedDate: 2026-07-17
scope: Filter CHOP平滑或锐化通道、Filter Width及使用Trail CHOP对比前后信号
tags: ["TouchDesigner", "Filter CHOP", "平滑", "抖动", "Filter Width", "Trail CHOP", "Lag CHOP", "CHOP"]
facts: [{"id":"td-filter-neighbors","text":"Filter CHOP通过当前样本与邻近样本的加权组合来平滑或锐化输入通道。"},{"id":"td-filter-width","text":"Filter Width决定参与计算的邻近范围，不同滤波类型使用不同权重。"},{"id":"td-filter-trail-compare","text":"Derivative建议用Trail CHOP同时观察滤波前后信号，便于比较效果。"}]
actions: [{"id":"td-observe-upstream","text":"先记录滤波前信号的变化速度、噪声和峰值。"},{"id":"td-compare-filter-trail","text":"把滤波前后信号同时接入Trail CHOP，逐步调整宽度并观察延迟与平滑程度。"}]
---
数值抖动时不要直接把Filter Width调到很大。过强平滑会让互动失去响应。先保留原信号作为对照，再在“稳定”和“跟手”之间找合适范围；若需要更突兀的追随效果，可再比较Lag CHOP，而不是把两个节点当作同义替换。

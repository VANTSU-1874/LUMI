---
id: td-null-chop
title: Null CHOP：不改数据的稳定引用出口
topic: TOUCHDESIGNER_FOUNDATIONS
authority: OFFICIAL
url: https://docs.derivative.ca/Null_CHOP
verifiedDate: 2026-07-17
scope: Null CHOP占位、保持输入数据、导出通道和下游cook控制
tags: ["TouchDesigner", "Null CHOP", "Export", "引用", "出口", "占位", "参数绑定", "Cook", "CHOP"]
facts: [{"id":"td-null-pass-through","text":"Null CHOP作为占位节点，默认不改变传入的数据。"},{"id":"td-null-export","text":"Null CHOP常用于把通道导出到参数，使上游节点可替换或调整而不必反复重建导出。"},{"id":"td-null-cook-options","text":"Null CHOP还提供控制下游节点何时重新cook的选项。"}]
actions: [{"id":"td-observe-upstream","text":"先确认Null CHOP上游最后一个处理节点输出正确。"},{"id":"td-bind-from-null","text":"把最终控制通道集中到命名清楚的Null CHOP，再从该出口建立参数引用。"}]
---
Null CHOP不是必需的视觉效果节点，而是让网络更容易维护和排障的接口。目标参数统一引用Null出口后，上游可以替换Filter或Math而不改每个下游绑定。画面不动时，应同时检查Null通道是否变化，以及目标参数是否真正引用了它。

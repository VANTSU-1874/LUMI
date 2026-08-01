---
id: td-math-chop
title: Math CHOP：组合通道与映射数值范围
topic: TOUCHDESIGNER_FOUNDATIONS
authority: OFFICIAL
url: https://docs.derivative.ca/Math_CHOP
verifiedDate: 2026-07-17
scope: Math CHOP的通道组合、Mult-Add和From Range到To Range线性缩放
tags: ["TouchDesigner", "Math CHOP", "Range", "From Range", "To Range", "映射", "缩放", "Combine Channels", "CHOP"]
facts: [{"id":"td-math-combine","text":"Math CHOP可用加、乘、平均、最小、最大等运算把多个通道组合。"},{"id":"td-math-range","text":"Range页可把一个输入低高范围线性转换为另一个输出低高范围。"},{"id":"td-math-order","text":"Math CHOP的预运算、通道或输入组合、后运算、Mult-Add和Range按既定顺序执行。"}]
actions: [{"id":"td-observe-upstream","text":"先记录Math CHOP之前输入的实际最小值和最大值。"},{"id":"td-map-observed-range","text":"根据目标参数需要设置From Range与To Range，并观察超出范围时的结果。"}]
---
映射不是把常见数值机械填入参数框。先观察真实输入范围，再说明输出参数希望如何变化：正向还是反向、是否需要限制、是否允许超出。多个功能同时开启时，要按运算顺序排查，避免只盯最终数值猜原因。

---
id: touchdesigner-foundations
title: Getting started（Derivative官方文档）
topic: TOUCHDESIGNER_FOUNDATIONS
authority: OFFICIAL
url: https://docs.derivative.ca/Getting_started
verifiedDate: 2026-07-12
scope: TouchDesigner入门、官方学习入口与教育使用范围
tags: ["TouchDesigner", "Derivative", "节点", "Operator", "CHOP", "Channel Operator", "TOP", "Texture Operator", "图像", "实时视觉", "声音驱动", "画面", "入门"]
facts: [{"id":"td-operator-flow","text":"TouchDesigner的operator连接形成可观察的数据流。"},{"id":"td-chop-channels","text":"CHOP（Channel Operator）用于处理通道形式的数值数据。"},{"id":"td-top-images","text":"TOP（Texture Operator）用于处理和输出图像；在声音驱动画面的关系中，CHOP提供控制数值，TOP或其他视觉参数呈现画面变化。"}]
actions: [{"id":"td-minimal-check","text":"先验证一个输入经过一个处理到达一个输出。"},{"id":"td-observe-upstream","text":"先观察上游节点数值，再检查下游参数绑定。"}]
---
Derivative的Getting started页面从界面操作、Network Editor和operator网络开始介绍基础使用。课程提示应优先解释数据如何在operator之间流动，再定位到具体节点，避免把记住节点名称当作已经理解交互逻辑。

TouchDesigner网络由operator连接形成；CHOP（Channel Operator）用于处理通道形式的数值数据，适合观察连续输入、控制信号和参数变化；TOP（Texture Operator）用于处理和输出图像。声音驱动画面时，CHOP侧的数值需要经过映射并引用到TOP或其他视觉参数，画面才会产生对应变化。学习者应先用节点viewer或数值观察确认上游是否变化，再检查下游参数是否真正绑定。

许可证、版本功能和系统要求可能变化。知识库不替代Derivative当前下载、许可和系统要求页面；部署或机房安装前应再次核查官方页面。

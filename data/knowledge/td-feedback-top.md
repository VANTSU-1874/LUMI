---
id: td-feedback-top
title: Feedback TOP：目标节点、回路与单帧重置
topic: TOUCHDESIGNER_FOUNDATIONS
authority: OFFICIAL
url: https://docs.derivative.ca/Feedback_TOP
verifiedDate: 2026-07-17
scope: Feedback TOP的Target TOP、Bypass Feedback、Reset Pulse和下游反馈回路
tags: ["TouchDesigner", "Feedback TOP", "反馈回路", "Target TOP", "Reset", "拖影", "运动模糊", "TOP"]
facts: [{"id":"td-feedback-target","text":"Feedback TOP启用反馈时，从Target TOP指定的图像流取得输出来源。"},{"id":"td-feedback-downstream","text":"Target TOP可位于反馈网络下游，从而在Feedback与目标之间加入其他TOP形成回路效果。"},{"id":"td-feedback-reset","text":"Reset Pulse可在单帧重置反馈；绕过反馈时输入图像直接通过。"}]
actions: [{"id":"td-observe-upstream","text":"先确认输入图像本身正常，再观察Target TOP当前输出。"},{"id":"td-test-feedback-reset","text":"先搭建最小反馈回路，用Reset Pulse确认回路可清空，再逐个加入处理节点。"}]
---
反馈画面全黑或无限堆积时，先不要继续添加效果。检查Target TOP是否指向回路下游、输入是否可见、反馈是否处于绕过状态，并用单帧重置观察回路是否重新建立。最小回路正常后，再逐个增加Transform、Level等处理并比较变化。

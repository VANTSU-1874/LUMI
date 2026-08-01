---
id: design-status-feedback
title: 操作结果与进度需要可感知的状态反馈
topic: DESIGN_FOUNDATIONS
authority: OFFICIAL
url: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
verifiedDate: 2026-07-17
scope: WCAG 2.2状态消息的结果、等待、进度与错误反馈，以及不夺取焦点的辅助技术通知
tags: ["交互反馈", "点击反馈", "成功提示", "操作结果", "状态消息", "加载", "进度", "成功", "错误", "焦点", "辅助技术", "WCAG"]
facts: [{"id":"design-status-message-purpose","text":"状态消息可告知操作结果、等待状态、进度或错误，同时不必改变用户当前上下文。"},{"id":"design-status-programmatic","text":"在标记语言实现的内容中，状态消息应能被辅助技术通过角色或属性识别并呈现。"}]
actions: [{"id":"design-clarify-goal","text":"先列出用户操作后必须知道的结果、等待、进度或错误状态。"},{"id":"design-test-status-feedback","text":"分别用视觉观察和辅助技术检查关键状态是否可被感知且不会无故打断任务。"}]
---
点击后毫无反馈会让用户无法判断系统是否收到操作；只出现一个无语义动画，也可能让使用屏幕阅读器的人完全错过状态。设计时应把“发生了什么、是否完成、下一步能否继续”变成清楚的反馈，并避免为了通知而随意抢走焦点。

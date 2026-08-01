---
id: td-case-version-comparison
title: 匿名TouchDesigner案例的版本对照方法
topic: TOUCHDESIGNER_FOUNDATIONS
authority: ANONYMIZED_CASE
localDocument: docs/course-packs/digital-interaction/anonymized-case-version-comparison.md
verifiedDate: 2026-07-17
scope: 从课程案例索引脱敏整理的主工程、备份版本、解析状态、结构快照和节点差异
tags: ["TouchDesigner", "匿名案例", "版本对照", "主工程", "备份", "节点差异", "结构快照", "案例学习"]
facts: [{"id":"td-case-primary-backup","text":"去标识案例索引同时登记主工程和备份版本，并为可解析版本保存结构快照标识。"},{"id":"td-case-structure-diff","text":"部分连续版本保存新增、删除和变化节点列表，可用于定位发生过的结构变化。"},{"id":"td-case-diff-not-causation","text":"节点差异只能证明结构变化，不能单独证明变化原因、教学效果或视觉质量。"}]
actions: [{"id":"td-observe-upstream","text":"先在两个版本中定位同一输入与输出，再比较中间结构变化。"},{"id":"td-compare-case-versions","text":"每次只选择某项版本差异，结合节点viewer或参数证据验证其实际作用。"}]
---
案例学习不等于复制最终主工程。先选择一份备份与主工程，查看结构差异，再提出“新增网络可能改变哪段信号关系或画面表现”的假设。只有当节点viewer、通道值或输出画面支持该假设时，才把它写成案例结论。

本条只使用脱敏说明中登记的结构事实，不读取原始索引里的设备标识、本机路径或外部文件名。它不包含学生学习成效，也不能代替Derivative官方节点定义。

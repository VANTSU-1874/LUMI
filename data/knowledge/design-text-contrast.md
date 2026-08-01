---
id: design-text-contrast
title: 文字与背景的最低对比度检查
topic: DESIGN_FOUNDATIONS
authority: OFFICIAL
url: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
verifiedDate: 2026-07-17
scope: WCAG 2.2文字及文字图像的AA级最低对比度与大字号例外
tags: ["文字", "字体", "对比度", "可读性", "4.5:1", "3:1", "大字号", "WCAG", "界面"]
facts: [{"id":"design-text-contrast-normal","text":"WCAG 2.2的AA级标准要求普通文字及文字图像与背景至少达到4.5比1对比度。"},{"id":"design-text-contrast-large","text":"大字号文字及其文字图像的最低对比度为3比1；标志文字和纯装饰文字另有例外。"},{"id":"design-contrast-threshold","text":"对比度是阈值，计算结果不能通过四舍五入把未达标数值变成达标。"}]
actions: [{"id":"design-clarify-goal","text":"先区分当前文字是正文、标题、标志还是纯装饰。"},{"id":"design-measure-text-contrast","text":"记录前景色、背景色和实际对比度，再判断是否达到相应阈值。"}]
---
“看起来有对比”不等于数值达标。正文、小字号说明和图片上的关键信息尤其需要测量；细字或特殊字体即使名义达标，也可能因抗锯齿显得更淡，可在阈值之外保留安全余量。

这项标准适合网页和界面可访问性检查。印刷品还要结合纸张、油墨、照明与打样结果，不能只拿屏幕数值替代实物判断。

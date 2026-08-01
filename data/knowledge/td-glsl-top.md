---
id: td-glsl-top
title: GLSL TOP：着色器输出与编译错误定位
topic: TOUCHDESIGNER_FOUNDATIONS
authority: OFFICIAL
url: https://docs.derivative.ca/GLSL_TOP
verifiedDate: 2026-07-17
scope: GLSL TOP渲染GLSL着色器、Info DAT编译错误和Compute Shader版本要求
tags: ["TouchDesigner", "GLSL TOP", "shader", "着色器", "Info DAT", "编译错误", "Compute Shader", "GLSL 4.30", "TOP"]
facts: [{"id":"td-glsl-renders-top","text":"GLSL TOP把GLSL着色器渲染为TOP图像。"},{"id":"td-glsl-info-dat","text":"Derivative文档明确建议用Info DAT检查着色器编译错误。"},{"id":"td-glsl-compute-version","text":"GLSL TOP可作为像素着色器或Compute Shader；Compute Shader需要GLSL 4.30或更高版本。"}]
actions: [{"id":"td-observe-upstream","text":"先确认输入纹理、分辨率和必要的uniform值可用。"},{"id":"td-read-glsl-errors","text":"先读取Info DAT中的第一条编译错误并修复，再处理后续连锁错误。"}]
---
GLSL TOP黑屏时，优先把问题拆成编译、输入和数值三层。Info DAT有编译错误就先修第一条；编译通过后再检查输入纹理与uniform；最后处理除零、未初始化值或坐标范围等运行结果。不要在没有错误文本时凭画面猜语法问题。

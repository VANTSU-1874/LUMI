---
id: osc-out-chop
title: OSC Out CHOP：发送开关、目标地址与端口
topic: OSC_TROUBLESHOOTING
authority: OFFICIAL
url: https://docs.derivative.ca/OSC_Out_CHOP
verifiedDate: 2026-07-17
scope: TouchDesigner OSC Out CHOP的Active、协议、Network Address、Network Port和发送格式
tags: ["TouchDesigner", "OSC Out CHOP", "OSC", "UDP", "Active", "Network Address", "Network Port", "发送", "端口"]
facts: [{"id":"osc-out-active","text":"OSC Out CHOP的Active开启时才向网络端口发送信息，关闭时不发送。"},{"id":"osc-out-address-port","text":"Network Address指定目标计算机，Network Port指定OSC数据包发送到的端口。"},{"id":"osc-out-localhost","text":"目标地址使用localhost表示通信另一端位于同一台计算机。"}]
actions: [{"id":"osc-check-receiver","text":"确认接收端Active、监听端口和可见通道。"},{"id":"osc-check-sender","text":"确认发送端Active开启、输入通道有值，并逐项核对目标地址和端口。"}]
---
OSC故障必须同时看发送与接收。发送端有变化值不代表已经发出，Active、目标地址和端口仍可能错误；接收端没有通道也不等于网络损坏。先用固定测试值和单一通道建立最小链，再恢复复杂地址模式与多通道数据。

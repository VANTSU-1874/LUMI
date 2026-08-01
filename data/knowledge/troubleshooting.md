---
id: touchdesigner-osc-troubleshooting
title: OSC In CHOP（Derivative官方文档）
topic: OSC_TROUBLESHOOTING
authority: OFFICIAL
url: https://docs.derivative.ca/OSC_In_CHOP
verifiedDate: 2026-07-12
scope: TouchDesigner通过OSC In CHOP接收UDP消息时的可观察检查点
tags: ["OSC", "TouchDesigner", "OSC In CHOP", "UDP", "端口", "地址", "故障排查"]
facts: [{"id":"osc-listening-port","text":"OSC In CHOP需要设置接收消息的监听端口。"},{"id":"osc-active-state","text":"OSC In CHOP的Active关闭时不会更新接收数据。"}]
actions: [{"id":"osc-compare-ports","text":"核对发送目标与接收监听端口。"},{"id":"osc-check-receiver","text":"确认接收端Active状态和可见通道。"}]
---
Derivative文档说明OSC In CHOP可接收符合OSC规范的第三方应用消息，消息传输可使用UDP。排查接收问题时，先确认Active是否开启，再核对Network Port、Local Address和OSC Address Scope；端口被其他程序占用也会影响接收。

证据顺序应保持可观察：发送端是否有变化值，发送目标与接收监听端口是否一致，OSC In CHOP是否出现通道，通道是否被scope过滤，收到的通道是否绑定到目标参数。不要在没有端口、地址或通道证据时直接断言网络或软件故障。

本条只覆盖登记来源中OSC In CHOP可直接观察和配置的接收检查点。未登记来源支持的操作结论不在本条中扩展。

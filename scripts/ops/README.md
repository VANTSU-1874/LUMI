# Lumi 受限发布入口

`lumi-release` 是生产机上的 root-owned 发布边界，不是把 sudo 授权给
用户可写脚本。它只接受本机签名、且哈希与签名均匹配的发布输入；私钥始终
留在发布者电脑，服务器只保存公钥。

## 一次性安装

把本目录的下列四个文件原样上传到服务器上 `arlo` 私有的暂存目录：

- `lumi-release`
- `lumi-release.sudoers`
- `lumi-release-allowed-signers`
- `install-lumi-release-wrapper.sh`

先在服务器核对 `install-lumi-release-wrapper.sh` 的 SHA-256，再仅执行一次：

~~~bash
sudo /home/arlo/.lumi-release-install-<timestamp>/install-lumi-release-wrapper.sh
~~~

安装器会在提权前核对三个载荷的固定 SHA-256、运行 `bash -n` 和
`visudo -cf`，并将已有入口备份到 root-only 目录。它只增加：

~~~text
arlo ALL=(root) NOPASSWD: /usr/local/sbin/lumi-release
~~~

不会授权 `/home/arlo` 下的任何脚本、shell、`systemctl` 或任意 sudo 命令。

## 每次发布的签名输入

上传到：

~~~text
/home/arlo/lumi-release-input/<commit>/
  manifest
  manifest.sig
  source.tar
  built.tar.gz
~~~

`manifest` 必须只包含下列字段（值按实际构建替换）：

~~~text
source_commit=<40-hex-commit>
expected_current=<currently-active-40-hex-commit>
source_sha256=<sha256-of-source.tar>
built_sha256=<sha256-of-built.tar.gz>
build_id=<Next-BUILD_ID>
esbuild_version=<expected-esbuild-semver>
database_migration=not-required
environment_write=not-requested
~~~

普通无迁移发布继续使用上面的值。K8.4 发布必须成对使用下面两个精确值；
入口拒绝任意其他迁移名、任意环境键或两者只出现一个：

~~~text
database_migration=agent-interventions-0048-additive
environment_write=enable-agent-interventions
~~~

Knowledge V2 文本生产 generation 必须成对使用：

~~~text
database_migration=knowledge-v2-0050-additive
environment_write=enable-knowledge-v2-text
~~~

该组合只有在 `KNOWLEDGE_V2_CANARY_USER_IDS` 已由独立受控流程配置为 1–8 个
内部学生账号时才允许准备；发布器不读取或打印账号本身，只记录数量。切换阶段仅把
`KNOWLEDGE_OBJECT_V2/EVIDENCE_BUNDLE_V2/VISUAL_RETRIEVAL` 原子设为
`true/true/false`，运行并核验 0050 与封存 generation（808 documents、5164 nodes、
156 assets、5164 representations），失败时恢复原三元组。模型辅助质量与 harness
仍是最终健康硬门；报告过期时会回退，不能以数据安装成功代替比赛健康通过。

在**本机**对 `manifest` 签名，不上传私钥：

~~~powershell
ssh-keygen -Y sign -f "$env:USERPROFILE\.ssh\vps_38_65_95_96" -n lumi-release manifest
~~~

这会生成同目录的 `manifest.sig`。准备阶段校验签名、两个归档的哈希和路径
安全性，创建并验证恢复点，写入不可变 release 标记，但不会切换 `current`：

~~~bash
sudo -n /usr/local/sbin/lumi-release prepare <commit>
~~~

只有在人工审阅 `PREPARED.result`、恢复点和健康证据后，才能根据准备命令输出
的 run ID 先运行候选审计：

~~~bash
sudo -n /usr/local/sbin/lumi-release audit <prepare-run-id>
~~~

该命令只对已准备、尚未切换的 Knowledge V2 release 使用 service.env 中的真实模型
配置运行 Agent 质量评测和 harness。报告先封存在 release 内并把哈希追加到 root seal，
不会改生产报告、数据库、环境变量或 `current`。审计通过后，才能使用原准备步骤输出的
一次性 token 运行：

~~~bash
sudo -n /usr/local/sbin/lumi-release cutover <prepare-run-id> <confirmation-token>
~~~

该步骤会再次确认 `current` 没被其他发布改变。普通发布直接原子切换；K8.4
发布在服务停止后只允许原子启用 `AGENT_INTERVENTIONS_ENABLED=true`，并以
`lumi` 服务用户执行、核验 `0048` 加法迁移，随后原子切换、重启、健康检查和
`/student` 冒烟。失败会切回原 release 并恢复原布尔值；已经成功提交的 `0048`
结构为向后兼容的纯新增表、索引与触发器，回滚旧代码时保留并在证据中明确记录。
Knowledge V2 切换还会在停服后备份并原子提升已封存的质量与 harness 报告；切换失败时
这些报告与 V2 环境三元组、`current` 一起恢复，避免新报告配旧 release。
入口仍拒绝任意迁移、任意环境编辑和用户可写 root 脚本。

日常只读核查：

~~~bash
sudo -n /usr/local/sbin/lumi-release status
~~~

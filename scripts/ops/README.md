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

灵感 Wiki D-27 五条正式案例使用下面的精确组合：

~~~text
database_migration=inspiration-wiki-0051-0063-d27
environment_write=not-requested
~~~

该组合保留生产 0050 Knowledge V2，顺序执行 0051–0063，并从签名发布包中事务化导入恰好五条已授权案例及其受控媒体。Browse、Search、Preview 开启；R2、Embedding、Lumi 自动引用继续关闭。导入支持精确幂等重放，任何行、媒体哈希、教师身份或能力边界冲突都会阻断切换。
准备 D-27 release 时，入口还会按当前已封存 release 的 `runtime-manifest.json` 逐文件复算尺寸与 SHA-256，再把既有 Knowledge V2 文本运行包继承到新 release；目标已有文件必须完全同哈希，路径穿越、符号链接或内容漂移都会阻断准备。这样 D-27 只增加灵感 Wiki 能力，不会静默撤掉已上线的 Knowledge V2。

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
的 run ID 与一次性 token 运行：

~~~bash
sudo -n /usr/local/sbin/lumi-release cutover <prepare-run-id> <confirmation-token>
~~~

该步骤会再次确认 `current` 没被其他发布改变，原子切换、重启、健康检查和
`/student` 冒烟；失败会自动回滚到切换前 release。数据库迁移或服务环境修改
会被此入口拒绝，必须另行评审。

日常只读核查：

~~~bash
sudo -n /usr/local/sbin/lumi-release status
~~~

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

学生文件库与项目工作区使用下面的精确组合：

~~~text
database_migration=student-workspace-0064-0065-additive
environment_write=not-requested
~~~

该策略只运行已签名版本内的规范迁移器，并要求生产迁移历史精确连续。它新增学生
文件库、独立项目容器和项目会话关系，随后核验目标表、索引、所有权触发器、项目外键、
迁移日志与全库外键一致性。失败时切回旧代码；新增结构保持向后兼容，不开放任何环境
变量、匿名访问或额外学生数据通道。

教师显式授权域与比赛版收口使用下面的精确组合：

~~~text
database_migration=teacher-scopes-0066-additive
environment_write=not-requested
~~~

该策略在准备阶段继承并逐文件校验当前已封存的 Knowledge V2 运行包；切换阶段以
`lumi` 服务用户运行规范迁移器，只新增 `teacher_access_scopes` 表及其索引。随后核验
字段、约束数据、固定课程负责人回填、迁移日志与全库外键一致性，并只输出授权域数量，
不输出教师身份。该策略与 Knowledge V2 发布一样，必须在切换前对候选运行 Agent Quality
与 Harness、封存报告及哈希，并在切换时原子提升报告；新服务须通过
`competitionReady` 健康门，否则代码链接与报告一起回退。0066 的新增结构保持向后兼容
并保留审计记录。

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

当当前生产版的灵感 Wiki 多模态路由返回通用错误时，可运行下列只读诊断。
它只输出最近 10 分钟与 `inspiration-multimodal-search` 相邻的最多 120 行，
并复用凭据脱敏、邮箱脱敏和每行长度上限；不接受时间、服务名或 journal 查询参数：

~~~bash
sudo -n /usr/local/sbin/lumi-release diagnose-current-inspiration
~~~

发布目录盘点与旧回退版本清理也只能经过同一受限入口。盘点会以 root 权限回报
每个目录的精确字节、完整发布标记、成功/失败切换证据、实时进程/符号链接引用和
current 状态：

~~~bash
sudo -n /usr/local/sbin/lumi-release release-inventory
~~~

清理命令只接受 1–32 个完整小写 40 位提交号，拒绝 current、后缀候选目录、缺少
成功切换证据、仍被进程/符号链接引用、仍有准备 seal，或发布标记/属主/模式不匹配
的目录。它在整组删除前完成全部预检，删除前后均要求完整生产健康（含
`competitionReady`）通过，并保留独立审计证据；不会清理数据库恢复点、质量报告、
审计证据、模型或索引。示例：

~~~bash
sudo -n /usr/local/sbin/lumi-release prune-retired <commit> [<commit> ...]
~~~

历史测试有时会留下 `<40 位提交号>-<测试后缀>` 形式的完整或半成品发布目录。
这类目录不能传给正式版本清理命令；只能显式列名调用下列入口：

~~~bash
sudo -n /usr/local/sbin/lumi-release prune-never-activated <commit>-<suffix> [<commit>-<suffix> ...]
~~~

该命令拒绝无后缀目录、current、创建未满一小时、被进程或符号链接引用、仍有
prepare seal、属主/模式异常、挂载点，以及存在成功切流证据的目录。带完整发布标记的
目录还必须让标记提交与名称前缀一致；整组预检全部通过后才会删除，并在前后执行基础
健康检查、记录释放字节和 `PRODUCTION_CHANGED=NO`。

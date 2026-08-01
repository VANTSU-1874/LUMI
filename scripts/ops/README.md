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

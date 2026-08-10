# Lumi Knowledge V2 Linux 文本运行时通知

本通知只适用于独立生成的 `LUMI_KNOWLEDGE_V2_TEXT_RUNTIME_PACKAGE`，不改变源码发行包
`third_party/knowledge-v2/manifest.json` 中“模型权重未包含”的既有边界。

文本工件包含冻结的 `BAAI/bge-small-zh-v1.5` 模型快照、模型 seal、BGE 文本索引、Knowledge
V2 control bundle、Lumi 文本 sidecar 源码和直接依赖版本清单。它明确不包含课程 PNG、视觉模型、
CUDA 环境、数据库、服务配置或密钥。

## 冻结组件

- `BAAI/bge-small-zh-v1.5` revision
  `7999e1d3359715c523056ef9478215996d62a620`，上游声明 MIT；随工件复制
  `LICENSE-MIT.txt`，模型卡保留在冻结快照的 `README.md`。
- PyTorch `2.11.0` CPU；随工件复制 `LICENSE-PYTORCH-2.11.0.txt`。
- Transformers `5.14.1`、Hugging Face Hub `1.24.0`、Safetensors `0.8.0`；随工件复制
  `LICENSE-APACHE-2.0.txt` 作为当前已核对的上游许可文本。

## 就绪边界

该工件 manifest 的 `status=PAYLOAD_PREPARED` 和
`pythonEnvironment=TARGET_INSTALL_REQUIRED` 表示模型与索引载荷已封装，但 Linux Python 环境
尚未验收。T3 必须在 Ubuntu 24.04/Python 3.12 CPU 环境安装冻结依赖、记录完整 `pip freeze`、
运行模型 seal、索引、sidecar 握手和退出检查，才能形成生产外 Linux readiness 收据。

本通知不构成法律意见；若依赖版本、模型 revision、分发方式或打包内容变化，必须重新核对许可
并生成新的不可变 attempt，不能覆盖本通知或旧 manifest。

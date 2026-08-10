# Lumi Knowledge V2 第三方通知

本目录由 scripts/install-local-release.ps1 作为不可变本地发行的必需内容校验。
安装器通过 git archive 复制已跟踪文件，因此本目录会随每个源码发行 commit 自动进入
%LOCALAPPDATA%\ChuyingAI\releases\<commit>-node<abi>。

它记录 Knowledge V2 使用或可选加载的冻结模型与 Python 运行库的许可证信息；并不把
任何模型权重、Python 环境、CUDA wheel、索引、缓存或课程资料加入本仓库发行物。

## 组件通知

### BAAI bge-small-zh-v1.5

- 冻结 revision：7999e1d3359715c523056ef9478215996d62a620
- 上游模型卡：<https://huggingface.co/BAAI/bge-small-zh-v1.5/tree/7999e1d3359715c523056ef9478215996d62a620>
- 上游声明：MIT；冻结快照不含单独 LICENSE 或 NOTICE 文件。
- 随包条款：[LICENSE-MIT.txt](LICENSE-MIT.txt)。

### Google siglip2-base-patch16-224

- 冻结 revision：75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2
- 上游模型卡：<https://huggingface.co/google/siglip2-base-patch16-224/tree/75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2>
- 上游声明：Apache-2.0；冻结快照不含单独 LICENSE 或 NOTICE 文件。
- 随包条款：[LICENSE-APACHE-2.0.txt](LICENSE-APACHE-2.0.txt)。

### Hugging Face Transformers 5.14.1

- 上游许可证：<https://raw.githubusercontent.com/huggingface/transformers/v5.14.1/LICENSE>
- Copyright 2018- The Hugging Face team. All rights reserved.
- 许可证：Apache-2.0；随包条款见 [LICENSE-APACHE-2.0.txt](LICENSE-APACHE-2.0.txt)。

### PyTorch 2.11.0+cu130

- 上游许可证：<https://raw.githubusercontent.com/pytorch/pytorch/v2.11.0/LICENSE>
- 许可证与项目版权通知：[LICENSE-PYTORCH-2.11.0.txt](LICENSE-PYTORCH-2.11.0.txt)。

### TorchVision 0.26.0+cu130

- 上游许可证：<https://raw.githubusercontent.com/pytorch/vision/v0.26.0/LICENSE>
- 许可证与项目版权通知：[LICENSE-TORCHVISION-0.26.0.txt](LICENSE-TORCHVISION-0.26.0.txt)。

## 再分发边界

当前本地安装器只归档源码并运行 Node/pnpm 构建；它不归档模型权重、Python 环境或 CUDA
运行时。若未来发行物加入这些内容，发行负责人必须在打包前补入其精确版本的许可证、
NOTICE 与再分发审查，重新生成并复核本目录的 manifest.json。本通知不构成法律意见。

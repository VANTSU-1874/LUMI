# Lumi self-hosted text retrieval

This directory is an isolated T4 text-vector retrieval layer. It neither
modifies the service database nor connects the index to the Agent. Runtime
inputs are a sealed local model snapshot, a sealed local index, a bounded text
query, a course-pack scope, and `topK`. No embedding API or application secret
is read.

The fixed model contract is:

- `BAAI/bge-small-zh-v1.5`
- immutable revision `7999e1d3359715c523056ef9478215996d62a620`
- MIT model repository license
- 512 dimensions, CLS pooling, L2 normalization
- short-query prefix `为这个句子生成表示以用于检索相关文章：`

The runtime requires CPython 3.12. Direct dependencies are pinned in
`requirements.txt`; PyTorch is installed separately from the official wheel
index appropriate to the host. The T3 Windows CUDA environment used
`torch==2.11.0` and `transformers==5.14.1`.

`download` is the only command allowed to access Hugging Face. It requests the
immutable commit and writes a complete file-list seal outside the snapshot.
`build` and `serve` use local files only with remote code disabled and reject
any model, seal, manifest, or tensor drift.

```powershell
python tools/text-retrieval/text_retrieval.py download `
  --cache-dir .runtime/text-retrieval/hf `
  --seal-path .runtime/text-retrieval/seals/bge-small-zh-v1.5.json

python tools/text-retrieval/text_retrieval.py build `
  --model-dir <snapshot-directory-from-download> `
  --model-seal .runtime/text-retrieval/seals/bge-small-zh-v1.5.json `
  --corpus data/knowledge-v2/corpus.json `
  --output-root .runtime/text-retrieval/indexes `
  --device cuda

python tools/text-retrieval/text_retrieval.py serve `
  --model-dir <snapshot-directory-from-download> `
  --model-seal .runtime/text-retrieval/seals/bge-small-zh-v1.5.json `
  --index-dir <content-addressed-index-directory> `
  --device cuda
```

Incremental builds may add `--base-index-dir <verified-index-directory>` and
`--incremental-plan-output <detached-plan.json>`. The base generation is
read-only. Text records reuse vectors only when the full frozen
model/config/builder identity and `recordHash` match; changed records are
encoded independently, deleted records are omitted, and the new payload is
fully verified before atomic publication. Single-record encoding is part of
the V2 index identity so full and incremental builds produce identical vector
bytes for the same final corpus.

The offline index includes V2 `DOCUMENT`, `SECTION`, and `TEXT` nodes plus
source-authored `CAPTION` annotations. A text-node embedding includes its
document and section titles for retrieval context, while every result still
targets the exact V2 node. Caption results target their exact image node.
Generated captions, OCR, API output, and unsealed payloads are excluded.

The JSONL sidecar writes protocol envelopes only to stdout. A TypeScript
client validates the exact corpus/index/model identity, course scope, hit
shape, response size, timeout, and process lifecycle before results are
accepted. Empty, timed-out, malformed, or exited sidecars remain explicit
failure states so the caller can fall back to lexical retrieval.

Model weights, environments, caches, and generated indexes remain below the
ignored `.runtime/` directory and are not redistributed by this repository.
Any packaged distribution must preserve upstream license and notice terms.

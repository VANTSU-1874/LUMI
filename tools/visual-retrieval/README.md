# Lumi local visual retrieval POC

This directory is an isolated T3 benchmark. It does not modify the service
database, active index pointer, Web runtime, or Agent tools.

The runtime must use CPython 3.12 in `.runtime/visual-retrieval/`; model and
Hugging Face caches must stay on the E drive. The online `serve` protocol sees
only opaque asset IDs, the sealed index tensors, bounded query-image pixels,
the real course scope, and the student's query.

Poster teaching pages are never indexed as full pages. The index contains:

- normalized `ORIGINAL_ART` crop
  `[0.038674, 0.203125, 0.453039, 0.390625]`;
- normalized `ANALYSIS_OVERLAY` crop
  `[0.508287, 0.203125, 0.453039, 0.390625]`;
- the six raw grid images as `FULL_IMAGE`.

This excludes the page header and the Chinese answer paragraph below the
visual panels. Source PNG files are read-only inputs and are not rewritten.

Direct Python dependencies are fixed in `requirements-poc.txt`. PyTorch and
torchvision are installed separately from the official CUDA wheel index:

```powershell
python -m pip install torch==2.11.0 torchvision==0.26.0 `
  --index-url https://download.pytorch.org/whl/cu130
python -m pip install -r tools/visual-retrieval/requirements-poc.txt
python -m pip check
```

Both Hugging Face models are pinned to immutable commit revisions in
`poc.py`. `download` writes a snapshot seal outside the model directory;
`probe`, `build`, and `serve` refuse a directory whose file list, digest,
repository ID, or immutable revision differs from that seal. They load only
the sealed local snapshot with remote code disabled.

```powershell
python tools/visual-retrieval/poc.py download `
  --adapter siglip2 `
  --cache-dir .runtime/visual-retrieval/hf `
  --seal-path .runtime/visual-retrieval/seals/siglip2.json

python tools/visual-retrieval/poc.py probe `
  --adapter siglip2 `
  --model-dir <snapshot-directory-from-download> `
  --model-seal .runtime/visual-retrieval/seals/siglip2.json `
  --offload-dir .runtime/visual-retrieval/offload/siglip2
```

Image-bearing requests carry a bounded PNG byte payload plus SHA-256 and an
opaque asset ID. The sidecar decodes and encodes those pixels online; it never
receives a local path or reuses the candidate index embedding as the query.
The index loader recomputes the content-addressed bundle hash and validates
every tensor key, shape, offset, count, dtype, and finite value before loading
the model.

`build` also accepts `--base-index-dir <verified-index-directory>` and
`--incremental-plan-output <detached-plan.json>`. An asset reuses its region
vectors only when the frozen provider identity and the composite
`sourceSha256 + region geometry + config + model revision` key match. The base
directory remains read-only; the final tensor order follows the current asset
order, and a newly staged payload is fully verified before atomic publication.
The detached plan records exact `REUSE`, `REBUILD`, and `DELETE` counts without
changing the content-addressed provider manifest.

## License and redistribution boundary

- The pinned
  [SigLIP2 snapshot](https://huggingface.co/google/siglip2-base-patch16-224/tree/75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2)
  and
  [ColQwen2 snapshot](https://huggingface.co/vidore/colqwen2-v1.0-hf/tree/0d3e414967fde994dd99a0ccc29bcb34b5355712)
  both declare `apache-2.0` for the model repository and weights.
- The pinned Transformers 5.14.1 runtime is Apache-2.0. PyTorch 2.11.0 uses
  its BSD-style license and redistribution conditions. Other Python
  dependencies retain their own licenses.
- Model weights, Python environments, caches, indexes, and evaluation reports
  stay below ignored `.runtime/` and are not redistributed by this repository.
  A future packaged release must ship the applicable third-party license and
  notice texts; this POC does not grant a separate license or erase upstream
  terms.

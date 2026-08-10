#!/usr/bin/env python3
"""Run a fail-closed offline smoke probe against a packaged BGE sidecar."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import uuid


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-root", type=Path, required=True)
    return parser.parse_args()


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def require_record(value: object, code: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(code)
    return value


def main() -> int:
    args = parse_arguments()
    package_root = args.package_root.resolve(strict=True)
    manifest = require_record(
        read_json(package_root / "runtime-manifest.json"),
        "SIDECAR_PROBE_MANIFEST_INVALID",
    )
    bindings = require_record(
        manifest.get("bindings"),
        "SIDECAR_PROBE_BINDINGS_INVALID",
    )
    model_revision = str(bindings.get("modelRevision"))
    provider_hash = str(bindings.get("providerIndexHash"))
    model_dir = package_root / (
        ".runtime/knowledge-v2-linux/models/"
        f"BAAI--bge-small-zh-v1.5/{model_revision}"
    )
    model_seal = package_root / (
        ".runtime/knowledge-v2-linux/seals/bge-small-zh-v1.5.json"
    )
    index_dir = package_root / (
        ".runtime/knowledge-index/providers/bge-small-zh-v1-5/"
        f"{provider_hash}"
    )
    sidecar = package_root / "tools/text-retrieval/text_retrieval.py"
    for path in (model_dir, model_seal, index_dir, sidecar):
        path.resolve(strict=True)

    environment = os.environ.copy()
    environment.update({
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "TOKENIZERS_PARALLELISM": "false",
        "OMP_NUM_THREADS": "4",
    })
    started = time.perf_counter()
    process = subprocess.Popen(
        [
            sys.executable,
            str(sidecar),
            "serve",
            "--model-dir",
            str(model_dir),
            "--model-seal",
            str(model_seal),
            "--index-dir",
            str(index_dir),
            "--device",
            "cpu",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        env=environment,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    assert process.stderr is not None
    try:
        ready_line = process.stdout.readline()
        if not ready_line:
            raise ValueError(
                "SIDECAR_PROBE_READY_MISSING:"
                + process.stderr.read()[-2000:]
            )
        ready = require_record(
            json.loads(ready_line),
            "SIDECAR_PROBE_READY_INVALID",
        )
        identity = require_record(
            ready.get("identity"),
            "SIDECAR_PROBE_IDENTITY_INVALID",
        )
        runtime = require_record(
            ready.get("environment"),
            "SIDECAR_PROBE_ENVIRONMENT_INVALID",
        )
        if (
            ready.get("type") != "ready"
            or runtime.get("actualDevice") != "cpu"
            or identity.get("indexBundleHash") != provider_hash
        ):
            raise ValueError("SIDECAR_PROBE_READY_MISMATCH")

        query_texts = [
            "我的海报标题、副标题和正文看起来都一样重，第一步先改哪里？",
            "如何做用户访谈并验证交互原型？",
        ]
        results: list[dict[str, object]] = []
        for query_text in query_texts:
            request_id = str(uuid.uuid4())
            request = {
                "v": 1,
                "type": "search",
                "id": request_id,
                "topK": 8,
                "query": {
                    "text": query_text,
                    "coursePackId": None,
                },
            }
            process.stdin.write(
                json.dumps(request, ensure_ascii=False, separators=(",", ":"))
                + "\n"
            )
            process.stdin.flush()
            response = require_record(
                json.loads(process.stdout.readline()),
                "SIDECAR_PROBE_RESULT_INVALID",
            )
            hits = response.get("hits")
            if (
                response.get("type") != "result"
                or response.get("id") != request_id
                or response.get("status") != "SUCCESS"
                or not isinstance(hits, list)
                or not hits
            ):
                raise ValueError("SIDECAR_PROBE_SEARCH_FAILED")
            timing = require_record(
                response.get("timing"),
                "SIDECAR_PROBE_TIMING_INVALID",
            )
            first_hit = require_record(
                hits[0],
                "SIDECAR_PROBE_HIT_INVALID",
            )
            results.append({
                "query": query_text,
                "status": response.get("status"),
                "hitCount": len(hits),
                "firstObjectId": first_hit.get("objectId"),
                "firstNodeId": first_hit.get("nodeId"),
                "inferenceMs": timing.get("inferenceMs"),
            })
        process.stdin.close()
        exit_code = process.wait(timeout=30)
        stderr = process.stderr.read()
        unexpected_stderr = [
            line
            for line in stderr.splitlines()
            if line.strip() and "Loading weights:" not in line
        ]
        if exit_code != 0 or unexpected_stderr:
            raise ValueError(
                f"SIDECAR_PROBE_EXIT_INVALID:{exit_code}:{stderr[-2000:]}"
            )
        report = {
            "ok": True,
            "status": "LINUX_TEXT_SIDECAR_GO",
            "packageAttemptId": manifest.get("attemptId"),
            "sourceCommit": require_record(
                manifest.get("source"),
                "SIDECAR_PROBE_SOURCE_INVALID",
            ).get("commit"),
            "providerIndexHash": provider_hash,
            "pythonVersion": platform.python_version(),
            "runtime": runtime,
            "startupMs": round((time.perf_counter() - started) * 1000),
            "queries": results,
            "processExited": True,
            "sidecarStderr": (
                "MODEL_WEIGHT_PROGRESS_ONLY" if stderr.strip() else "EMPTY"
            ),
            "networkMode": "OFFLINE",
        }
        sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        return 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        sys.stderr.write(f"{type(error).__name__}:{error}\n")
        raise SystemExit(1)

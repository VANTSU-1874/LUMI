"""Isolated, offline T4.4-3B BGE reranker shadow evaluator.

The runtime input intentionally contains questions and retrieval candidates but
never qrels.  Model snapshots and the frozen BGE text index are verified before
any model is loaded.  The scoring command performs no network or application
configuration access.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import platform
import re
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator


SCHEMA_VERSION = 1
MODEL_ID = "BAAI/bge-reranker-base"
MODEL_REVISION = "2cfc18c9415c912f9d8155881c133215df768a70"
MODEL_LICENSE = "MIT"
MODEL_MAX_LENGTH = 512
MODEL_HIDDEN_SIZE = 768
MODEL_LAYERS = 12
MODEL_REQUIRED_FILES = (
    "README.md",
    "config.json",
    "model.safetensors",
    "sentencepiece.bpe.model",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
)
TOP_M = 5
TOP_K = 8
MAX_PER_OBJECT = 3
REPETITIONS = 3
BATCH_SIZE = 32
EXPECTED_CASES = 50
MAX_CANDIDATES = 55
INPUT_KIND = "T44_RERANKER_SHADOW_INPUT"
OUTPUT_KIND = "T44_RERANKER_SHADOW_SCORES"
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NODE_ID_PATTERN = re.compile(r"^node-[0-9a-f]{64}$")
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
TEXT_TOOL_PATH = (
    WORKSPACE_ROOT / "tools" / "text-retrieval" / "text_retrieval.py"
)
TEXT_SPEC = importlib.util.spec_from_file_location(
    "lumi_t44_text_retrieval",
    TEXT_TOOL_PATH,
)
if TEXT_SPEC is None or TEXT_SPEC.loader is None:
    raise RuntimeError("T44_TEXT_RETRIEVAL_MODULE_UNAVAILABLE")
TEXT = importlib.util.module_from_spec(TEXT_SPEC)
TEXT_SPEC.loader.exec_module(TEXT)


def stable_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_stable(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode("utf-8"))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )


def require_exact_keys(
    value: Any,
    expected: set[str],
    code: str,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(code)
    return value


def require_string(
    value: Any,
    code: str,
    maximum: int,
) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or value != value.strip()
        or len(value) > maximum
    ):
        raise ValueError(code)
    return value


def require_hash(value: Any, code: str) -> str:
    if not isinstance(value, str) or HASH_PATTERN.fullmatch(value) is None:
        raise ValueError(code)
    return value


def require_id(value: Any, code: str) -> str:
    if not isinstance(value, str) or ID_PATTERN.fullmatch(value) is None:
        raise ValueError(code)
    return value


def require_node_id(value: Any, code: str) -> str:
    if not isinstance(value, str) or NODE_ID_PATTERN.fullmatch(value) is None:
        raise ValueError(code)
    return value


def relative_files(root: Path) -> Iterator[Path]:
    for candidate in sorted(
        root.rglob("*"),
        key=lambda item: item.as_posix(),
    ):
        if candidate.is_symlink():
            raise ValueError("T44_RERANKER_MODEL_SYMLINK_NOT_ALLOWED")
        if candidate.is_file():
            yield candidate


def validate_model_contract(model_dir: Path) -> dict[str, Any]:
    resolved = model_dir.resolve(strict=True)
    if resolved.name != MODEL_REVISION:
        raise ValueError("T44_RERANKER_MODEL_REVISION_PATH_INVALID")
    observed_files = tuple(
        candidate.relative_to(resolved).as_posix()
        for candidate in relative_files(resolved)
    )
    if observed_files != MODEL_REQUIRED_FILES:
        raise ValueError("T44_RERANKER_MODEL_FILE_SET_INVALID")
    config = require_exact_keys(
        read_json(resolved / "config.json"),
        set(read_json(resolved / "config.json")),
        "T44_RERANKER_MODEL_CONFIG_INVALID",
    )
    if (
        config.get("model_type") != "xlm-roberta"
        or config.get("hidden_size") != MODEL_HIDDEN_SIZE
        or config.get("num_hidden_layers") != MODEL_LAYERS
        or config.get("max_position_embeddings") != 514
        or config.get("architectures")
        != ["XLMRobertaForSequenceClassification"]
    ):
        raise ValueError("T44_RERANKER_MODEL_CONFIG_DRIFT")
    readme = (resolved / "README.md").read_text(encoding="utf-8")
    if re.search(r"(?im)^license:\s*mit\s*$", readme) is None:
        raise ValueError("T44_RERANKER_MODEL_LICENSE_DRIFT")
    return config


def model_snapshot_seal(model_dir: Path) -> dict[str, Any]:
    resolved = model_dir.resolve(strict=True)
    validate_model_contract(resolved)
    files = [
        {
            "path": candidate.relative_to(resolved).as_posix(),
            "sizeBytes": candidate.stat().st_size,
            "sha256": sha256_file(candidate),
        }
        for candidate in relative_files(resolved)
    ]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "modelId": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "license": MODEL_LICENSE,
        "directorySha256": sha256_stable(files),
        "files": files,
    }


def verify_model_snapshot(
    model_dir: Path,
    seal_path: Path,
) -> tuple[str, str]:
    resolved_seal = seal_path.resolve(strict=True)
    if resolved_seal.is_symlink():
        raise ValueError("T44_RERANKER_MODEL_SEAL_SYMLINK_NOT_ALLOWED")
    observed = read_json(resolved_seal)
    expected = model_snapshot_seal(model_dir)
    if observed != expected:
        raise ValueError("T44_RERANKER_MODEL_SNAPSHOT_DRIFT")
    return expected["directorySha256"], sha256_file(resolved_seal)


def download_model(args: argparse.Namespace) -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    cache_dir = args.cache_dir.resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)
    local = snapshot_download(
        repo_id=MODEL_ID,
        revision=MODEL_REVISION,
        cache_dir=str(cache_dir),
        allow_patterns=list(MODEL_REQUIRED_FILES),
        local_files_only=False,
    )
    model_dir = Path(local).resolve(strict=True)
    seal = model_snapshot_seal(model_dir)
    seal_path = args.seal_path.resolve()
    seal_path.parent.mkdir(parents=True, exist_ok=True)
    if seal_path.exists():
        if read_json(seal_path) != seal:
            raise ValueError("T44_RERANKER_EXISTING_SEAL_CONFLICT")
    else:
        draft = seal_path.with_name(
            f".{seal_path.name}.{uuid.uuid4()}.tmp",
        )
        write_json(draft, seal)
        draft.replace(seal_path)
    return {
        "modelId": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "license": MODEL_LICENSE,
        "modelDirectory": str(model_dir),
        "modelDirectorySha256": seal["directorySha256"],
        "modelSeal": str(seal_path),
        "modelSealSha256": sha256_file(seal_path),
        "fileCount": len(seal["files"]),
        "totalBytes": sum(
            record["sizeBytes"] for record in seal["files"]
        ),
    }


def validate_shadow_input(value: Any) -> dict[str, Any]:
    root = require_exact_keys(
        value,
        {
            "schemaVersion",
            "kind",
            "config",
            "runtimeSuite",
            "corpusBundleHash",
            "cases",
        },
        "T44_RERANKER_INPUT_KEYS_INVALID",
    )
    if (
        root["schemaVersion"] != SCHEMA_VERSION
        or root["kind"] != INPUT_KIND
    ):
        raise ValueError("T44_RERANKER_INPUT_SCHEMA_INVALID")
    config = require_exact_keys(
        root["config"],
        {
            "topM",
            "topK",
            "maxPerObject",
            "repetitions",
            "batchSize",
            "maxLength",
        },
        "T44_RERANKER_INPUT_CONFIG_INVALID",
    )
    if config != {
        "topM": TOP_M,
        "topK": TOP_K,
        "maxPerObject": MAX_PER_OBJECT,
        "repetitions": REPETITIONS,
        "batchSize": BATCH_SIZE,
        "maxLength": MODEL_MAX_LENGTH,
    }:
        raise ValueError("T44_RERANKER_INPUT_CONFIG_DRIFT")
    runtime_suite = require_exact_keys(
        root["runtimeSuite"],
        {"id", "version", "suiteHash"},
        "T44_RERANKER_RUNTIME_SUITE_INVALID",
    )
    require_id(
        runtime_suite["id"],
        "T44_RERANKER_RUNTIME_SUITE_ID_INVALID",
    )
    require_string(
        runtime_suite["version"],
        "T44_RERANKER_RUNTIME_SUITE_VERSION_INVALID",
        100,
    )
    require_hash(
        runtime_suite["suiteHash"],
        "T44_RERANKER_RUNTIME_SUITE_HASH_INVALID",
    )
    require_hash(
        root["corpusBundleHash"],
        "T44_RERANKER_CORPUS_HASH_INVALID",
    )
    cases = root["cases"]
    if not isinstance(cases, list) or len(cases) != EXPECTED_CASES:
        raise ValueError("T44_RERANKER_CASE_COUNT_INVALID")
    case_ids: set[str] = set()
    for test_case in cases:
        case = require_exact_keys(
            test_case,
            {
                "caseId",
                "question",
                "coursePackId",
                "coursePackVersion",
                "objectRanking",
                "candidates",
            },
            "T44_RERANKER_CASE_KEYS_INVALID",
        )
        case_id = require_id(
            case["caseId"],
            "T44_RERANKER_CASE_ID_INVALID",
        )
        if case_id in case_ids:
            raise ValueError("T44_RERANKER_CASE_ID_DUPLICATE")
        case_ids.add(case_id)
        require_string(
            case["question"],
            "T44_RERANKER_QUESTION_INVALID",
            500,
        )
        course_pack_id = require_id(
            case["coursePackId"],
            "T44_RERANKER_COURSE_PACK_INVALID",
        )
        if case["coursePackVersion"] != "1":
            raise ValueError("T44_RERANKER_COURSE_VERSION_INVALID")
        ranking = case["objectRanking"]
        if (
            not isinstance(ranking, list)
            or not 0 <= len(ranking) <= 10
        ):
            raise ValueError("T44_RERANKER_OBJECT_RANKING_INVALID")
        object_ids: list[str] = []
        for index, ranked in enumerate(ranking, start=1):
            row = require_exact_keys(
                ranked,
                {"objectId", "rank"},
                "T44_RERANKER_OBJECT_RANKING_ROW_INVALID",
            )
            object_ids.append(
                require_id(
                    row["objectId"],
                    "T44_RERANKER_OBJECT_ID_INVALID",
                ),
            )
            if row["rank"] != index:
                raise ValueError(
                    "T44_RERANKER_OBJECT_RANKING_ORDER_INVALID",
                )
        if len(set(object_ids)) != len(object_ids):
            raise ValueError("T44_RERANKER_OBJECT_RANKING_DUPLICATE")
        candidates = case["candidates"]
        if (
            not isinstance(candidates, list)
            or not 0 <= len(candidates) <= MAX_CANDIDATES
        ):
            raise ValueError("T44_RERANKER_CANDIDATE_COUNT_INVALID")
        candidate_ids: set[str] = set()
        top_object_ids = set(object_ids[:TOP_M])
        for candidate in candidates:
            row = require_exact_keys(
                candidate,
                {
                    "nodeId",
                    "objectId",
                    "coursePackId",
                    "contentHash",
                    "text",
                    "tensorOffset",
                },
                "T44_RERANKER_CANDIDATE_KEYS_INVALID",
            )
            node_id = require_node_id(
                row["nodeId"],
                "T44_RERANKER_CANDIDATE_NODE_ID_INVALID",
            )
            if node_id in candidate_ids:
                raise ValueError(
                    "T44_RERANKER_CANDIDATE_NODE_ID_DUPLICATE",
                )
            candidate_ids.add(node_id)
            object_id = require_id(
                row["objectId"],
                "T44_RERANKER_CANDIDATE_OBJECT_ID_INVALID",
            )
            if object_id not in top_object_ids:
                raise ValueError(
                    "T44_RERANKER_CANDIDATE_OUTSIDE_TOP_M",
                )
            if row["coursePackId"] != course_pack_id:
                raise ValueError(
                    "T44_RERANKER_CANDIDATE_COURSE_SCOPE_INVALID",
                )
            require_hash(
                row["contentHash"],
                "T44_RERANKER_CANDIDATE_CONTENT_HASH_INVALID",
            )
            require_string(
                row["text"],
                "T44_RERANKER_CANDIDATE_TEXT_INVALID",
                20_000,
            )
            if (
                not isinstance(row["tensorOffset"], int)
                or isinstance(row["tensorOffset"], bool)
                or row["tensorOffset"] < 0
            ):
                raise ValueError(
                    "T44_RERANKER_CANDIDATE_OFFSET_INVALID",
                )
    if not any(test_case["candidates"] for test_case in cases):
        raise ValueError("T44_RERANKER_ALL_CANDIDATES_EMPTY")
    return root


def verify_runtime_bindings(
    runtime_input: dict[str, Any],
    corpus_path: Path,
    text_model_dir: Path,
    text_model_seal: Path,
    text_index_dir: Path,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    corpus = TEXT.verify_corpus_bundle(read_json(
        corpus_path.resolve(strict=True),
    ))
    if corpus["bundleHash"] != runtime_input["corpusBundleHash"]:
        raise ValueError("T44_RERANKER_CORPUS_IDENTITY_DRIFT")
    manifest = TEXT.verify_index_manifest(
        text_index_dir.resolve(strict=True),
    )
    model_hash, seal_hash = TEXT.verify_model_snapshot(
        text_model_dir.resolve(strict=True),
        text_model_seal.resolve(strict=True),
    )
    if (
        manifest["identity"]["corpusBundleHash"]
        != corpus["bundleHash"]
        or manifest["model"]["directorySha256"] != model_hash
        or manifest["model"]["sealSha256"] != seal_hash
    ):
        raise ValueError("T44_RERANKER_TEXT_INDEX_BINDING_DRIFT")
    extracted = {
        record["nodeId"]: record
        for record in TEXT.extract_records(corpus)
        if (
            record["sourceKind"] == "NODE"
            and (
                (
                    record["nodeKind"] == "TEXT"
                    and record["role"] in ("FACT", "ACTION")
                )
                or record["nodeKind"] == "TABLE"
            )
        )
    }
    entries_by_node: dict[str, dict[str, Any]] = {}
    for entry in manifest["entries"]:
        node_id = entry["nodeId"]
        if node_id in extracted:
            if node_id in entries_by_node:
                raise ValueError(
                    "T44_RERANKER_TEXT_INDEX_NODE_DUPLICATE",
                )
            entries_by_node[node_id] = entry
    for test_case in runtime_input["cases"]:
        for candidate in test_case["candidates"]:
            node_id = candidate["nodeId"]
            entry = entries_by_node.get(node_id)
            record = extracted.get(node_id)
            if entry is None or record is None:
                raise ValueError(
                    "T44_RERANKER_CANDIDATE_NOT_IN_TEXT_INDEX",
                )
            if (
                entry["objectId"] != candidate["objectId"]
                or entry["coursePackId"] != candidate["coursePackId"]
                or entry["contentHash"] != candidate["contentHash"]
                or entry["tensorOffset"] != candidate["tensorOffset"]
                or record["objectId"] != candidate["objectId"]
                or record["coursePackId"] != candidate["coursePackId"]
                or record["contentHash"] != candidate["contentHash"]
                or record["text"] != candidate["text"]
            ):
                raise ValueError(
                    "T44_RERANKER_CANDIDATE_BINDING_DRIFT",
                )
    return manifest, entries_by_node


def synchronize(torch: Any, device: str) -> None:
    if device == "cuda":
        torch.cuda.synchronize()


def timed_scores(
    torch: Any,
    device: str,
    score: Callable[[], list[float]],
) -> tuple[list[float], list[float]]:
    samples: list[float] = []
    final_scores: list[float] | None = None
    for _ in range(REPETITIONS):
        synchronize(torch, device)
        started = time.perf_counter()
        observed = score()
        synchronize(torch, device)
        samples.append((time.perf_counter() - started) * 1000)
        if (
            not observed
            or any(not math.isfinite(value) for value in observed)
        ):
            raise ValueError("T44_RERANKER_SCORE_INVALID")
        if final_scores is not None and any(
            abs(left - right) > 1e-4
            for left, right in zip(final_scores, observed, strict=True)
        ):
            raise ValueError("T44_RERANKER_SCORE_NONDETERMINISTIC")
        final_scores = observed
    assert final_scores is not None
    return final_scores, samples


def median(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def rank_scores(
    candidates: list[dict[str, Any]],
    scores: list[float],
) -> list[dict[str, Any]]:
    ranked = [
        {
            "nodeId": candidate["nodeId"],
            "objectId": candidate["objectId"],
            "coursePackId": candidate["coursePackId"],
            "score": score,
        }
        for candidate, score in zip(candidates, scores, strict=True)
    ]
    ranked.sort(key=lambda row: (-row["score"], row["nodeId"]))
    return [
        {**row, "rank": rank}
        for rank, row in enumerate(ranked, start=1)
    ]


def score_baseline(
    runtime_input: dict[str, Any],
    text_model_dir: Path,
    text_index_dir: Path,
    device: str,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    import safetensors
    import torch
    import transformers
    from safetensors.torch import load_file

    encoder = TEXT.BgeEncoder(text_model_dir, device)
    embeddings = load_file(
        str(text_index_dir / TEXT.PAYLOAD_NAME),
        device=device,
    )["embeddings"]
    first = next(
        test_case
        for test_case in runtime_input["cases"]
        if test_case["candidates"]
    )
    first_offsets = [
        candidate["tensorOffset"]
        for candidate in first["candidates"]
    ]
    query = encoder.encode([first["question"]], query=True)[0]
    _ = embeddings[first_offsets] @ query.to(embeddings.device)
    synchronize(torch, device)
    results: dict[str, dict[str, Any]] = {}
    for test_case in runtime_input["cases"]:
        candidates = test_case["candidates"]
        if not candidates:
            results[test_case["caseId"]] = {
                "timingMs": {
                    "samples": [0.0] * REPETITIONS,
                    "median": 0.0,
                },
                "ranking": [],
            }
            continue
        offsets = [
            candidate["tensorOffset"]
            for candidate in candidates
        ]

        def score() -> list[float]:
            query_embedding = encoder.encode(
                [test_case["question"]],
                query=True,
            )[0].to(embeddings.device)
            tensor_scores = embeddings[offsets] @ query_embedding
            return [
                float(value)
                for value in tensor_scores.detach().cpu().tolist()
            ]

        scores, samples = timed_scores(torch, device, score)
        results[test_case["caseId"]] = {
            "timingMs": {
                "samples": samples,
                "median": median(samples),
            },
            "ranking": rank_scores(candidates, scores),
        }
    environment = {
        "pythonVersion": platform.python_version(),
        "torchVersion": torch.__version__,
        "transformersVersion": transformers.__version__,
        "safetensorsVersion": safetensors.__version__,
        "actualDevice": encoder.device.type,
        "cudaRuntime": torch.version.cuda if device == "cuda" else None,
        "deviceName": (
            torch.cuda.get_device_name(encoder.device)
            if device == "cuda"
            else None
        ),
        "baselineTokenizerClassName":
            type(encoder.tokenizer).__name__,
    }
    del embeddings
    del encoder
    if device == "cuda":
        torch.cuda.empty_cache()
    return results, environment


class LocalReranker:
    def __init__(
        self,
        model_dir: Path,
        device: str,
    ) -> None:
        import torch
        from transformers import (
            AutoModelForSequenceClassification,
            AutoTokenizer,
        )

        if device == "cuda" and not torch.cuda.is_available():
            raise ValueError("CUDA_UNAVAILABLE")
        self.torch = torch
        self.device = torch.device(device)
        self.tokenizer = AutoTokenizer.from_pretrained(
            str(model_dir.resolve(strict=True)),
            local_files_only=True,
            trust_remote_code=False,
        )
        self.model = AutoModelForSequenceClassification.from_pretrained(
            str(model_dir.resolve(strict=True)),
            local_files_only=True,
            trust_remote_code=False,
            use_safetensors=True,
        )
        if device == "cuda":
            self.model = self.model.to(
                device=self.device,
                dtype=torch.float16,
            )
        else:
            self.model = self.model.to(self.device)
        self.model.eval()
        if (
            getattr(self.model.config, "hidden_size", None)
            != MODEL_HIDDEN_SIZE
            or getattr(self.model.config, "num_hidden_layers", None)
            != MODEL_LAYERS
        ):
            raise ValueError("T44_RERANKER_MODEL_RUNTIME_DRIFT")

    def score(self, question: str, texts: list[str]) -> list[float]:
        scores: list[float] = []
        torch = self.torch
        for start in range(0, len(texts), BATCH_SIZE):
            batch = texts[start:start + BATCH_SIZE]
            encoded = self.tokenizer(
                [question] * len(batch),
                batch,
                padding=True,
                truncation=True,
                max_length=MODEL_MAX_LENGTH,
                return_tensors="pt",
            )
            encoded = {
                key: value.to(self.device)
                for key, value in encoded.items()
            }
            with torch.inference_mode():
                logits = self.model(**encoded).logits.reshape(-1)
            scores.extend(
                float(value)
                for value in logits.detach().float().cpu().tolist()
            )
        return scores


def score_reranker(
    runtime_input: dict[str, Any],
    model_dir: Path,
    device: str,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    import torch
    import transformers

    reranker = LocalReranker(model_dir, device)
    first = next(
        test_case
        for test_case in runtime_input["cases"]
        if test_case["candidates"]
    )
    reranker.score(
        first["question"],
        [candidate["text"] for candidate in first["candidates"][:2]],
    )
    synchronize(torch, device)
    results: dict[str, dict[str, Any]] = {}
    for test_case in runtime_input["cases"]:
        candidates = test_case["candidates"]
        if not candidates:
            results[test_case["caseId"]] = {
                "timingMs": {
                    "samples": [0.0] * REPETITIONS,
                    "median": 0.0,
                },
                "ranking": [],
            }
            continue
        texts = [candidate["text"] for candidate in candidates]

        def score() -> list[float]:
            return reranker.score(test_case["question"], texts)

        scores, samples = timed_scores(torch, device, score)
        results[test_case["caseId"]] = {
            "timingMs": {
                "samples": samples,
                "median": median(samples),
            },
            "ranking": rank_scores(candidates, scores),
        }
    environment = {
        "rerankerTokenizerClassName":
            type(reranker.tokenizer).__name__,
        "rerankerModelClassName": type(reranker.model).__name__,
        "rerankerDtype": str(next(
            reranker.model.parameters(),
        ).dtype),
        "transformersVersion": transformers.__version__,
    }
    del reranker
    if device == "cuda":
        torch.cuda.empty_cache()
    return results, environment


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    if sys.version_info[:2] != (3, 12):
        raise ValueError("PYTHON_VERSION_UNSUPPORTED")
    runtime_input = validate_shadow_input(
        read_json(args.input.resolve(strict=True)),
    )
    model_dir = args.model_dir.resolve(strict=True)
    model_hash, model_seal_hash = verify_model_snapshot(
        model_dir,
        args.model_seal,
    )
    text_model_dir = args.text_model_dir.resolve(strict=True)
    text_index_dir = args.text_index_dir.resolve(strict=True)
    manifest, _ = verify_runtime_bindings(
        runtime_input,
        args.corpus,
        text_model_dir,
        args.text_model_seal,
        text_index_dir,
    )
    baseline, environment = score_baseline(
        runtime_input,
        text_model_dir,
        text_index_dir,
        args.device,
    )
    reranker, reranker_environment = score_reranker(
        runtime_input,
        model_dir,
        args.device,
    )
    cases = []
    for test_case in runtime_input["cases"]:
        case_id = test_case["caseId"]
        candidates = test_case["candidates"]
        cases.append({
            "caseId": case_id,
            "coursePackId": test_case["coursePackId"],
            "objectRanking": test_case["objectRanking"],
            "candidateCount": len(candidates),
            "candidateNodeIdsSha256": sha256_stable([
                candidate["nodeId"]
                for candidate in candidates
            ]),
            "arms": {
                "A_BGE_NODE_SCORE": baseline[case_id],
                "B_BGE_RERANKER_BASE": reranker[case_id],
            },
        })
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": OUTPUT_KIND,
        "runtimeSuite": runtime_input["runtimeSuite"],
        "corpusBundleHash": runtime_input["corpusBundleHash"],
        "config": runtime_input["config"],
        "configHash": sha256_stable(runtime_input["config"]),
        "models": {
            "baseline": {
                "modelId": TEXT.MODEL_ID,
                "modelRevision": TEXT.MODEL_REVISION,
                "modelLicense": TEXT.MODEL_LICENSE,
                "modelDirectorySha256":
                    manifest["model"]["directorySha256"],
                "modelSealSha256": manifest["model"]["sealSha256"],
                "indexBundleHash":
                    manifest["identity"]["indexBundleHash"],
                "indexPayloadSha256": manifest["payload"]["sha256"],
            },
            "candidate": {
                "modelId": MODEL_ID,
                "modelRevision": MODEL_REVISION,
                "modelLicense": MODEL_LICENSE,
                "modelDirectorySha256": model_hash,
                "modelSealSha256": model_seal_hash,
            },
        },
        "environment": {
            **environment,
            **reranker_environment,
        },
        "timingProtocol": {
            "warmupRunsPerModel": 1,
            "repetitionsPerCase": REPETITIONS,
            "caseAggregate": "MEDIAN",
            "suiteAggregate": "P95_NEAREST_RANK",
            "baselineBoundary":
                "QUERY_TOKENIZE_ENCODE_PLUS_CANDIDATE_DOT_PRODUCT",
            "candidateBoundary":
                "PAIR_TOKENIZE_PLUS_CROSS_ENCODER_LOGITS",
        },
        "cases": cases,
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Lumi isolated T4.4 BGE reranker shadow evaluator",
    )
    subparsers = result.add_subparsers(
        dest="command",
        required=True,
    )
    download = subparsers.add_parser("download")
    download.add_argument("--cache-dir", type=Path, required=True)
    download.add_argument("--seal-path", type=Path, required=True)

    score = subparsers.add_parser("evaluate")
    score.add_argument("--input", type=Path, required=True)
    score.add_argument("--corpus", type=Path, required=True)
    score.add_argument("--model-dir", type=Path, required=True)
    score.add_argument("--model-seal", type=Path, required=True)
    score.add_argument("--text-model-dir", type=Path, required=True)
    score.add_argument("--text-model-seal", type=Path, required=True)
    score.add_argument("--text-index-dir", type=Path, required=True)
    score.add_argument(
        "--device",
        choices=("cuda", "cpu"),
        default="cuda",
    )
    return result


def main(argv: Iterable[str] | None = None) -> int:
    args = parser().parse_args(argv)
    output = (
        download_model(args)
        if args.command == "download"
        else evaluate(args)
    )
    sys.stdout.write(stable_json(output) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

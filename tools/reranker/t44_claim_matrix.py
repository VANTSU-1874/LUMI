"""Offline T4.4-3C BGE claim-node matrix scorer.

The input is the byte-sealed, label-blind candidate artifact.  It contains
questions, deterministic support claims, canonical candidate nodes, and
provider audit traces, but never qrels.  This tool verifies the frozen corpus,
model snapshot, and text index before loading the local BGE model.
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
from pathlib import Path
from typing import Any, Callable, Iterable


SCHEMA_VERSION = 1
INPUT_KIND = "T44_CLAIM_CANDIDATE_RUNTIME_INPUT"
OUTPUT_KIND = "T44_CLAIM_NODE_MATRIX_SCORES"
MIN_CASES = 1
MAX_CASES = 50
MAX_CLAIMS = 4
MAX_PROBES = 5
MAX_OBJECTS = 16
MAX_CANDIDATES = 176
REPETITIONS = 3
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
NODE_ID_PATTERN = re.compile(r"^node-[0-9a-f]{64}$")
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
TEXT_TOOL_PATH = (
    WORKSPACE_ROOT / "tools" / "text-retrieval" / "text_retrieval.py"
)
TEXT_SPEC = importlib.util.spec_from_file_location(
    "lumi_t44_claim_text_retrieval",
    TEXT_TOOL_PATH,
)
if TEXT_SPEC is None or TEXT_SPEC.loader is None:
    raise RuntimeError("T44_CLAIM_TEXT_RETRIEVAL_MODULE_UNAVAILABLE")
TEXT = importlib.util.module_from_spec(TEXT_SPEC)
TEXT_SPEC.loader.exec_module(TEXT)

SCORE_CONFIG = {
    "id": "lumi-t44-claim-node-matrix-v1",
    "version": "2026-07-29.1",
    "modelId": TEXT.MODEL_ID,
    "modelRevision": TEXT.MODEL_REVISION,
    "maxClaims": MAX_CLAIMS,
    "maximumCandidateNodes": MAX_CANDIDATES,
    "repetitions": REPETITIONS,
    "maxLength": TEXT.MAX_LENGTH,
    "aMatrixBoundary": "WHOLE_QUERY_ENCODE_PLUS_CANDIDATE_DOT_PRODUCT",
    "bMatrixBoundary":
        "WHOLE_AND_CLAIMS_BATCH_ENCODE_PLUS_CANDIDATE_MATRIX_PRODUCT",
}

CANDIDATE_CONFIG = {
    "id": "lumi-t44-claim-candidate-fusion-v1",
    "version": "2026-07-29.2",
    "rrfK": 60,
    "rawObjectLimitPerProbeChannel": 10,
    "wholeQueryChannelWeight": 1,
    "supportClaimTotalWeightPerChannel": 1,
    "reservation": "RANK_ONE_PER_SUPPORT_CLAIM_PER_HEALTHY_CHANNEL",
    "fillOrdering":
        "WEIGHTED_RRF_DESC_THEN_BEST_SOURCE_RANK_THEN_OBJECT_ID",
    "maximumObjects": 16,
    "eligibleAtomicNodes": [
        "TEXT/FACT",
        "TEXT/ACTION",
        "TABLE",
    ],
    "maximumAtomicNodesPerObject": 11,
    "maximumCandidateNodes": 176,
}
FORBIDDEN_LABEL_KEYS = {
    "qrels",
    "requiredEvidenceGroups",
    "acceptableNodeIds",
    "hardNegativeNodeIds",
    "expectedNodeIds",
    "goldenNodeIds",
}


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


def read_json_bytes(path: Path) -> tuple[Any, str]:
    content = path.read_bytes()
    return json.loads(content.decode("utf-8")), sha256_bytes(content)


def require_exact_keys(
    value: Any,
    expected: set[str],
    code: str,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(code)
    return value


def require_string(value: Any, code: str, maximum: int) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or value != value.strip()
        or len(value) > maximum
    ):
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


def require_hash(value: Any, code: str) -> str:
    if not isinstance(value, str) or HASH_PATTERN.fullmatch(value) is None:
        raise ValueError(code)
    return value


def require_int(
    value: Any,
    code: str,
    minimum: int,
    maximum: int,
) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or not minimum <= value <= maximum
    ):
        raise ValueError(code)
    return value


def reject_label_fields(value: Any) -> None:
    if isinstance(value, dict):
        forbidden = FORBIDDEN_LABEL_KEYS.intersection(value)
        if forbidden:
            raise ValueError(
                "T44_CLAIM_INPUT_LABEL_FIELD_FORBIDDEN:"
                + sorted(forbidden)[0],
            )
        for child in value.values():
            reject_label_fields(child)
    elif isinstance(value, list):
        for child in value:
            reject_label_fields(child)


def validate_decomposition(
    value: Any,
    normalized_question: str,
) -> dict[str, Any]:
    decomposition = require_exact_keys(
        value,
        {
            "schemaVersion",
            "kind",
            "decomposerId",
            "decomposerVersion",
            "configHash",
            "wholeQuery",
            "wholeQueryHash",
            "claims",
            "probes",
        },
        "T44_CLAIM_DECOMPOSITION_KEYS_INVALID",
    )
    if (
        decomposition["schemaVersion"] != 1
        or decomposition["kind"] != "QUERY_CLAIM_DECOMPOSITION"
        or decomposition["decomposerId"]
        != "lumi-query-claim-decomposer-v1"
        or decomposition["decomposerVersion"] != "2026-07-29.1"
        or decomposition["wholeQuery"] != normalized_question
        or decomposition["wholeQueryHash"]
        != sha256_stable(normalized_question)
    ):
        raise ValueError("T44_CLAIM_DECOMPOSITION_IDENTITY_INVALID")
    require_hash(
        decomposition["configHash"],
        "T44_CLAIM_DECOMPOSITION_CONFIG_HASH_INVALID",
    )
    claims = decomposition["claims"]
    if not isinstance(claims, list) or not 1 <= len(claims) <= MAX_CLAIMS:
        raise ValueError("T44_CLAIM_DECOMPOSITION_CLAIMS_INVALID")
    claim_ids: set[str] = set()
    for claim in claims:
        row = require_exact_keys(
            claim,
            {
                "claimId",
                "text",
                "textHash",
                "sourceRule",
                "sourceSpan",
            },
            "T44_CLAIM_DECOMPOSITION_CLAIM_KEYS_INVALID",
        )
        claim_id = require_id(
            row["claimId"],
            "T44_CLAIM_DECOMPOSITION_CLAIM_ID_INVALID",
        )
        text = require_string(
            row["text"],
            "T44_CLAIM_DECOMPOSITION_CLAIM_TEXT_INVALID",
            120,
        )
        if (
            claim_id in claim_ids
            or row["textHash"] != sha256_stable(text)
            or row["sourceRule"]
            not in ("CLAUSE", "CONJUNCT", "WHOLE_FALLBACK")
        ):
            raise ValueError("T44_CLAIM_DECOMPOSITION_CLAIM_INVALID")
        claim_ids.add(claim_id)
        span = require_exact_keys(
            row["sourceSpan"],
            {"startCodePoint", "endCodePoint"},
            "T44_CLAIM_DECOMPOSITION_SPAN_INVALID",
        )
        start = require_int(
            span["startCodePoint"],
            "T44_CLAIM_DECOMPOSITION_SPAN_INVALID",
            0,
            500,
        )
        end = require_int(
            span["endCodePoint"],
            "T44_CLAIM_DECOMPOSITION_SPAN_INVALID",
            1,
            500,
        )
        if end <= start:
            raise ValueError("T44_CLAIM_DECOMPOSITION_SPAN_INVALID")
    probes = decomposition["probes"]
    if not isinstance(probes, list) or not 1 <= len(probes) <= MAX_PROBES:
        raise ValueError("T44_CLAIM_DECOMPOSITION_PROBES_INVALID")
    probe_ids: set[str] = set()
    for probe in probes:
        row = require_exact_keys(
            probe,
            {"probeId", "kind", "text", "textHash", "claimIds"},
            "T44_CLAIM_DECOMPOSITION_PROBE_KEYS_INVALID",
        )
        probe_id = require_id(
            row["probeId"],
            "T44_CLAIM_DECOMPOSITION_PROBE_ID_INVALID",
        )
        text = require_string(
            row["text"],
            "T44_CLAIM_DECOMPOSITION_PROBE_TEXT_INVALID",
            500,
        )
        bound_claims = row["claimIds"]
        if (
            probe_id in probe_ids
            or row["kind"] not in ("WHOLE_QUERY", "SUPPORT_CLAIM")
            or row["textHash"] != sha256_stable(text)
            or not isinstance(bound_claims, list)
            or len(bound_claims) > 1
            or any(claim_id not in claim_ids for claim_id in bound_claims)
            or (
                row["kind"] == "SUPPORT_CLAIM"
                and len(bound_claims) != 1
            )
        ):
            raise ValueError("T44_CLAIM_DECOMPOSITION_PROBE_INVALID")
        probe_ids.add(probe_id)
    return decomposition


def validate_candidate_input(value: Any) -> dict[str, Any]:
    reject_label_fields(value)
    root = require_exact_keys(
        value,
        {
            "schemaVersion",
            "kind",
            "runtimeSuite",
            "corpusSnapshot",
            "config",
            "configHash",
            "expectedProviderCalls",
            "expectedChannelCalls",
            "cases",
        },
        "T44_CLAIM_INPUT_KEYS_INVALID",
    )
    if (
        root["schemaVersion"] != SCHEMA_VERSION
        or root["kind"] != INPUT_KIND
        or root["config"] != CANDIDATE_CONFIG
        or root["configHash"] != sha256_stable(root["config"])
    ):
        raise ValueError("T44_CLAIM_INPUT_IDENTITY_INVALID")
    runtime_suite = require_exact_keys(
        root["runtimeSuite"],
        {"id", "version", "suiteHash"},
        "T44_CLAIM_RUNTIME_SUITE_INVALID",
    )
    require_id(runtime_suite["id"], "T44_CLAIM_RUNTIME_ID_INVALID")
    require_string(
        runtime_suite["version"],
        "T44_CLAIM_RUNTIME_VERSION_INVALID",
        50,
    )
    require_hash(
        runtime_suite["suiteHash"],
        "T44_CLAIM_RUNTIME_HASH_INVALID",
    )
    corpus_snapshot = require_exact_keys(
        root["corpusSnapshot"],
        {"bundleHash"},
        "T44_CLAIM_CORPUS_SNAPSHOT_INVALID",
    )
    require_hash(
        corpus_snapshot["bundleHash"],
        "T44_CLAIM_CORPUS_HASH_INVALID",
    )
    cases = root["cases"]
    if (
        not isinstance(cases, list)
        or not MIN_CASES <= len(cases) <= MAX_CASES
    ):
        raise ValueError("T44_CLAIM_CASE_COUNT_INVALID")
    case_ids: set[str] = set()
    expected_calls = 0
    for test_case in cases:
        case = require_exact_keys(
            test_case,
            {
                "caseId",
                "coursePackId",
                "coursePackVersion",
                "normalizedQuestion",
                "decomposition",
                "expectedProviderCalls",
                "probeRankings",
                "objectRanking",
                "candidateNodes",
                "candidateNodeIdsSha256",
            },
            "T44_CLAIM_CASE_KEYS_INVALID",
        )
        case_id = require_id(
            case["caseId"],
            "T44_CLAIM_CASE_ID_INVALID",
        )
        if case_id in case_ids:
            raise ValueError("T44_CLAIM_CASE_ID_DUPLICATE")
        case_ids.add(case_id)
        course_pack_id = require_id(
            case["coursePackId"],
            "T44_CLAIM_COURSE_PACK_INVALID",
        )
        if case["coursePackVersion"] != "1":
            raise ValueError("T44_CLAIM_COURSE_VERSION_INVALID")
        question = require_string(
            case["normalizedQuestion"],
            "T44_CLAIM_QUESTION_INVALID",
            500,
        )
        decomposition = validate_decomposition(
            case["decomposition"],
            question,
        )
        case_calls = len(decomposition["probes"]) * 2
        if case["expectedProviderCalls"] != case_calls:
            raise ValueError("T44_CLAIM_EXPECTED_CALLS_INVALID")
        expected_calls += case_calls
        rankings = case["probeRankings"]
        if (
            not isinstance(rankings, list)
            or len(rankings) != len(decomposition["probes"])
        ):
            raise ValueError("T44_CLAIM_PROBE_RANKINGS_INVALID")
        object_ranking = case["objectRanking"]
        if (
            not isinstance(object_ranking, list)
            or len(object_ranking) > MAX_OBJECTS
        ):
            raise ValueError("T44_CLAIM_OBJECT_RANKING_INVALID")
        ranked_objects: dict[str, int] = {}
        for rank, candidate in enumerate(object_ranking, start=1):
            row = require_exact_keys(
                candidate,
                {
                    "objectId",
                    "coursePackId",
                    "rank",
                    "weightedRrfScore",
                    "bestSourceRank",
                    "reserved",
                    "reservations",
                    "sources",
                },
                "T44_CLAIM_OBJECT_RANKING_ROW_INVALID",
            )
            object_id = require_id(
                row["objectId"],
                "T44_CLAIM_OBJECT_ID_INVALID",
            )
            if (
                object_id in ranked_objects
                or row["coursePackId"] != course_pack_id
                or row["rank"] != rank
            ):
                raise ValueError("T44_CLAIM_OBJECT_RANKING_ORDER_INVALID")
            ranked_objects[object_id] = rank
        candidates = case["candidateNodes"]
        if (
            not isinstance(candidates, list)
            or len(candidates) > MAX_CANDIDATES
        ):
            raise ValueError("T44_CLAIM_CANDIDATES_INVALID")
        node_ids: list[str] = []
        for candidate in candidates:
            row = require_exact_keys(
                candidate,
                {
                    "nodeId",
                    "objectId",
                    "coursePackId",
                    "objectRank",
                    "kind",
                    "role",
                    "text",
                    "nodeContentHash",
                    "objectContentHash",
                    "sourceHash",
                },
                "T44_CLAIM_CANDIDATE_KEYS_INVALID",
            )
            node_id = require_node_id(
                row["nodeId"],
                "T44_CLAIM_CANDIDATE_NODE_ID_INVALID",
            )
            object_id = require_id(
                row["objectId"],
                "T44_CLAIM_CANDIDATE_OBJECT_ID_INVALID",
            )
            if (
                node_id in node_ids
                or row["coursePackId"] != course_pack_id
                or ranked_objects.get(object_id) != row["objectRank"]
                or (
                    row["kind"] == "TEXT"
                    and row["role"] not in ("FACT", "ACTION")
                )
                or (
                    row["kind"] == "TABLE"
                    and row["role"] is not None
                )
                or row["kind"] not in ("TEXT", "TABLE")
            ):
                raise ValueError("T44_CLAIM_CANDIDATE_BINDING_INVALID")
            node_ids.append(node_id)
            require_string(
                row["text"],
                "T44_CLAIM_CANDIDATE_TEXT_INVALID",
                32_000,
            )
            for key in (
                "nodeContentHash",
                "objectContentHash",
                "sourceHash",
            ):
                require_hash(
                    row[key],
                    "T44_CLAIM_CANDIDATE_HASH_INVALID",
                )
        if case["candidateNodeIdsSha256"] != sha256_stable(node_ids):
            raise ValueError("T44_CLAIM_CANDIDATE_SET_HASH_INVALID")
    channel_calls = require_exact_keys(
        root["expectedChannelCalls"],
        {"LEXICAL", "TEXT_VECTOR"},
        "T44_CLAIM_CHANNEL_CALLS_INVALID",
    )
    if (
        root["expectedProviderCalls"] != expected_calls
        or channel_calls["LEXICAL"] != expected_calls // 2
        or channel_calls["TEXT_VECTOR"] != expected_calls // 2
    ):
        raise ValueError("T44_CLAIM_PROVIDER_CALLS_INVALID")
    if not any(test_case["candidateNodes"] for test_case in cases):
        raise ValueError("T44_CLAIM_ALL_CANDIDATES_EMPTY")
    return root


def source_hash(knowledge_object: dict[str, Any]) -> str:
    return sha256_stable({
        "sourceIdentityBasis": knowledge_object["sourceIdentityBasis"],
        "provenance": knowledge_object["provenance"],
        "parser": knowledge_object["parser"],
        "contentVersion": knowledge_object["contentVersion"],
    })


def verify_runtime_bindings(
    runtime_input: dict[str, Any],
    corpus_path: Path,
    model_dir: Path,
    model_seal: Path,
    index_dir: Path,
) -> tuple[dict[str, Any], dict[str, list[int]]]:
    corpus = TEXT.verify_corpus_bundle(
        TEXT.read_json(corpus_path.resolve(strict=True)),
    )
    if (
        corpus["bundleHash"]
        != runtime_input["corpusSnapshot"]["bundleHash"]
    ):
        raise ValueError("T44_CLAIM_CORPUS_IDENTITY_DRIFT")
    manifest = TEXT.verify_index_manifest(
        index_dir.resolve(strict=True),
    )
    model_hash, seal_hash = TEXT.verify_model_snapshot(
        model_dir.resolve(strict=True),
        model_seal.resolve(strict=True),
    )
    if (
        manifest["identity"]["corpusBundleHash"]
        != corpus["bundleHash"]
        or manifest["model"]["directorySha256"] != model_hash
        or manifest["model"]["sealSha256"] != seal_hash
    ):
        raise ValueError("T44_CLAIM_TEXT_INDEX_BINDING_DRIFT")
    records = {
        record["nodeId"]: record
        for record in TEXT.extract_records(corpus)
        if (
            record["sourceKind"] == "NODE"
            and record["nodeKind"] == "TEXT"
            and record["role"] in ("FACT", "ACTION")
        )
    }
    entries: dict[str, dict[str, Any]] = {}
    for entry in manifest["entries"]:
        node_id = entry["nodeId"]
        if node_id in records:
            if node_id in entries:
                raise ValueError("T44_CLAIM_INDEX_NODE_DUPLICATE")
            entries[node_id] = entry
    objects = {
        knowledge_object["id"]: knowledge_object
        for knowledge_object in corpus["objects"]
    }
    nodes = {
        node["id"]: (knowledge_object, node)
        for knowledge_object in corpus["objects"]
        for node in knowledge_object["nodes"]
    }
    offsets_by_case: dict[str, list[int]] = {}
    for test_case in runtime_input["cases"]:
        offsets: list[int] = []
        for candidate in test_case["candidateNodes"]:
            if candidate["kind"] == "TABLE":
                raise ValueError("T44_CLAIM_TABLE_INDEX_UNAVAILABLE")
            binding = nodes.get(candidate["nodeId"])
            knowledge_object = objects.get(candidate["objectId"])
            entry = entries.get(candidate["nodeId"])
            record = records.get(candidate["nodeId"])
            if (
                binding is None
                or knowledge_object is None
                or entry is None
                or record is None
                or binding[0]["id"] != candidate["objectId"]
                or binding[1]["kind"] != "TEXT"
                or binding[1]["role"] != candidate["role"]
                or binding[1]["text"] != candidate["text"]
                or binding[1]["contentHash"]
                != candidate["nodeContentHash"]
                or knowledge_object["contentHash"]
                != candidate["objectContentHash"]
                or source_hash(knowledge_object)
                != candidate["sourceHash"]
                or knowledge_object["sourceCoursePack"]["id"]
                != candidate["coursePackId"]
                or entry["objectId"] != candidate["objectId"]
                or entry["coursePackId"] != candidate["coursePackId"]
                or entry["contentHash"]
                != candidate["nodeContentHash"]
                or record["objectId"] != candidate["objectId"]
                or record["coursePackId"] != candidate["coursePackId"]
                or record["contentHash"]
                != candidate["nodeContentHash"]
            ):
                raise ValueError("T44_CLAIM_CANDIDATE_INDEX_DRIFT")
            offsets.append(entry["tensorOffset"])
        offsets_by_case[test_case["caseId"]] = offsets
    return manifest, offsets_by_case


def synchronize(torch: Any, device: str) -> None:
    if device == "cuda":
        torch.cuda.synchronize()


def median(values: list[float]) -> float:
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def timed_matrix(
    torch: Any,
    device: str,
    score: Callable[[], list[list[float]]],
) -> tuple[list[list[float]], list[float]]:
    samples: list[float] = []
    final_scores: list[list[float]] | None = None
    for _ in range(REPETITIONS):
        synchronize(torch, device)
        started = time.perf_counter()
        observed = score()
        synchronize(torch, device)
        samples.append((time.perf_counter() - started) * 1000)
        if (
            not observed
            or any(
                not math.isfinite(value)
                for row in observed
                for value in row
            )
        ):
            raise ValueError("T44_CLAIM_MATRIX_SCORE_INVALID")
        if final_scores is not None:
            flattened_left = [
                value for row in final_scores for value in row
            ]
            flattened_right = [
                value for row in observed for value in row
            ]
            if (
                len(flattened_left) != len(flattened_right)
                or any(
                    abs(left - right) > 1e-4
                    for left, right in zip(
                        flattened_left,
                        flattened_right,
                        strict=True,
                    )
                )
            ):
                raise ValueError("T44_CLAIM_MATRIX_NONDETERMINISTIC")
        final_scores = observed
    assert final_scores is not None
    return final_scores, samples


def rank_scores(
    candidates: list[dict[str, Any]],
    scores: list[float],
) -> list[dict[str, Any]]:
    if len(candidates) != len(scores):
        raise ValueError("T44_CLAIM_MATRIX_SHAPE_INVALID")
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


def score_matrices(
    runtime_input: dict[str, Any],
    offsets_by_case: dict[str, list[int]],
    model_dir: Path,
    index_dir: Path,
    device: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    import safetensors
    import torch
    import transformers
    from safetensors.torch import load_file

    encoder = TEXT.BgeEncoder(model_dir, device)
    embeddings = load_file(
        str(index_dir / TEXT.PAYLOAD_NAME),
        device=device,
    )["embeddings"]
    first = next(
        test_case
        for test_case in runtime_input["cases"]
        if test_case["candidateNodes"]
    )
    warmup_texts = [
        first["normalizedQuestion"],
        *[
            claim["text"]
            for claim in first["decomposition"]["claims"]
        ],
    ]
    warmup_offsets = offsets_by_case[first["caseId"]]
    warmup_queries = encoder.encode(warmup_texts, query=True)
    _ = (
        warmup_queries.to(embeddings.device)
        @ embeddings[warmup_offsets].T
    )
    synchronize(torch, device)

    cases: list[dict[str, Any]] = []
    for test_case in runtime_input["cases"]:
        candidates = test_case["candidateNodes"]
        claims = test_case["decomposition"]["claims"]
        if not candidates:
            empty_timing = {
                "samples": [0.0] * REPETITIONS,
                "median": 0.0,
            }
            cases.append({
                "caseId": test_case["caseId"],
                "coursePackId": test_case["coursePackId"],
                "candidateCount": 0,
                "candidateNodeIdsSha256":
                    test_case["candidateNodeIdsSha256"],
                "arms": {
                    "A_FULL_QUERY": {
                        "timingMs": empty_timing,
                        "wholeQueryRanking": [],
                    },
                    "B_CLAIM_MATRIX": {
                        "timingMs": empty_timing,
                        "wholeQueryRanking": [],
                        "claimRankings": [
                            {
                                "claimId": claim["claimId"],
                                "textHash": claim["textHash"],
                                "ranking": [],
                            }
                            for claim in claims
                        ],
                    },
                },
            })
            continue
        candidate_embeddings = embeddings[
            offsets_by_case[test_case["caseId"]]
        ]

        def score_a() -> list[list[float]]:
            query = encoder.encode(
                [test_case["normalizedQuestion"]],
                query=True,
            ).to(candidate_embeddings.device)
            values = query @ candidate_embeddings.T
            return values.detach().cpu().tolist()

        all_texts = [
            test_case["normalizedQuestion"],
            *[claim["text"] for claim in claims],
        ]

        def score_b() -> list[list[float]]:
            queries = encoder.encode(
                all_texts,
                query=True,
            ).to(candidate_embeddings.device)
            values = queries @ candidate_embeddings.T
            return values.detach().cpu().tolist()

        a_scores, a_samples = timed_matrix(
            torch,
            device,
            score_a,
        )
        b_scores, b_samples = timed_matrix(
            torch,
            device,
            score_b,
        )
        cases.append({
            "caseId": test_case["caseId"],
            "coursePackId": test_case["coursePackId"],
            "candidateCount": len(candidates),
            "candidateNodeIdsSha256":
                test_case["candidateNodeIdsSha256"],
            "arms": {
                "A_FULL_QUERY": {
                    "timingMs": {
                        "samples": a_samples,
                        "median": median(a_samples),
                    },
                    "wholeQueryRanking":
                        rank_scores(candidates, a_scores[0]),
                },
                "B_CLAIM_MATRIX": {
                    "timingMs": {
                        "samples": b_samples,
                        "median": median(b_samples),
                    },
                    "wholeQueryRanking":
                        rank_scores(candidates, b_scores[0]),
                    "claimRankings": [
                        {
                            "claimId": claim["claimId"],
                            "textHash": claim["textHash"],
                            "ranking": rank_scores(
                                candidates,
                                b_scores[index],
                            ),
                        }
                        for index, claim in enumerate(
                            claims,
                            start=1,
                        )
                    ],
                },
            },
        })
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
        "tokenizerClassName": type(encoder.tokenizer).__name__,
        "modelClassName": type(encoder.model).__name__,
        "modelDtype": str(next(encoder.model.parameters()).dtype),
    }
    del embeddings
    del encoder
    if device == "cuda":
        torch.cuda.empty_cache()
    return cases, environment


def reject_heldout_path(path: Path) -> Path:
    if "heldout" in str(path).lower():
        raise ValueError("T44_CLAIM_HELDOUT_PATH_NOT_AUTHORIZED")
    return path


def evaluate(args: argparse.Namespace) -> dict[str, Any]:
    if sys.version_info[:2] != (3, 12):
        raise ValueError("PYTHON_VERSION_UNSUPPORTED")
    for path in (
        args.input,
        args.corpus,
        args.model_dir,
        args.model_seal,
        args.index_dir,
    ):
        reject_heldout_path(path)
    input_path = args.input.resolve(strict=True)
    runtime_raw, input_hash = read_json_bytes(input_path)
    runtime_input = validate_candidate_input(runtime_raw)
    model_dir = args.model_dir.resolve(strict=True)
    index_dir = args.index_dir.resolve(strict=True)
    manifest, offsets_by_case = verify_runtime_bindings(
        runtime_input,
        args.corpus,
        model_dir,
        args.model_seal,
        index_dir,
    )
    cases, environment = score_matrices(
        runtime_input,
        offsets_by_case,
        model_dir,
        index_dir,
        args.device,
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": OUTPUT_KIND,
        "candidateInputSha256": input_hash,
        "runtimeSuite": runtime_input["runtimeSuite"],
        "corpusBundleHash":
            runtime_input["corpusSnapshot"]["bundleHash"],
        "config": SCORE_CONFIG,
        "configHash": sha256_stable(SCORE_CONFIG),
        "model": {
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
        "environment": environment,
        "timingProtocol": {
            "warmupRunsPerModel": 1,
            "repetitionsPerCase": REPETITIONS,
            "caseAggregate": "MEDIAN",
            "suiteAggregate": "P95_NEAREST_RANK",
            "aMatrixBoundary":
                SCORE_CONFIG["aMatrixBoundary"],
            "bMatrixBoundary":
                SCORE_CONFIG["bMatrixBoundary"],
        },
        "cases": cases,
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Lumi offline T4.4 claim-node matrix scorer",
    )
    result.add_argument("--input", type=Path, required=True)
    result.add_argument("--corpus", type=Path, required=True)
    result.add_argument("--model-dir", type=Path, required=True)
    result.add_argument("--model-seal", type=Path, required=True)
    result.add_argument("--index-dir", type=Path, required=True)
    result.add_argument(
        "--device",
        choices=("cuda", "cpu"),
        default="cuda",
    )
    return result


def main(argv: Iterable[str] | None = None) -> int:
    output = evaluate(parser().parse_args(argv))
    sys.stdout.write(stable_json(output) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

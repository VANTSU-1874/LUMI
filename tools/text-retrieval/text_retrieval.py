"""Offline, self-hosted BGE text index builder and JSONL retrieval sidecar.

This module deliberately has no application configuration or API integration.
Model files and index payloads are accepted only when their immutable seals
verify, and the serving command never accesses the network.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Iterable, Iterator


SCHEMA_VERSION = 1
MODEL_ID = "BAAI/bge-small-zh-v1.5"
MODEL_REVISION = "7999e1d3359715c523056ef9478215996d62a620"
MODEL_LICENSE = "MIT"
MODEL_DIMENSIONS = 512
QUERY_INSTRUCTION = "为这个句子生成表示以用于检索相关文章："
POOLING = "CLS"
NORMALIZE = True
MAX_LENGTH = 512
BUILDER_ID = "lumi-bge-text-index"
BUILDER_VERSION = "2.0.0"
MAX_REQUEST_BYTES = 64 * 1024
MAX_QUERY_CHARACTERS = 2_000
MAX_TOP_K = 50
MAX_OBJECT_CANDIDATES = 10
MAX_OBJECT_CANDIDATE_NODES = 3
PAYLOAD_NAME = "embeddings.safetensors"
MANIFEST_NAME = "index-manifest.json"
PACK_COMPETITION_SCHEMA_VERSION = 1

LEGACY_INDEX_CONFIG = {
    "modelId": MODEL_ID,
    "modelRevision": MODEL_REVISION,
    "modelLicense": MODEL_LICENSE,
    "dimensions": MODEL_DIMENSIONS,
    "pooling": POOLING,
    "normalize": NORMALIZE,
    "maxLength": MAX_LENGTH,
    "queryInstruction": QUERY_INSTRUCTION,
    "includedNodeKinds": ["DOCUMENT", "SECTION", "TEXT"],
    "includedAnnotation": {"kind": "CAPTION", "origin": "SOURCE"},
}
INDEX_CONFIG = {
    **LEGACY_INDEX_CONFIG,
    "indexEncodingPolicy": "SINGLE_RECORD_V1",
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


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def require_hash(value: Any, code: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(code)
    return value


def require_string(value: Any, code: str, maximum: int = 10_000) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(code)
    return value


def relative_files(root: Path) -> Iterator[Path]:
    for candidate in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        if candidate.is_symlink():
            raise ValueError("TEXT_MODEL_SYMLINK_NOT_ALLOWED")
        if candidate.is_file():
            yield candidate


def model_snapshot_seal(model_dir: Path) -> dict[str, Any]:
    model_dir = model_dir.resolve(strict=True)
    files = []
    for candidate in relative_files(model_dir):
        relative_path = candidate.relative_to(model_dir).as_posix()
        files.append({
            "path": relative_path,
            "sizeBytes": candidate.stat().st_size,
            "sha256": sha256_file(candidate),
        })
    if not files:
        raise ValueError("TEXT_MODEL_SNAPSHOT_EMPTY")
    directory_hash = sha256_stable(files)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "modelId": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "license": MODEL_LICENSE,
        "directorySha256": directory_hash,
        "files": files,
    }


def verify_model_snapshot(
    model_dir: Path,
    seal_path: Path,
) -> tuple[str, str]:
    seal = read_json(seal_path.resolve(strict=True))
    if not isinstance(seal, dict):
        raise ValueError("TEXT_MODEL_SEAL_INVALID")
    expected = model_snapshot_seal(model_dir)
    if seal != expected:
        raise ValueError("TEXT_MODEL_SNAPSHOT_DRIFT")
    return expected["directorySha256"], sha256_file(seal_path.resolve(strict=True))


def verify_corpus_bundle(corpus: Any) -> dict[str, Any]:
    if not isinstance(corpus, dict) or corpus.get("schemaVersion") != 2:
        raise ValueError("TEXT_CORPUS_SCHEMA_UNSUPPORTED")
    declared_hash = require_hash(corpus.get("bundleHash"), "TEXT_CORPUS_HASH_INVALID")
    unhashed = {key: value for key, value in corpus.items() if key != "bundleHash"}
    if sha256_stable(unhashed) != declared_hash:
        raise ValueError("TEXT_CORPUS_HASH_DRIFT")
    if not isinstance(corpus.get("objects"), list):
        raise ValueError("TEXT_CORPUS_OBJECTS_INVALID")
    return corpus


def ancestor_titles(nodes: dict[str, dict[str, Any]], node: dict[str, Any]) -> list[str]:
    titles: list[str] = []
    seen: set[str] = set()
    parent_id = node.get("parentId")
    while parent_id is not None:
        if not isinstance(parent_id, str) or parent_id in seen:
            raise ValueError("TEXT_CORPUS_GRAPH_INVALID")
        seen.add(parent_id)
        parent = nodes.get(parent_id)
        if parent is None:
            raise ValueError("TEXT_CORPUS_GRAPH_INVALID")
        if parent.get("kind") in ("DOCUMENT", "SECTION"):
            titles.append(require_string(parent.get("title"), "TEXT_NODE_TITLE_INVALID", 300))
        parent_id = parent.get("parentId")
    titles.reverse()
    return titles


def representation_id(parts: list[str]) -> str:
    return f"text-rep-{sha256_stable(parts)[:32]}"


def record_hash_payload(record: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if key not in ("text", "recordHash")}


def extract_records(corpus_input: Any) -> list[dict[str, Any]]:
    corpus = verify_corpus_bundle(corpus_input)
    records: list[dict[str, Any]] = []
    object_ids: set[str] = set()
    node_ids: set[str] = set()
    representation_ids: set[str] = set()

    for knowledge_object in corpus["objects"]:
        if not isinstance(knowledge_object, dict):
            raise ValueError("TEXT_CORPUS_OBJECT_INVALID")
        object_id = require_string(
            knowledge_object.get("id"),
            "TEXT_OBJECT_ID_INVALID",
            128,
        )
        if object_id in object_ids:
            raise ValueError("TEXT_CORPUS_DUPLICATE_OBJECT")
        object_ids.add(object_id)
        object_title = require_string(
            knowledge_object.get("title"),
            "TEXT_OBJECT_TITLE_INVALID",
            300,
        )
        source_course = knowledge_object.get("sourceCoursePack")
        if not isinstance(source_course, dict):
            raise ValueError("TEXT_OBJECT_COURSE_INVALID")
        course_pack_id = require_string(
            source_course.get("id"),
            "TEXT_OBJECT_COURSE_INVALID",
            128,
        )
        raw_nodes = knowledge_object.get("nodes")
        if not isinstance(raw_nodes, list):
            raise ValueError("TEXT_OBJECT_NODES_INVALID")
        nodes = {}
        for node in raw_nodes:
            if not isinstance(node, dict):
                raise ValueError("TEXT_NODE_INVALID")
            node_id = require_string(node.get("id"), "TEXT_NODE_ID_INVALID", 128)
            if node_id in node_ids or node_id in nodes:
                raise ValueError("TEXT_CORPUS_DUPLICATE_NODE")
            nodes[node_id] = node
        node_ids.update(nodes)

        for node_id, node in nodes.items():
            kind = node.get("kind")
            if kind not in ("DOCUMENT", "SECTION", "TEXT"):
                continue
            content_hash = require_hash(
                node.get("contentHash"),
                "TEXT_NODE_HASH_INVALID",
            )
            hierarchy = ancestor_titles(nodes, node)
            role: str | None = None
            if kind == "DOCUMENT":
                body = require_string(node.get("title"), "TEXT_NODE_TITLE_INVALID", 300)
            elif kind == "SECTION":
                body = require_string(node.get("title"), "TEXT_NODE_TITLE_INVALID", 300)
            else:
                body = require_string(node.get("text"), "TEXT_NODE_CONTENT_INVALID", 16_000)
                role = require_string(node.get("role"), "TEXT_NODE_ROLE_INVALID", 30)
            text_parts = [object_title, *hierarchy, body]
            text = "\n".join(dict.fromkeys(part.strip() for part in text_parts if part.strip()))
            rep_id = representation_id(["NODE", object_id, node_id, content_hash])
            if rep_id in representation_ids:
                raise ValueError("TEXT_INDEX_REPRESENTATION_COLLISION")
            representation_ids.add(rep_id)
            record = {
                "representationId": rep_id,
                "nodeId": node_id,
                "objectId": object_id,
                "coursePackId": course_pack_id,
                "sourceKind": "NODE",
                "nodeKind": kind,
                "role": role,
                "contentHash": content_hash,
                "text": text,
            }
            record["recordHash"] = sha256_stable(record_hash_payload(record))
            records.append(record)

        raw_annotations = knowledge_object.get("annotations")
        if not isinstance(raw_annotations, list):
            raise ValueError("TEXT_OBJECT_ANNOTATIONS_INVALID")
        for annotation in raw_annotations:
            if (
                not isinstance(annotation, dict)
                or annotation.get("kind") != "CAPTION"
                or annotation.get("origin") != "SOURCE"
            ):
                continue
            target_node_id = require_string(
                annotation.get("targetNodeId"),
                "TEXT_CAPTION_TARGET_INVALID",
                128,
            )
            target = nodes.get(target_node_id)
            if target is None or target.get("kind") != "IMAGE":
                raise ValueError("TEXT_CAPTION_TARGET_INVALID")
            payload = annotation.get("payload")
            if not isinstance(payload, dict) or payload.get("kind") != "CAPTION":
                raise ValueError("TEXT_CAPTION_PAYLOAD_INVALID")
            caption = require_string(
                payload.get("text"),
                "TEXT_CAPTION_PAYLOAD_INVALID",
                8_000,
            )
            annotation_id = require_string(
                annotation.get("id"),
                "TEXT_CAPTION_ID_INVALID",
                128,
            )
            annotation_hash = require_hash(
                annotation.get("annotationHash"),
                "TEXT_CAPTION_HASH_INVALID",
            )
            rep_id = representation_id([
                "SOURCE_CAPTION",
                object_id,
                annotation_id,
                annotation_hash,
            ])
            if rep_id in representation_ids:
                raise ValueError("TEXT_INDEX_REPRESENTATION_COLLISION")
            representation_ids.add(rep_id)
            record = {
                "representationId": rep_id,
                "nodeId": target_node_id,
                "objectId": object_id,
                "coursePackId": course_pack_id,
                "sourceKind": "SOURCE_CAPTION",
                "nodeKind": "IMAGE",
                "role": "CAPTION",
                "contentHash": annotation_hash,
                "text": f"{object_title}\n{caption}",
            }
            record["recordHash"] = sha256_stable(record_hash_payload(record))
            records.append(record)

    records.sort(key=lambda record: record["representationId"])
    if not records:
        raise ValueError("TEXT_INDEX_RECORDS_EMPTY")
    return records


def public_record(record: dict[str, Any], tensor_offset: int) -> dict[str, Any]:
    result = {key: value for key, value in record.items() if key != "text"}
    result["tensorOffset"] = tensor_offset
    return result


def index_config_hash() -> str:
    return sha256_stable(INDEX_CONFIG)


def incremental_compatibility_payload(
    model_directory_hash: str,
    model_seal_hash: str,
) -> dict[str, Any]:
    config_hash = index_config_hash()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "provider": "bge-small-zh-v1-5",
        "identity": {
            "indexVersionId": f"bge-small-zh-v1-5-{config_hash[:12]}",
            "modelId": MODEL_ID,
            "modelRevision": MODEL_REVISION,
        },
        "model": {
            **INDEX_CONFIG,
            "directorySha256": model_directory_hash,
            "sealSha256": model_seal_hash,
        },
        "builder": {
            "id": BUILDER_ID,
            "version": BUILDER_VERSION,
            "python": platform.python_version(),
        },
        "configHash": config_hash,
        "dimensions": MODEL_DIMENSIONS,
    }


def manifest_incremental_compatibility_payload(
    manifest: dict[str, Any],
) -> dict[str, Any]:
    identity = manifest["identity"]
    return {
        "schemaVersion": manifest["schemaVersion"],
        "provider": "bge-small-zh-v1-5",
        "identity": {
            "indexVersionId": identity["indexVersionId"],
            "modelId": identity["modelId"],
            "modelRevision": identity["modelRevision"],
        },
        "model": manifest["model"],
        "builder": manifest["builder"],
        "configHash": manifest["configHash"],
        "dimensions": manifest["dimensions"],
    }


def create_incremental_plan(
    *,
    corpus_hash: str,
    compatibility_hash: str,
    base_manifest: dict[str, Any] | None,
    base_compatible: bool,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    base_entries = [] if base_manifest is None else base_manifest["entries"]
    base_by_id = {
        entry["representationId"]: (offset, entry)
        for offset, entry in enumerate(base_entries)
    }
    target_ids = {record["representationId"] for record in records}
    actions = []
    reused = 0
    for target_ordinal, record in enumerate(records):
        record_id = record["representationId"]
        base = base_by_id.get(record_id)
        if (
            base_compatible
            and base is not None
            and base[1]["recordHash"] == record["recordHash"]
        ):
            actions.append({
                "action": "REUSE",
                "recordId": record_id,
                "reuseKey": record["recordHash"],
                "targetOrdinal": target_ordinal,
                "baseOrdinal": base[0],
            })
            reused += 1
        else:
            actions.append({
                "action": "REBUILD",
                "recordId": record_id,
                "reuseKey": record["recordHash"],
                "targetOrdinal": target_ordinal,
            })
    deleted = 0
    for base_ordinal, entry in enumerate(base_entries):
        if entry["representationId"] not in target_ids:
            actions.append({
                "action": "DELETE",
                "recordId": entry["representationId"],
                "reuseKey": entry["recordHash"],
                "baseOrdinal": base_ordinal,
            })
            deleted += 1
    return {
        "schemaVersion": 2,
        "provider": "bge-small-zh-v1-5",
        "baseIndexBundleHash": (
            None
            if base_manifest is None
            else base_manifest["identity"]["indexBundleHash"]
        ),
        "targetCorpusBundleHash": corpus_hash,
        "compatibilityHash": compatibility_hash,
        "baseCompatible": base_compatible,
        "outputIndexBundleHash": None,
        "actions": actions,
        "summary": {
            "reused": reused,
            "rebuilt": len(records) - reused,
            "deleted": deleted,
        },
    }


def write_incremental_plan(path: Path, plan: dict[str, Any]) -> None:
    target = path.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.is_symlink():
        raise ValueError("TEXT_INCREMENTAL_PLAN_PATH_INVALID")
    draft = target.with_name(f".{target.name}.{uuid.uuid4()}.tmp")
    try:
        write_json(draft, plan)
        draft.replace(target)
    finally:
        if draft.exists():
            draft.unlink()


def base_index_manifest(
    corpus_hash: str,
    model_directory_hash: str,
    model_seal_hash: str,
    payload_path: Path,
    records: list[dict[str, Any]],
) -> dict[str, Any]:
    config_hash = index_config_hash()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "identity": {
            "corpusBundleHash": corpus_hash,
            "indexVersionId": f"bge-small-zh-v1-5-{config_hash[:12]}",
            "modelId": MODEL_ID,
            "modelRevision": MODEL_REVISION,
        },
        "model": {
            **INDEX_CONFIG,
            "directorySha256": model_directory_hash,
            "sealSha256": model_seal_hash,
        },
        "builder": {
            "id": BUILDER_ID,
            "version": BUILDER_VERSION,
            "python": platform.python_version(),
        },
        "configHash": config_hash,
        "dimensions": MODEL_DIMENSIONS,
        "recordCount": len(records),
        "entries": [
            public_record(record, offset)
            for offset, record in enumerate(records)
        ],
        "payload": {
            "fileName": PAYLOAD_NAME,
            "format": "SAFETENSORS_F32",
            "sha256": sha256_file(payload_path),
            "byteLength": payload_path.stat().st_size,
            "tensorKey": "embeddings",
            "shape": [len(records), MODEL_DIMENSIONS],
        },
    }


def seal_index_manifest(base_manifest: dict[str, Any]) -> dict[str, Any]:
    index_hash = sha256_stable(base_manifest)
    result = json.loads(json.dumps(base_manifest))
    result["identity"]["indexBundleHash"] = index_hash
    return result


def verify_index_manifest(index_dir: Path) -> dict[str, Any]:
    resolved_dir = index_dir.resolve(strict=True)
    manifest_path = (resolved_dir / MANIFEST_NAME).resolve(strict=True)
    if manifest_path.parent != resolved_dir or manifest_path.is_symlink():
        raise ValueError("TEXT_INDEX_MANIFEST_PATH_INVALID")
    manifest = read_json(manifest_path)
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError("TEXT_INDEX_SCHEMA_UNSUPPORTED")
    identity = manifest.get("identity")
    if not isinstance(identity, dict):
        raise ValueError("TEXT_INDEX_IDENTITY_INVALID")
    require_hash(
        identity.get("corpusBundleHash"),
        "TEXT_INDEX_CORPUS_HASH_INVALID",
    )
    index_hash = require_hash(
        identity.get("indexBundleHash"),
        "TEXT_INDEX_HASH_INVALID",
    )
    unhashed = json.loads(json.dumps(manifest))
    del unhashed["identity"]["indexBundleHash"]
    if sha256_stable(unhashed) != index_hash:
        raise ValueError("TEXT_INDEX_MANIFEST_DRIFT")
    model = manifest.get("model")
    builder = manifest.get("builder")
    if not isinstance(model, dict) or not isinstance(builder, dict):
        raise ValueError("TEXT_INDEX_CONFIGURATION_DRIFT")
    model_config = {
        key: value
        for key, value in model.items()
        if key not in ("directorySha256", "sealSha256")
    }
    if model_config not in (LEGACY_INDEX_CONFIG, INDEX_CONFIG):
        raise ValueError("TEXT_INDEX_CONFIGURATION_DRIFT")
    config_hash = sha256_stable(model_config)
    expected_builder_version = (
        BUILDER_VERSION
        if model_config == INDEX_CONFIG
        else "1.0.0"
    )
    if (
        identity.get("modelId") != MODEL_ID
        or identity.get("modelRevision") != MODEL_REVISION
        or identity.get("indexVersionId")
            != f"bge-small-zh-v1-5-{config_hash[:12]}"
        or manifest.get("configHash") != config_hash
        or manifest.get("dimensions") != MODEL_DIMENSIONS
        or builder.get("id") != BUILDER_ID
        or builder.get("version") != expected_builder_version
        or not isinstance(builder.get("python"), str)
        or not builder["python"]
    ):
        raise ValueError("TEXT_INDEX_CONFIGURATION_DRIFT")
    require_hash(
        model.get("directorySha256"),
        "TEXT_INDEX_MODEL_HASH_INVALID",
    )
    require_hash(
        model.get("sealSha256"),
        "TEXT_INDEX_MODEL_HASH_INVALID",
    )
    payload = manifest.get("payload")
    if not isinstance(payload, dict) or payload.get("fileName") != PAYLOAD_NAME:
        raise ValueError("TEXT_INDEX_PAYLOAD_INVALID")
    payload_path = (resolved_dir / PAYLOAD_NAME).resolve(strict=True)
    if (
        payload_path.parent != resolved_dir
        or payload_path.is_symlink()
        or payload_path.stat().st_size != payload.get("byteLength")
        or sha256_file(payload_path) != payload.get("sha256")
    ):
        raise ValueError("TEXT_INDEX_PAYLOAD_DRIFT")
    entries = manifest.get("entries")
    if (
        not isinstance(entries, list)
        or len(entries) != manifest.get("recordCount")
        or payload.get("shape") != [len(entries), MODEL_DIMENSIONS]
    ):
        raise ValueError("TEXT_INDEX_COUNT_MISMATCH")
    representation_ids: set[str] = set()
    offsets: list[int] = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("TEXT_INDEX_ENTRY_INVALID")
        representation_id_value = require_string(
            entry.get("representationId"),
            "TEXT_INDEX_ENTRY_INVALID",
            128,
        )
        if representation_id_value in representation_ids:
            raise ValueError("TEXT_INDEX_DUPLICATE_REPRESENTATION")
        representation_ids.add(representation_id_value)
        require_hash(entry.get("contentHash"), "TEXT_INDEX_ENTRY_HASH_INVALID")
        require_hash(entry.get("recordHash"), "TEXT_INDEX_ENTRY_HASH_INVALID")
        offset = entry.get("tensorOffset")
        if not isinstance(offset, int) or isinstance(offset, bool):
            raise ValueError("TEXT_INDEX_ENTRY_OFFSET_INVALID")
        offsets.append(offset)
    if offsets != list(range(len(entries))):
        raise ValueError("TEXT_INDEX_ENTRY_OFFSET_INVALID")
    return manifest


def load_verified_index_embeddings(
    index_dir: Path,
    manifest: dict[str, Any],
) -> Any:
    import torch
    from safetensors.torch import load_file

    embeddings = load_file(
        str(index_dir.resolve(strict=True) / PAYLOAD_NAME),
        device="cpu",
    ).get("embeddings")
    if (
        embeddings is None
        or embeddings.dtype != torch.float32
        or list(embeddings.shape)
            != [manifest["recordCount"], MODEL_DIMENSIONS]
        or not bool(torch.isfinite(embeddings).all().item())
    ):
        raise ValueError("TEXT_INDEX_TENSOR_INVALID")
    norms = torch.linalg.vector_norm(embeddings, ord=2, dim=1)
    if not bool(torch.allclose(
        norms,
        torch.ones_like(norms),
        atol=1e-3,
        rtol=1e-3,
    )):
        raise ValueError("TEXT_INDEX_NORMALIZATION_INVALID")
    return embeddings


class BgeEncoder:
    def __init__(self, model_dir: Path, device: str) -> None:
        import torch
        from transformers import AutoModel, AutoTokenizer

        if device == "cuda" and not torch.cuda.is_available():
            raise ValueError("CUDA_UNAVAILABLE")
        self.torch = torch
        self.device = torch.device(device)
        self.tokenizer = AutoTokenizer.from_pretrained(
            str(model_dir.resolve(strict=True)),
            local_files_only=True,
            trust_remote_code=False,
        )
        self.model = AutoModel.from_pretrained(
            str(model_dir.resolve(strict=True)),
            local_files_only=True,
            trust_remote_code=False,
        ).to(self.device)
        self.model.eval()
        hidden_size = getattr(self.model.config, "hidden_size", None)
        if hidden_size != MODEL_DIMENSIONS:
            raise ValueError("TEXT_MODEL_DIMENSIONS_INVALID")

    def encode(self, texts: list[str], query: bool) -> Any:
        torch = self.torch
        prepared = [
            f"{QUERY_INSTRUCTION}{text}" if query else text
            for text in texts
        ]
        encoded = self.tokenizer(
            prepared,
            padding=True,
            truncation=True,
            max_length=MAX_LENGTH,
            return_tensors="pt",
        )
        encoded = {key: value.to(self.device) for key, value in encoded.items()}
        with torch.inference_mode():
            output = self.model(**encoded)
            embeddings = output.last_hidden_state[:, 0]
            embeddings = torch.nn.functional.normalize(embeddings, p=2, dim=1)
        result = embeddings.detach().to(device="cpu", dtype=torch.float32)
        if (
            result.ndim != 2
            or result.shape[1] != MODEL_DIMENSIONS
            or not bool(torch.isfinite(result).all().item())
        ):
            raise ValueError("TEXT_EMBEDDING_INVALID")
        return result


def batched(values: list[str], batch_size: int) -> Iterator[list[str]]:
    for start in range(0, len(values), batch_size):
        yield values[start:start + batch_size]


def build_index(args: argparse.Namespace) -> dict[str, Any]:
    if sys.version_info[:2] != (3, 12):
        raise ValueError("PYTHON_VERSION_UNSUPPORTED")
    if getattr(args, "batch_size", 1) != 1:
        raise ValueError("TEXT_INDEX_ENCODING_POLICY_UNSUPPORTED")
    import torch
    from safetensors.torch import save_file

    corpus_path = args.corpus.resolve(strict=True)
    corpus = verify_corpus_bundle(read_json(corpus_path))
    records = extract_records(corpus)
    model_dir = args.model_dir.resolve(strict=True)
    model_hash, seal_hash = verify_model_snapshot(model_dir, args.model_seal)
    compatibility = incremental_compatibility_payload(model_hash, seal_hash)
    compatibility_hash = sha256_stable(compatibility)
    base_manifest = None
    base_index_dir = getattr(args, "base_index_dir", None)
    if base_index_dir is not None:
        base_manifest = verify_index_manifest(base_index_dir)
    base_compatible = (
        base_manifest is not None
        and sha256_stable(
            manifest_incremental_compatibility_payload(base_manifest),
        ) == compatibility_hash
    )
    plan = create_incremental_plan(
        corpus_hash=corpus["bundleHash"],
        compatibility_hash=compatibility_hash,
        base_manifest=base_manifest,
        base_compatible=base_compatible,
        records=records,
    )

    reused_embeddings = None
    if plan["summary"]["reused"] > 0:
        assert base_index_dir is not None
        reused_embeddings = load_verified_index_embeddings(
            base_index_dir,
            base_manifest,
        )

    encoder = None
    vectors = []
    current_actions = [
        action
        for action in plan["actions"]
        if action["action"] != "DELETE"
    ]
    for action, record in zip(current_actions, records, strict=True):
        if action["action"] == "REUSE":
            assert reused_embeddings is not None
            vectors.append(
                reused_embeddings[action["baseOrdinal"]]
                .detach()
                .to(device="cpu", dtype=torch.float32)
                .clone()
            )
            continue
        if encoder is None:
            encoder = BgeEncoder(model_dir, args.device)
        encoded = encoder.encode([record["text"]], query=False)
        if list(encoded.shape) != [1, MODEL_DIMENSIONS]:
            raise ValueError("TEXT_EMBEDDING_SHAPE_INVALID")
        vectors.append(encoded[0])
    tensor = torch.stack(vectors).contiguous()
    if list(tensor.shape) != [len(records), MODEL_DIMENSIONS]:
        raise ValueError("TEXT_EMBEDDING_SHAPE_INVALID")

    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".text-index-", dir=output_root))
    try:
        payload_path = staging / PAYLOAD_NAME
        save_file({"embeddings": tensor}, str(payload_path))
        base_manifest = base_index_manifest(
            corpus["bundleHash"],
            model_hash,
            seal_hash,
            payload_path,
            records,
        )
        manifest = seal_index_manifest(base_manifest)
        plan["outputIndexBundleHash"] = manifest["identity"]["indexBundleHash"]
        write_json(staging / MANIFEST_NAME, manifest)
        verify_index_manifest(staging)
        load_verified_index_embeddings(staging, manifest)
        final = output_root / manifest["identity"]["indexBundleHash"]
        if final.exists():
            existing = verify_index_manifest(final)
            load_verified_index_embeddings(final, existing)
            if existing != manifest:
                raise ValueError("TEXT_INDEX_EXISTING_CONFLICT")
            shutil.rmtree(staging)
        else:
            staging.replace(final)
        incremental_plan_output = getattr(
            args,
            "incremental_plan_output",
            None,
        )
        if incremental_plan_output is not None:
            write_incremental_plan(incremental_plan_output, plan)
        return {
            "identity": manifest["identity"],
            "indexDirectory": str(final),
            "recordCount": len(records),
            "dimensions": MODEL_DIMENSIONS,
            "payloadSha256": manifest["payload"]["sha256"],
            "incrementalPlan": plan,
            "coursePackCounts": {
                course: sum(1 for record in records if record["coursePackId"] == course)
                for course in sorted({record["coursePackId"] for record in records})
            },
        }
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise


def pack_competition_diagnostics(
    scored_entries: list[tuple[float, dict[str, Any]]],
    source_scope_course_pack_id: str | None,
) -> dict[str, Any]:
    best_by_object: dict[str, tuple[float, dict[str, Any]]] = {}
    object_course_packs: dict[str, str] = {}
    for score, entry in scored_entries:
        if not math.isfinite(score):
            raise ValueError("TEXT_SCORE_NOT_FINITE")
        object_id = entry["objectId"]
        course_pack_id = entry["coursePackId"]
        prior_pack = object_course_packs.get(object_id)
        if prior_pack is not None and prior_pack != course_pack_id:
            raise ValueError("TEXT_OBJECT_PACK_AMBIGUOUS")
        object_course_packs[object_id] = course_pack_id
        current = best_by_object.get(object_id)
        if current is None or (
            -score,
            entry["representationId"],
        ) < (
            -current[0],
            current[1]["representationId"],
        ):
            best_by_object[object_id] = (score, entry)

    object_counts: dict[str, int] = {}
    best_by_pack: dict[str, tuple[float, dict[str, Any]]] = {}
    for object_id, (score, entry) in best_by_object.items():
        course_pack_id = entry["coursePackId"]
        object_counts[course_pack_id] = object_counts.get(course_pack_id, 0) + 1
        current = best_by_pack.get(course_pack_id)
        if current is None or (
            -score,
            object_id,
            entry["representationId"],
        ) < (
            -current[0],
            current[1]["objectId"],
            current[1]["representationId"],
        ):
            best_by_pack[course_pack_id] = (score, entry)

    per_pack_winners = []
    for course_pack_id in sorted(best_by_pack):
        score, entry = best_by_pack[course_pack_id]
        per_pack_winners.append({
            "coursePackId": course_pack_id,
            "objectCount": object_counts[course_pack_id],
            "objectId": entry["objectId"],
            "representationId": entry["representationId"],
            "nodeId": entry["nodeId"],
            "score": score,
        })

    global_winner = min(
        per_pack_winners,
        key=lambda winner: (
            -winner["score"],
            winner["coursePackId"],
            winner["objectId"],
            winner["representationId"],
        ),
        default=None,
    )
    scoped_winner = next(
        (
            winner
            for winner in per_pack_winners
            if winner["coursePackId"] == source_scope_course_pack_id
        ),
        None,
    )
    global_to_scoped_margin = (
        global_winner["score"] - scoped_winner["score"]
        if global_winner is not None and scoped_winner is not None
        else None
    )
    return {
        "schemaVersion": PACK_COMPETITION_SCHEMA_VERSION,
        "scoreMetric": "COSINE_SIMILARITY",
        "objectDeduplication": "BEST_REPRESENTATION_PER_OBJECT",
        "packWinnerSelection": "BEST_OBJECT_PER_PACK",
        "globalWinnerSelection": "BEST_PACK_WINNER",
        "sourceScope": {"coursePackId": source_scope_course_pack_id},
        "scoredRepresentationCount": len(scored_entries),
        "deduplicatedObjectCount": len(best_by_object),
        "perPackWinners": per_pack_winners,
        "globalWinner": global_winner,
        "scopedWinner": scoped_winner,
        "globalToScopedMargin": global_to_scoped_margin,
    }


def rank_object_candidates(
    scored_entries: list[tuple[float, dict[str, Any]]],
    course_pack_id: str | None,
) -> list[dict[str, Any]]:
    eligible_by_object: dict[str, list[tuple[float, dict[str, Any]]]] = {}
    object_course_packs: dict[str, str] = {}
    for score, entry in scored_entries:
        if not math.isfinite(score):
            raise ValueError("TEXT_SCORE_NOT_FINITE")
        if course_pack_id is not None and entry["coursePackId"] != course_pack_id:
            continue
        if entry["sourceKind"] != "NODE" or entry["nodeKind"] != "TEXT":
            continue
        object_id = entry["objectId"]
        entry_course_pack_id = entry["coursePackId"]
        prior_pack = object_course_packs.get(object_id)
        if prior_pack is not None and prior_pack != entry_course_pack_id:
            raise ValueError("TEXT_OBJECT_PACK_AMBIGUOUS")
        object_course_packs[object_id] = entry_course_pack_id
        eligible_by_object.setdefault(object_id, []).append((score, entry))

    ranked_objects: list[
        tuple[float, str, str, list[tuple[float, dict[str, Any]]]]
    ] = []
    for object_id, nodes in eligible_by_object.items():
        nodes.sort(
            key=lambda item: (
                -item[0],
                item[1]["nodeId"],
                item[1]["representationId"],
            ),
        )
        ranked_objects.append((
            nodes[0][0],
            object_id,
            object_course_packs[object_id],
            nodes,
        ))
    ranked_objects.sort(key=lambda item: (-item[0], item[1]))

    object_candidates = []
    for object_rank, (
        object_score,
        object_id,
        entry_course_pack_id,
        nodes,
    ) in enumerate(ranked_objects[:MAX_OBJECT_CANDIDATES], start=1):
        object_candidates.append({
            "objectId": object_id,
            "coursePackId": entry_course_pack_id,
            "objectRank": object_rank,
            "objectScore": object_score,
            "nodes": [
                {
                    key: entry[key]
                    for key in (
                        "representationId",
                        "nodeId",
                        "sourceKind",
                        "nodeKind",
                        "role",
                        "contentHash",
                    )
                } | {
                    "innerRank": inner_rank,
                    "score": score,
                }
                for inner_rank, (score, entry) in enumerate(
                    nodes[:MAX_OBJECT_CANDIDATE_NODES],
                    start=1,
                )
            ],
        })
    return object_candidates


class LoadedIndex:
    def __init__(
        self,
        model_dir: Path,
        model_seal: Path,
        index_dir: Path,
        device: str,
    ) -> None:
        import safetensors
        import torch
        import transformers
        from safetensors.torch import load_file

        self.manifest = verify_index_manifest(index_dir)
        model_hash, seal_hash = verify_model_snapshot(model_dir, model_seal)
        if (
            model_hash != self.manifest["model"]["directorySha256"]
            or seal_hash != self.manifest["model"]["sealSha256"]
        ):
            raise ValueError("TEXT_INDEX_MODEL_SNAPSHOT_DRIFT")
        self.encoder = BgeEncoder(model_dir, device)
        self.entries = self.manifest["entries"]
        self.embeddings = load_file(
            str(index_dir.resolve(strict=True) / PAYLOAD_NAME),
            device=device,
        ).get("embeddings")
        if (
            self.embeddings is None
            or self.embeddings.dtype != torch.float32
            or list(self.embeddings.shape) != [len(self.entries), MODEL_DIMENSIONS]
            or not bool(torch.isfinite(self.embeddings).all().item())
        ):
            raise ValueError("TEXT_INDEX_TENSOR_INVALID")
        norms = torch.linalg.vector_norm(self.embeddings, ord=2, dim=1)
        if not bool(torch.allclose(norms, torch.ones_like(norms), atol=1e-3, rtol=1e-3)):
            raise ValueError("TEXT_INDEX_NORMALIZATION_INVALID")
        actual_device = self.encoder.device.type
        self.environment = {
            "pythonVersion": platform.python_version(),
            "torchVersion": torch.__version__,
            "transformersVersion": transformers.__version__,
            "safetensorsVersion": safetensors.__version__,
            "tokenizerClassName": type(self.encoder.tokenizer).__name__,
            "actualDevice": actual_device,
            "cudaRuntime": torch.version.cuda if actual_device == "cuda" else None,
            "deviceName": (
                torch.cuda.get_device_name(self.encoder.device)
                if actual_device == "cuda"
                else None
            ),
        }

    def search_with_object_candidates(
        self,
        text: str,
        course_pack_id: str | None,
        top_k: int,
    ) -> tuple[
        list[dict[str, Any]],
        list[dict[str, Any]],
        dict[str, Any],
        float,
    ]:
        started = time.perf_counter()
        query = self.encoder.encode([text], query=True)[0].to(self.embeddings.device)
        scores = self.embeddings @ query
        scored_entries = []
        for offset, entry in enumerate(self.entries):
            score = float(scores[offset].item())
            if not math.isfinite(score):
                raise ValueError("TEXT_SCORE_NOT_FINITE")
            scored_entries.append((score, entry))
        diagnostics = pack_competition_diagnostics(scored_entries, course_pack_id)
        object_candidates = rank_object_candidates(scored_entries, course_pack_id)
        ranked = []
        for score, entry in scored_entries:
            if course_pack_id is not None and entry["coursePackId"] != course_pack_id:
                continue
            ranked.append((score, entry["representationId"], entry))
        ranked.sort(key=lambda item: (-item[0], item[1]))
        hits = []
        for rank, (score, _, entry) in enumerate(ranked[:top_k], start=1):
            hits.append({
                key: entry[key]
                for key in (
                    "representationId",
                    "nodeId",
                    "objectId",
                    "coursePackId",
                    "sourceKind",
                    "nodeKind",
                    "role",
                    "contentHash",
                )
            } | {"rank": rank, "score": score})
        return (
            hits,
            object_candidates,
            diagnostics,
            (time.perf_counter() - started) * 1000,
        )

    def search(
        self,
        text: str,
        course_pack_id: str | None,
        top_k: int,
    ) -> tuple[list[dict[str, Any]], dict[str, Any], float]:
        hits, _, diagnostics, inference_ms = self.search_with_object_candidates(
            text,
            course_pack_id,
            top_k,
        )
        return hits, diagnostics, inference_ms


def safe_error_code(error: BaseException) -> str:
    message = str(error)
    allowed = {
        "INVALID_REQUEST",
        "REQUEST_TOO_LARGE",
        "QUERY_TEXT_INVALID",
        "QUERY_COURSE_INVALID",
        "CUDA_UNAVAILABLE",
        "TEXT_SCORE_NOT_FINITE",
    }
    return message if message in allowed else "INTERNAL"


def provider_error_response(
    request_id: Any,
    error_code: str,
) -> dict[str, Any]:
    return {
        "v": SCHEMA_VERSION,
        "type": "result",
        "id": request_id,
        "status": "ERROR",
        "reason": "PROVIDER_UNAVAILABLE",
        "hits": [],
        "objectCandidates": [],
        "index": None,
        "timing": {"inferenceMs": 0, "totalMs": 0},
        "diagnostics": None,
        "error": {
            "code": error_code,
            "retryable": error_code == "INTERNAL",
        },
    }


def serve(args: argparse.Namespace) -> None:
    if sys.version_info[:2] != (3, 12):
        raise ValueError("PYTHON_VERSION_UNSUPPORTED")
    loaded = LoadedIndex(
        args.model_dir.resolve(strict=True),
        args.model_seal.resolve(strict=True),
        args.index_dir.resolve(strict=True),
        args.device,
    )
    identity = loaded.manifest["identity"]
    sys.stdout.write(stable_json({
        "v": SCHEMA_VERSION,
        "type": "ready",
        "capabilities": ["TEXT_TO_TEXT"],
        "identity": identity,
        "environment": loaded.environment,
    }) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        request_id: Any = None
        try:
            if len(line.encode("utf-8")) > MAX_REQUEST_BYTES:
                raise ValueError("REQUEST_TOO_LARGE")
            request = json.loads(line)
            if (
                not isinstance(request, dict)
                or request.get("v") != SCHEMA_VERSION
                or request.get("type") != "search"
            ):
                raise ValueError("INVALID_REQUEST")
            request_id = str(uuid.UUID(request.get("id")))
            top_k = request.get("topK")
            if (
                not isinstance(top_k, int)
                or isinstance(top_k, bool)
                or not 1 <= top_k <= MAX_TOP_K
            ):
                raise ValueError("INVALID_REQUEST")
            query = request.get("query")
            if not isinstance(query, dict) or set(query) != {"text", "coursePackId"}:
                raise ValueError("INVALID_REQUEST")
            text = query.get("text")
            if (
                not isinstance(text, str)
                or not text.strip()
                or len(text) > MAX_QUERY_CHARACTERS
            ):
                raise ValueError("QUERY_TEXT_INVALID")
            course_pack_id = query.get("coursePackId")
            if course_pack_id is not None and (
                not isinstance(course_pack_id, str)
                or not course_pack_id
                or len(course_pack_id) > 128
            ):
                raise ValueError("QUERY_COURSE_INVALID")
            (
                hits,
                object_candidates,
                diagnostics,
                inference_ms,
            ) = loaded.search_with_object_candidates(
                text.strip(),
                course_pack_id,
                top_k,
            )
            response = {
                "v": SCHEMA_VERSION,
                "type": "result",
                "id": request_id,
                "status": "SUCCESS" if hits else "EMPTY",
                "reason": None,
                "hits": hits,
                "objectCandidates": object_candidates,
                "index": identity,
                "timing": {
                    "inferenceMs": inference_ms,
                    "totalMs": inference_ms,
                },
                "diagnostics": {
                    "packCompetition": diagnostics,
                },
            }
        except Exception as error:
            error_code = safe_error_code(error)
            response = provider_error_response(request_id, error_code)
        sys.stdout.write(stable_json(response) + "\n")
        sys.stdout.flush()


def download_model(args: argparse.Namespace) -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    local = snapshot_download(
        repo_id=MODEL_ID,
        revision=MODEL_REVISION,
        cache_dir=str(args.cache_dir.resolve()),
        local_files_only=False,
    )
    model_dir = Path(local).resolve(strict=True)
    seal = model_snapshot_seal(model_dir)
    seal_path = args.seal_path.resolve()
    seal_path.parent.mkdir(parents=True, exist_ok=True)
    if seal_path.exists() and read_json(seal_path) != seal:
        raise ValueError("TEXT_MODEL_EXISTING_SEAL_CONFLICT")
    if not seal_path.exists():
        draft = seal_path.with_name(f".{seal_path.name}.{uuid.uuid4()}.tmp")
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
        "totalBytes": sum(record["sizeBytes"] for record in seal["files"]),
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Lumi isolated self-hosted BGE text retrieval",
    )
    subparsers = result.add_subparsers(dest="command", required=True)

    download = subparsers.add_parser("download")
    download.add_argument("--cache-dir", type=Path, required=True)
    download.add_argument("--seal-path", type=Path, required=True)

    build = subparsers.add_parser("build")
    build.add_argument("--model-dir", type=Path, required=True)
    build.add_argument("--model-seal", type=Path, required=True)
    build.add_argument("--corpus", type=Path, required=True)
    build.add_argument("--output-root", type=Path, required=True)
    build.add_argument("--base-index-dir", type=Path)
    build.add_argument("--incremental-plan-output", type=Path)
    build.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    build.add_argument("--batch-size", type=int, choices=(1,), default=1)

    serve_command = subparsers.add_parser("serve")
    serve_command.add_argument("--model-dir", type=Path, required=True)
    serve_command.add_argument("--model-seal", type=Path, required=True)
    serve_command.add_argument("--index-dir", type=Path, required=True)
    serve_command.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    return result


def main(argv: Iterable[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "download":
        output = download_model(args)
    elif args.command == "build":
        output = build_index(args)
    elif args.command == "serve":
        serve(args)
        return 0
    else:
        raise AssertionError(args.command)
    sys.stdout.write(stable_json(output) + "\n")
    return 0


if __name__ == "__main__":
    try:
        exit_code = main()
    except KeyboardInterrupt:
        raise
    except Exception as error:
        sys.stderr.write(stable_json({
            "ok": False,
            "code": safe_error_code(error),
            "message": str(error),
        }) + "\n")
        exit_code = 1
    raise SystemExit(exit_code)

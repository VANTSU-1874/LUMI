from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import os
import platform
import random
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Iterable, Protocol

os.environ.setdefault("PYTHONHASHSEED", "0")
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

SCHEMA_VERSION = 1
MODEL_SEAL_SCHEMA_VERSION = 1
MAX_QUERY_IMAGE_BYTES = 16 * 1024 * 1024
SHA256 = frozenset("0123456789abcdef")
MODELS = {
    "siglip2": {
        "id": "google/siglip2-base-patch16-224",
        "revision": "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2",
        "index_version": "siglip2-224-two-region-v1",
        "index_versions": {
            "MAX_REGION": "siglip2-224-two-region-v1",
            "L2_NORMALIZED_MEAN_REGION": (
                "siglip2-224-two-region-i2i-l2-mean-v2"
            ),
        },
        "dimensions": 768,
        "capabilities": [
            "TEXT_TO_IMAGE",
            "IMAGE_TO_IMAGE",
            "IMAGE_TEXT_TO_IMAGE_EXPERIMENTAL",
            "NORMALIZED_REGIONS",
        ],
    },
    "colqwen2": {
        "id": "vidore/colqwen2-v1.0-hf",
        "revision": "0d3e414967fde994dd99a0ccc29bcb34b5355712",
        "index_version": "colqwen2-two-region-v1",
        "dimensions": 128,
        "capabilities": [
            "TEXT_TO_IMAGE",
            "IMAGE_TO_IMAGE_EXPERIMENTAL",
            "IMAGE_TEXT_TO_IMAGE_EXPERIMENTAL",
            "NORMALIZED_REGIONS",
        ],
    },
}

# 147 poster pages are 905x1280 and three use the same aspect ratio at higher
# resolution. Normalized coordinates keep the two regions identical without
# modifying source PNGs or indexing the answer text below them.
ORIGINAL_ART = {
    "name": "ORIGINAL_ART",
    "x": 35 / 905,
    "y": 260 / 1280,
    "width": 410 / 905,
    "height": 500 / 1280,
}
ANALYSIS_OVERLAY = {
    "name": "ANALYSIS_OVERLAY",
    "x": 460 / 905,
    "y": 260 / 1280,
    "width": 410 / 905,
    "height": 500 / 1280,
}
FULL_IMAGE = {
    "name": "FULL_IMAGE",
    "x": 0.0,
    "y": 0.0,
    "width": 1.0,
    "height": 1.0,
}
SINGLE_VECTOR_AGGREGATIONS = (
    "MAX_REGION",
    "L2_NORMALIZED_MEAN_REGION",
)
SINGLE_VECTOR_QUERY_MODES = (
    "TEXT_TO_IMAGE",
    "IMAGE_TO_IMAGE",
    "IMAGE_TEXT_TO_IMAGE",
)
DEFAULT_SINGLE_VECTOR_AGGREGATION = "MAX_REGION"


def l2_normalized_mean_region(vectors: list[Any], torch: Any) -> Any:
    if not vectors:
        raise ValueError("VISUAL_REGION_AGGREGATE_EMPTY")
    stacked = torch.stack([
        vector.float().cpu()
        for vector in vectors
    ])
    if not bool(torch.isfinite(stacked).all().item()):
        raise ValueError("VISUAL_REGION_AGGREGATE_NOT_FINITE")
    mean = stacked.mean(dim=0)
    norm = torch.linalg.vector_norm(mean)
    if (
        not bool(torch.isfinite(norm).item())
        or float(norm.item()) <= 1e-12
    ):
        raise ValueError("VISUAL_REGION_AGGREGATE_ZERO_NORM")
    normalized = mean / norm
    if not bool(torch.isfinite(normalized).all().item()):
        raise ValueError("VISUAL_REGION_AGGREGATE_NOT_FINITE")
    return normalized


def single_vector_aggregation_by_mode(
    config: dict[str, Any],
    representation_kind: str,
) -> dict[str, str]:
    declared = config.get("singleVectorAggregationByMode")
    if representation_kind != "SINGLE_VECTOR":
        if declared is not None:
            raise ValueError("VISUAL_INDEX_AGGREGATION_CONFIG_INVALID")
        return {}
    if declared is None:
        if config.get("singleVectorRegionAttributionByMode") is not None:
            raise ValueError("VISUAL_INDEX_AGGREGATION_CONFIG_INVALID")
        legacy = config.get(
            "singleVectorAggregation",
            DEFAULT_SINGLE_VECTOR_AGGREGATION,
        )
        if legacy != DEFAULT_SINGLE_VECTOR_AGGREGATION:
            raise ValueError("VISUAL_INDEX_AGGREGATION_CONFIG_INVALID")
        return {
            mode: DEFAULT_SINGLE_VECTOR_AGGREGATION
            for mode in SINGLE_VECTOR_QUERY_MODES
        }
    if (
        not isinstance(declared, dict)
        or "singleVectorAggregation" in config
        or set(declared) != set(SINGLE_VECTOR_QUERY_MODES)
        or any(
            declared.get(mode) not in SINGLE_VECTOR_AGGREGATIONS
            for mode in SINGLE_VECTOR_QUERY_MODES
        )
        or declared["TEXT_TO_IMAGE"] != "MAX_REGION"
        or declared["IMAGE_TO_IMAGE"] != "L2_NORMALIZED_MEAN_REGION"
        or declared["IMAGE_TEXT_TO_IMAGE"] != "MAX_REGION"
    ):
        raise ValueError("VISUAL_INDEX_AGGREGATION_CONFIG_INVALID")
    attribution = config.get("singleVectorRegionAttributionByMode")
    if attribution != {
            "IMAGE_TO_IMAGE": "MAX_QUERY_SIMILARITY_FIRST_REGION_TIE",
        }:
        raise ValueError("VISUAL_INDEX_AGGREGATION_CONFIG_INVALID")
    return {
        mode: declared[mode]
        for mode in SINGLE_VECTOR_QUERY_MODES
    }


def index_version_for_aggregation(
    adapter_name: str,
    image_to_image_aggregation: str,
) -> str:
    model = MODELS[adapter_name]
    versions = model.get("index_versions")
    if versions is None:
        if image_to_image_aggregation != DEFAULT_SINGLE_VECTOR_AGGREGATION:
            raise ValueError("VISUAL_INDEX_AGGREGATION_UNSUPPORTED")
        return model["index_version"]
    version = versions.get(image_to_image_aggregation)
    if version is None:
        raise ValueError("VISUAL_INDEX_AGGREGATION_UNSUPPORTED")
    return version


def configure_single_vector_aggregation(
    config: dict[str, Any],
    representation_kind: str,
    image_to_image_aggregation: str,
) -> dict[str, Any]:
    if representation_kind != "SINGLE_VECTOR":
        if image_to_image_aggregation != DEFAULT_SINGLE_VECTOR_AGGREGATION:
            raise ValueError("VISUAL_INDEX_AGGREGATION_UNSUPPORTED")
        single_vector_aggregation_by_mode(config, representation_kind)
        return config
    if image_to_image_aggregation == "L2_NORMALIZED_MEAN_REGION":
        config.pop("singleVectorAggregation", None)
        config["singleVectorAggregationByMode"] = {
            "TEXT_TO_IMAGE": "MAX_REGION",
            "IMAGE_TO_IMAGE": image_to_image_aggregation,
            "IMAGE_TEXT_TO_IMAGE": "MAX_REGION",
        }
        config["singleVectorRegionAttributionByMode"] = {
            "IMAGE_TO_IMAGE": "MAX_QUERY_SIMILARITY_FIRST_REGION_TIE",
        }
    single_vector_aggregation_by_mode(config, representation_kind)
    return config


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def require_hash(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in SHA256 for character in value)
    ):
        raise ValueError(f"{label}_INVALID")
    return value


def read_json(file_path: Path) -> Any:
    with file_path.open("r", encoding="utf-8") as stream:
        return json.load(stream)


def write_json(file_path: Path, value: Any) -> None:
    file_path.write_bytes(json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8") + b"\n")


def model_directory_digest(model_dir: Path) -> tuple[str, list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    for file_path in sorted(
        (item for item in model_dir.rglob("*") if item.is_file()),
        key=lambda item: item.relative_to(model_dir).as_posix(),
    ):
        relative = file_path.relative_to(model_dir).as_posix()
        records.append({
            "path": relative,
            "sizeBytes": file_path.stat().st_size,
            "sha256": sha256_file(file_path),
        })
    if not records:
        raise ValueError("MODEL_DIRECTORY_EMPTY")
    return sha256_bytes(canonical_json(records)), records


def model_snapshot_seal(
    adapter_name: str,
    model_dir: Path,
) -> dict[str, Any]:
    import huggingface_hub

    model = MODELS[adapter_name]
    resolved = model_dir.resolve(strict=True)
    if resolved.name != model["revision"]:
        raise ValueError("MODEL_SNAPSHOT_REVISION_PATH_MISMATCH")
    digest, records = model_directory_digest(resolved)
    return {
        "schemaVersion": MODEL_SEAL_SCHEMA_VERSION,
        "adapter": adapter_name,
        "repoId": model["id"],
        "revision": model["revision"],
        "snapshotDirectory": str(resolved),
        "modelDirectorySha256": digest,
        "files": records,
        "downloader": {
            "python": platform.python_version(),
            "huggingfaceHub": huggingface_hub.__version__,
        },
    }


def verify_model_snapshot(
    adapter_name: str,
    model_dir: Path,
    seal_path: Path,
) -> tuple[str, list[dict[str, Any]], str]:
    resolved_seal = seal_path.resolve(strict=True)
    seal = read_json(resolved_seal)
    expected = model_snapshot_seal(adapter_name, model_dir)
    if seal != expected:
        raise ValueError("MODEL_SNAPSHOT_SEAL_MISMATCH")
    return (
        expected["modelDirectorySha256"],
        expected["files"],
        sha256_file(resolved_seal),
    )


def deterministic_runtime(torch: Any) -> None:
    random.seed(0)
    try:
        import numpy
        numpy.random.seed(0)
    except ImportError:
        pass
    torch.manual_seed(0)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(0)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.use_deterministic_algorithms(True, warn_only=False)


def siglip_pooled_tensor(output: Any, torch: Any) -> Any:
    value = getattr(output, "pooler_output", None)
    if not isinstance(value, torch.Tensor) or value.ndim != 2 or value.shape[-1] != 768:
        raise TypeError("SIGLIP_OUTPUT_SHAPE_INVALID")
    return value


def colqwen_token_tensor(output: Any, torch: Any) -> Any:
    value = getattr(output, "embeddings", None)
    if not isinstance(value, torch.Tensor) or value.ndim != 3 or value.shape[-1] != 128:
        raise ValueError("MULTIVECTOR_OUTPUT_SHAPE_INVALID")
    value = value[0]
    mask = value.abs().sum(dim=-1) > 0
    value = value[mask]
    if value.shape[0] < 1:
        raise ValueError("MULTIVECTOR_OUTPUT_EMPTY")
    return value


def move_batch(batch: Any, device: Any) -> Any:
    if hasattr(batch, "to"):
        return batch.to(device)
    return {
        key: value.to(device) if hasattr(value, "to") else value
        for key, value in batch.items()
    }


class VisualAdapter(Protocol):
    dimensions: int
    representation_kind: str

    def encode_images(self, images: list[Any]) -> list[Any]:
        ...

    def encode_text(self, text: str) -> Any:
        ...

    def combine_queries(self, text_query: Any, image_query: Any) -> Any:
        ...

    def score(self, query: Any, candidate: Any) -> float:
        ...


class Siglip2Adapter:
    dimensions = 768
    representation_kind = "SINGLE_VECTOR"

    def __init__(self, model_dir: Path, device_name: str):
        import torch
        import torch.nn.functional as functional
        from transformers import AutoModel, AutoProcessor

        self.torch = torch
        self.functional = functional
        deterministic_runtime(torch)
        if device_name == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA_UNAVAILABLE")
        self.device = torch.device(device_name)
        dtype = torch.float16 if self.device.type == "cuda" else torch.float32
        self.processor = AutoProcessor.from_pretrained(
            model_dir,
            local_files_only=True,
            trust_remote_code=False,
        )
        self.model = AutoModel.from_pretrained(
            model_dir,
            dtype=dtype,
            attn_implementation="eager",
            local_files_only=True,
            trust_remote_code=False,
            use_safetensors=True,
        ).eval().to(self.device)

    def _normalize(self, output: Any) -> Any:
        tensor = siglip_pooled_tensor(output, self.torch)
        return self.functional.normalize(tensor.float(), dim=-1)

    def encode_images(self, images: list[Any]) -> list[Any]:
        batch = move_batch(
            self.processor(images=images, return_tensors="pt"),
            self.device,
        )
        with self.torch.inference_mode():
            features = self.model.get_image_features(**batch)
        normalized = self._normalize(features).cpu()
        return [normalized[index] for index in range(normalized.shape[0])]

    def encode_text(self, text: str) -> Any:
        batch = move_batch(
            self.processor(
                text=[text],
                padding="max_length",
                truncation=True,
                max_length=64,
                return_tensors="pt",
            ),
            self.device,
        )
        with self.torch.inference_mode():
            features = self.model.get_text_features(**batch)
        return self._normalize(features)[0].cpu()

    def combine_queries(self, text_query: Any, image_query: Any) -> Any:
        combined = text_query.float() + image_query.float()
        return self.functional.normalize(combined, dim=-1)

    def score(self, query: Any, candidate: Any) -> float:
        return float(self.torch.dot(query.float(), candidate.float()).item())


class Colqwen2Adapter:
    dimensions = 128
    representation_kind = "MULTI_VECTOR"

    def __init__(
        self,
        model_dir: Path,
        device_name: str,
        offload_dir: Path,
        gpu_memory_gib: float,
    ):
        import torch
        from transformers import ColQwen2ForRetrieval, ColQwen2Processor

        self.torch = torch
        deterministic_runtime(torch)
        if device_name == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA_UNAVAILABLE")
        self.processor = ColQwen2Processor.from_pretrained(
            model_dir,
            local_files_only=True,
            trust_remote_code=False,
        )
        dtype = torch.bfloat16 if device_name == "cuda" else torch.float32
        load_options: dict[str, Any] = {
            "dtype": dtype,
            "local_files_only": True,
            "trust_remote_code": False,
            "use_safetensors": True,
            "attn_implementation": "eager",
        }
        if device_name == "cuda":
            offload_dir.mkdir(parents=True, exist_ok=True)
            free_bytes, _ = torch.cuda.mem_get_info()
            reserve_bytes = int(1.25 * 1024**3)
            available_gib = max(0.0, (free_bytes - reserve_bytes) / 1024**3)
            self.gpu_memory_budget_gib = min(gpu_memory_gib, available_gib)
            if self.gpu_memory_budget_gib < 0.5:
                raise RuntimeError("CUDA_MEMORY_BUDGET_UNAVAILABLE")
            load_options.update({
                "device_map": "auto",
                "max_memory": {
                    0: f"{self.gpu_memory_budget_gib:.3f}GiB",
                    "cpu": "48GiB",
                },
                "offload_folder": str(offload_dir),
            })
        else:
            self.gpu_memory_budget_gib = 0.0
        self.model = ColQwen2ForRetrieval.from_pretrained(
            model_dir,
            **load_options,
        ).eval()
        self.device = getattr(self.model, "device", torch.device(device_name))
        self.hf_device_map = getattr(self.model, "hf_device_map", None)
        if device_name == "cuda":
            mapped_devices = {
                str(value)
                for value in (self.hf_device_map or {}).values()
            }
            if not any(value == "0" or value.startswith("cuda") for value in mapped_devices):
                raise RuntimeError("CUDA_MAPPING_UNAVAILABLE")

    def _encode(self, batch: Any) -> Any:
        with self.torch.inference_mode():
            output = self.model(**move_batch(batch, self.device))
        return colqwen_token_tensor(output, self.torch).float().cpu()

    def encode_images(self, images: list[Any]) -> list[Any]:
        result = []
        for image in images:
            result.append(self._encode(
                self.processor(images=[image], return_tensors="pt"),
            ))
        return result

    def encode_text(self, text: str) -> Any:
        return self._encode(
            self.processor(text=[text], return_tensors="pt"),
        )

    def combine_queries(self, text_query: Any, image_query: Any) -> Any:
        return self.torch.cat([text_query, image_query], dim=0)

    def score(self, query: Any, candidate: Any) -> float:
        similarities = self.torch.einsum(
            "qd,pd->qp",
            query.float(),
            candidate.float(),
        )
        return float(similarities.max(dim=1).values.sum().item())


def create_adapter(
    adapter_name: str,
    model_dir: Path,
    device: str,
    offload_dir: Path,
    gpu_memory_gib: float,
) -> VisualAdapter:
    if adapter_name == "siglip2":
        return Siglip2Adapter(model_dir, device)
    if adapter_name == "colqwen2":
        return Colqwen2Adapter(
            model_dir,
            device,
            offload_dir,
            gpu_memory_gib,
        )
    raise ValueError("ADAPTER_UNSUPPORTED")


def normalized_crop_box(image: Any, region: dict[str, Any]) -> tuple[int, int, int, int]:
    width, height = image.size
    left = round(region["x"] * width)
    top = round(region["y"] * height)
    right = round((region["x"] + region["width"]) * width)
    bottom = round((region["y"] + region["height"]) * height)
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise ValueError("VISUAL_CROP_OUT_OF_BOUNDS")
    return left, top, right, bottom


def asset_regions(asset_path: str) -> list[dict[str, Any]]:
    filename = asset_path.rsplit("/", 1)[-1]
    if filename.startswith("poster-"):
        return [dict(ORIGINAL_ART), dict(ANALYSIS_OVERLAY)]
    return [dict(FULL_IMAGE)]


def load_verified_assets(
    workspace_root: Path,
    corpus_path: Path,
    asset_manifest_path: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    corpus = read_json(corpus_path)
    if corpus.get("schemaVersion") != 2:
        raise ValueError("CORPUS_SCHEMA_UNSUPPORTED")
    corpus_hash = require_hash(corpus.get("bundleHash"), "CORPUS_HASH")
    manifest = read_json(asset_manifest_path)
    if manifest.get("root") != "data/courses" or manifest.get("assetCount") != 156:
        raise ValueError("ASSET_MANIFEST_UNEXPECTED")
    manifest_assets = {
        record["path"]: record
        for record in manifest.get("assets", [])
        if isinstance(record, dict) and isinstance(record.get("path"), str)
    }
    if len(manifest_assets) != manifest.get("assetCount"):
        raise ValueError("ASSET_MANIFEST_DUPLICATE_PATH")

    course_by_asset_id: dict[str, str] = {}
    for knowledge_object in corpus.get("objects", []):
        course_pack_id = knowledge_object.get("sourceCoursePack", {}).get("id")
        for asset_id in knowledge_object.get("assetIds", []):
            existing = course_by_asset_id.get(asset_id)
            if existing is not None and existing != course_pack_id:
                raise ValueError("ASSET_COURSE_OWNERSHIP_CONFLICT")
            course_by_asset_id[asset_id] = course_pack_id

    course_root = (workspace_root / "data" / "courses").resolve(strict=True)
    verified: list[dict[str, Any]] = []
    for asset in sorted(corpus.get("assets", []), key=lambda item: item["id"]):
        if asset.get("kind") != "IMAGE" or asset.get("mimeType") != "image/png":
            raise ValueError("VISUAL_ASSET_KIND_UNSUPPORTED")
        locator = asset.get("locator", {})
        if locator.get("root") != "data/courses":
            raise ValueError("VISUAL_ASSET_ROOT_INVALID")
        asset_path = locator.get("path")
        if not isinstance(asset_path, str) or "\\" in asset_path or ".." in asset_path.split("/"):
            raise ValueError("VISUAL_ASSET_PATH_INVALID")
        physical = (course_root / Path(*asset_path.split("/"))).resolve(strict=True)
        try:
            physical.relative_to(course_root)
        except ValueError as error:
            raise ValueError("VISUAL_ASSET_PATH_ESCAPE") from error
        if not physical.is_file() or physical.is_symlink():
            raise ValueError("VISUAL_ASSET_NOT_REGULAR_FILE")
        expected = manifest_assets.get(asset_path)
        if expected is None:
            raise ValueError("VISUAL_ASSET_MANIFEST_MISSING")
        size_bytes = physical.stat().st_size
        content_hash = sha256_file(physical)
        if (
            size_bytes != asset.get("sizeBytes")
            or size_bytes != expected.get("sizeBytes")
            or content_hash != asset.get("sha256")
            or content_hash != expected.get("sha256")
        ):
            raise ValueError("VISUAL_ASSET_BYTES_DRIFT")
        course_pack_id = course_by_asset_id.get(asset["id"])
        if not isinstance(course_pack_id, str):
            raise ValueError("VISUAL_ASSET_COURSE_MISSING")
        verified.append({
            "assetId": asset["id"],
            "coursePackId": course_pack_id,
            "sha256": content_hash,
            "physical": physical,
            "regions": asset_regions(asset_path),
        })
    if len(verified) != 156:
        raise ValueError("VISUAL_ASSET_COUNT_DRIFT")
    return {
        "corpusBundleHash": corpus_hash,
        "assetManifestSha256": sha256_file(asset_manifest_path),
        "assetCount": len(verified),
    }, verified


def cuda_metrics(torch: Any) -> dict[str, Any]:
    if not torch.cuda.is_available():
        return {
            "available": False,
            "allocatedBytes": 0,
            "reservedBytes": 0,
            "peakAllocatedBytes": 0,
            "peakReservedBytes": 0,
        }
    free_bytes, total_bytes = torch.cuda.mem_get_info()
    return {
        "available": True,
        "deviceName": torch.cuda.get_device_name(0),
        "freeBytes": free_bytes,
        "totalBytes": total_bytes,
        "allocatedBytes": torch.cuda.memory_allocated(),
        "reservedBytes": torch.cuda.memory_reserved(),
        "peakAllocatedBytes": torch.cuda.max_memory_allocated(),
        "peakReservedBytes": torch.cuda.max_memory_reserved(),
    }


def process_rss_bytes() -> int:
    import psutil
    return psutil.Process().memory_info().rss


def visual_region_identity(regions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "name": region["name"],
            "bbox": (
                region["bbox"]
                if "bbox" in region
                else {
                    "coordinateSpace": "NORMALIZED",
                    "x": region["x"],
                    "y": region["y"],
                    "width": region["width"],
                    "height": region["height"],
                }
            ),
        }
        for region in regions
    ]


def cross_language_numeric_identity(value: Any) -> Any:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        numeric = float(value)
        if not math.isfinite(numeric):
            raise ValueError("VISUAL_INCREMENTAL_NUMERIC_IDENTITY_INVALID")
        formatted = f"{numeric:.12f}".rstrip("0").rstrip(".")
        if formatted in ("", "-0"):
            formatted = "0"
        return {"$number": formatted}
    if isinstance(value, list):
        return [cross_language_numeric_identity(item) for item in value]
    if isinstance(value, dict):
        return {
            key: cross_language_numeric_identity(item)
            for key, item in value.items()
        }
    raise ValueError("VISUAL_INCREMENTAL_IDENTITY_INVALID")


def visual_reuse_key(
    *,
    source_sha256: str,
    regions: list[dict[str, Any]],
    config: dict[str, Any],
    model_revision: str,
) -> str:
    return sha256_bytes(canonical_json(cross_language_numeric_identity({
        "sourceSha256": source_sha256,
        "regions": visual_region_identity(regions),
        "config": config,
        "modelRevision": model_revision,
    })))


def visual_incremental_compatibility_payload(
    *,
    adapter_name: str,
    representation_kind: str,
    dimensions: int,
    index_version_id: str,
    model_digest: str,
    model_seal_hash: str,
    model_files: list[dict[str, Any]],
    config: dict[str, Any],
) -> dict[str, Any]:
    model_info = MODELS[adapter_name]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "provider": adapter_name,
        "identity": {
            "indexVersionId": index_version_id,
            "modelId": model_info["id"],
            "modelRevision": model_info["revision"],
        },
        "adapter": {
            "name": adapter_name,
            "kind": representation_kind,
            "dimensions": dimensions,
            "capabilities": model_info["capabilities"],
        },
        "modelDirectorySha256": model_digest,
        "modelSealSha256": model_seal_hash,
        "modelFiles": model_files,
        "config": config,
    }


def visual_manifest_compatibility_payload(
    manifest: dict[str, Any],
) -> dict[str, Any]:
    identity = manifest["identity"]
    return {
        "schemaVersion": manifest["schemaVersion"],
        "provider": manifest["adapter"]["name"],
        "identity": {
            "indexVersionId": identity["indexVersionId"],
            "modelId": identity["modelId"],
            "modelRevision": identity["modelRevision"],
        },
        "adapter": manifest["adapter"],
        "modelDirectorySha256": manifest["modelDirectorySha256"],
        "modelSealSha256": manifest["modelSealSha256"],
        "modelFiles": manifest["modelFiles"],
        "config": manifest["config"],
    }


def create_visual_incremental_plan(
    *,
    adapter_name: str,
    corpus_hash: str,
    config: dict[str, Any],
    model_revision: str,
    compatibility_hash: str,
    base_manifest: dict[str, Any] | None,
    base_compatible: bool,
    assets: list[dict[str, Any]],
) -> dict[str, Any]:
    base_entries = [] if base_manifest is None else base_manifest["entries"]
    base_by_id = {
        entry["assetId"]: (ordinal, entry)
        for ordinal, entry in enumerate(base_entries)
    }
    target_ids = {asset["assetId"] for asset in assets}
    actions = []
    reused = 0
    for target_ordinal, asset in enumerate(assets):
        reuse_key = visual_reuse_key(
            source_sha256=asset["sha256"],
            regions=asset["regions"],
            config=config,
            model_revision=model_revision,
        )
        base = base_by_id.get(asset["assetId"])
        base_reuse_key = (
            None
            if base is None
            else visual_reuse_key(
                source_sha256=base[1]["sourceSha256"],
                regions=base[1]["regions"],
                config=base_manifest["config"],
                model_revision=base_manifest["identity"]["modelRevision"],
            )
        )
        if base_compatible and base is not None and base_reuse_key == reuse_key:
            actions.append({
                "action": "REUSE",
                "recordId": asset["assetId"],
                "reuseKey": reuse_key,
                "targetOrdinal": target_ordinal,
                "baseOrdinal": base[0],
            })
            reused += 1
        else:
            actions.append({
                "action": "REBUILD",
                "recordId": asset["assetId"],
                "reuseKey": reuse_key,
                "targetOrdinal": target_ordinal,
            })
    deleted = 0
    for base_ordinal, entry in enumerate(base_entries):
        if entry["assetId"] not in target_ids:
            actions.append({
                "action": "DELETE",
                "recordId": entry["assetId"],
                "reuseKey": visual_reuse_key(
                    source_sha256=entry["sourceSha256"],
                    regions=entry["regions"],
                    config=base_manifest["config"],
                    model_revision=base_manifest["identity"]["modelRevision"],
                ),
                "baseOrdinal": base_ordinal,
            })
            deleted += 1
    return {
        "schemaVersion": 2,
        "provider": adapter_name,
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
            "rebuilt": len(assets) - reused,
            "deleted": deleted,
        },
    }


def write_visual_incremental_plan(
    path: Path,
    plan: dict[str, Any],
) -> None:
    target = path.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.is_symlink():
        raise ValueError("VISUAL_INCREMENTAL_PLAN_PATH_INVALID")
    draft = target.with_name(f".{target.name}.{uuid.uuid4()}.tmp")
    try:
        write_json(draft, plan)
        draft.replace(target)
    finally:
        if draft.exists():
            draft.unlink()


def load_verified_visual_index_state(
    *,
    adapter_name: str,
    model_dir: Path,
    model_seal: Path,
    index_dir: Path,
    require_directory_name: bool = True,
) -> Any:
    import torch
    from safetensors.torch import load_file

    resolved_index_dir = index_dir.resolve(strict=True)
    manifest_path = (resolved_index_dir / "manifest.json").resolve(strict=True)
    if (
        manifest_path.parent != resolved_index_dir
        or manifest_path.is_symlink()
    ):
        raise ValueError("VISUAL_INDEX_MANIFEST_PATH_INVALID")
    manifest = read_json(manifest_path)
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError("VISUAL_INDEX_SCHEMA_UNSUPPORTED")
    if manifest.get("adapter", {}).get("name") != adapter_name:
        raise ValueError("VISUAL_INDEX_ADAPTER_MISMATCH")
    model_info = MODELS[adapter_name]
    identity = manifest.get("identity", {})
    aggregation_by_mode = single_vector_aggregation_by_mode(
        manifest.get("config", {}),
        manifest.get("adapter", {}).get("kind"),
    )
    expected_index_version = index_version_for_aggregation(
        adapter_name,
        aggregation_by_mode.get(
            "IMAGE_TO_IMAGE",
            DEFAULT_SINGLE_VECTOR_AGGREGATION,
        ),
    )
    if (
        identity.get("modelId") != model_info["id"]
        or identity.get("modelRevision") != model_info["revision"]
        or identity.get("indexVersionId") != expected_index_version
    ):
        raise ValueError("VISUAL_INDEX_MODEL_IDENTITY_MISMATCH")
    payload = manifest.get("payload", {})
    payload_path = (
        resolved_index_dir / payload.get("filename", "")
    ).resolve(strict=True)
    try:
        payload_path.relative_to(resolved_index_dir)
    except ValueError as error:
        raise ValueError("VISUAL_INDEX_PAYLOAD_PATH_ESCAPE") from error
    if (
        payload_path.is_symlink()
        or payload_path.stat().st_size != payload.get("sizeBytes")
        or sha256_file(payload_path) != payload.get("sha256")
    ):
        raise ValueError("VISUAL_INDEX_PAYLOAD_DRIFT")
    model_digest, model_files, model_seal_hash = verify_model_snapshot(
        adapter_name,
        model_dir,
        model_seal,
    )
    if (
        model_digest != manifest.get("modelDirectorySha256")
        or model_files != manifest.get("modelFiles")
        or model_seal_hash != manifest.get("modelSealSha256")
    ):
        raise ValueError("VISUAL_MODEL_DIRECTORY_DRIFT")
    identity_base = {
        "corpusBundleHash": identity.get("corpusBundleHash"),
        "indexVersionId": identity.get("indexVersionId"),
        "modelId": identity.get("modelId"),
        "modelRevision": identity.get("modelRevision"),
    }
    recomputed_hash = sha256_bytes(canonical_json({
        **identity_base,
        "assetManifestSha256": manifest.get("assetManifestSha256"),
        "modelDirectorySha256": model_digest,
        "modelSealSha256": model_seal_hash,
        "config": manifest.get("config"),
        "entries": manifest.get("entries"),
        "payload": payload,
    }))
    if (
        identity.get("indexBundleHash") != recomputed_hash
        or (require_directory_name and resolved_index_dir.name != recomputed_hash)
    ):
        raise ValueError("VISUAL_INDEX_BUNDLE_HASH_MISMATCH")
    state = LoadedIndex.__new__(LoadedIndex)
    state.manifest = manifest
    state.single_vector_aggregation_by_mode = aggregation_by_mode
    state.tensors = load_file(str(payload_path), device="cpu")
    state.entries = manifest["entries"]
    state.by_asset_id = {
        entry["assetId"]: entry
        for entry in state.entries
    }
    if len(state.by_asset_id) != manifest.get("assetCount"):
        raise ValueError("VISUAL_INDEX_DUPLICATE_ASSET")
    state.single_vector_i2i_aggregates = {}
    state._validate_tensors(torch)
    return state


def build_index(args: argparse.Namespace) -> dict[str, Any]:
    from PIL import Image
    import torch
    import transformers
    from safetensors.torch import save_file

    started = time.perf_counter()
    workspace_root = args.workspace_root.resolve(strict=True)
    model_dir = args.model_dir.resolve(strict=True)
    model_info = MODELS[args.adapter]
    model_digest, model_files, model_seal_hash = verify_model_snapshot(
        args.adapter,
        model_dir,
        args.model_seal,
    )
    snapshot, assets = load_verified_assets(
        workspace_root,
        args.corpus.resolve(strict=True),
        args.asset_manifest.resolve(strict=True),
    )
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
    adapter_started = time.perf_counter()
    adapter = create_adapter(
        args.adapter,
        model_dir,
        args.device,
        args.offload_dir.resolve(),
        args.gpu_memory_gib,
    )
    model_load_seconds = time.perf_counter() - adapter_started
    image_to_image_aggregation = args.single_vector_i2i_aggregation
    index_version_id = index_version_for_aggregation(
        args.adapter,
        image_to_image_aggregation,
    )
    config = {
        "schemaVersion": SCHEMA_VERSION,
        "adapter": args.adapter,
        "deviceClass": args.device,
        "regions": {
            "poster": [ORIGINAL_ART, ANALYSIS_OVERLAY],
            "grid": [FULL_IMAGE],
        },
        "sourcePixelsOnly": True,
        "answerTextExcluded": True,
        "singleVectorAggregation": "MAX_REGION",
        "multiVectorAggregation": "MAXSIM_MAX_REGION",
        "imageTextFusion": (
            "L2_NORMALIZED_EQUAL_WEIGHT_SUM"
            if args.adapter == "siglip2"
            else "QUERY_TOKEN_CONCATENATION"
        ),
        "tensorDtype": "float32",
        "runtime": {
            "python": platform.python_version(),
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "cudaRuntime": torch.version.cuda,
            "attentionBackend": "eager",
            "deterministicAlgorithms": True,
            "gpuMemoryBudgetGiB": getattr(
                adapter,
                "gpu_memory_budget_gib",
                None,
            ),
        },
    }
    configure_single_vector_aggregation(
        config,
        adapter.representation_kind,
        image_to_image_aggregation,
    )
    compatibility = visual_incremental_compatibility_payload(
        adapter_name=args.adapter,
        representation_kind=adapter.representation_kind,
        dimensions=adapter.dimensions,
        index_version_id=index_version_id,
        model_digest=model_digest,
        model_seal_hash=model_seal_hash,
        model_files=model_files,
        config=config,
    )
    compatibility_hash = sha256_bytes(canonical_json(compatibility))
    base_state = None
    base_index_dir = getattr(args, "base_index_dir", None)
    if base_index_dir is not None:
        base_state = load_verified_visual_index_state(
            adapter_name=args.adapter,
            model_dir=model_dir,
            model_seal=args.model_seal,
            index_dir=base_index_dir,
        )
    base_compatible = (
        base_state is not None
        and sha256_bytes(canonical_json(
            visual_manifest_compatibility_payload(base_state.manifest),
        )) == compatibility_hash
    )
    plan = create_visual_incremental_plan(
        adapter_name=args.adapter,
        corpus_hash=snapshot["corpusBundleHash"],
        config=config,
        model_revision=model_info["revision"],
        compatibility_hash=compatibility_hash,
        base_manifest=None if base_state is None else base_state.manifest,
        base_compatible=base_compatible,
        assets=assets,
    )

    tensor_map: dict[str, Any] = {}
    entries: list[dict[str, Any]] = []
    global_vectors: list[Any] = []
    current_actions = [
        action
        for action in plan["actions"]
        if action["action"] != "DELETE"
    ]
    for asset_index, (asset, action) in enumerate(zip(
        assets,
        current_actions,
        strict=True,
    )):
        if action["action"] == "REUSE":
            if base_state is None:
                raise ValueError("VISUAL_INCREMENTAL_BASE_MISSING")
            base_entry = base_state.entries[action["baseOrdinal"]]
            embeddings = [
                base_state.region_tensor(region)
                .detach()
                .to(device="cpu", dtype=torch.float32)
                .clone()
                for region in base_entry["regions"]
            ]
        else:
            with Image.open(asset["physical"]) as opened:
                opened.verify()
            with Image.open(asset["physical"]) as opened:
                image = opened.convert("RGB")
                crops = [
                    image.crop(normalized_crop_box(image, region))
                    for region in asset["regions"]
                ]
            embeddings = adapter.encode_images(crops)
        if len(embeddings) != len(asset["regions"]):
            raise ValueError("VISUAL_EMBEDDING_COUNT_DRIFT")
        if any(
            not bool(torch.isfinite(embedding.float()).all().item())
            for embedding in embeddings
        ):
            raise ValueError("VISUAL_EMBEDDING_NOT_FINITE")
        if (
            adapter.representation_kind == "SINGLE_VECTOR"
            and image_to_image_aggregation
                == "L2_NORMALIZED_MEAN_REGION"
        ):
            l2_normalized_mean_region(embeddings, torch)
        regions = []
        for region_index, (region, embedding) in enumerate(zip(
            asset["regions"],
            embeddings,
            strict=True,
        )):
            if embedding.shape[-1] != adapter.dimensions:
                raise ValueError("VISUAL_EMBEDDING_DIMENSION_DRIFT")
            tensor_key = f"e{asset_index:04d}_{region_index}"
            if adapter.representation_kind == "SINGLE_VECTOR":
                vector_offset = len(global_vectors)
                global_vectors.append(embedding.float().cpu())
                tensor_key = "embeddings"
            else:
                tensor_map[tensor_key] = embedding.float().cpu().contiguous()
                vector_offset = None
            regions.append({
                "name": region["name"],
                "bbox": {
                    "coordinateSpace": "NORMALIZED",
                    "x": region["x"],
                    "y": region["y"],
                    "width": region["width"],
                    "height": region["height"],
                },
                "tensorKey": tensor_key,
                "vectorOffset": vector_offset,
                "vectorCount": (
                    1 if adapter.representation_kind == "SINGLE_VECTOR"
                    else int(embedding.shape[0])
                ),
            })
        entries.append({
            "assetId": asset["assetId"],
            "coursePackId": asset["coursePackId"],
            "sourceSha256": asset["sha256"],
            "representationId": (
                f"{args.adapter}-asset-{asset['assetId'].removeprefix('asset-')}"
            ),
            "regions": regions,
        })

    if global_vectors:
        tensor_map["embeddings"] = torch.stack(global_vectors).contiguous()
    draft_dir = args.output_root.resolve() / f".building-{uuid.uuid4()}"
    draft_dir.mkdir(parents=True, exist_ok=False)
    try:
        payload_path = draft_dir / "embeddings.safetensors"
        save_file(tensor_map, str(payload_path))
        payload = {
            "filename": payload_path.name,
            "sizeBytes": payload_path.stat().st_size,
            "sha256": sha256_file(payload_path),
        }
        identity_base = {
            "corpusBundleHash": snapshot["corpusBundleHash"],
            "indexVersionId": index_version_id,
            "modelId": model_info["id"],
            "modelRevision": model_info["revision"],
        }
        index_bundle_hash = sha256_bytes(canonical_json({
            **identity_base,
            "assetManifestSha256": snapshot["assetManifestSha256"],
            "modelDirectorySha256": model_digest,
            "modelSealSha256": model_seal_hash,
            "config": config,
            "entries": entries,
            "payload": payload,
        }))
        identity = {
            **identity_base,
            "indexBundleHash": index_bundle_hash,
        }
        plan["outputIndexBundleHash"] = index_bundle_hash
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "identity": identity,
            "adapter": {
                "name": args.adapter,
                "kind": adapter.representation_kind,
                "dimensions": adapter.dimensions,
                "capabilities": model_info["capabilities"],
            },
            "assetCount": len(entries),
            "regionCount": sum(len(entry["regions"]) for entry in entries),
            "assetManifestSha256": snapshot["assetManifestSha256"],
            "modelDirectorySha256": model_digest,
            "modelSealSha256": model_seal_hash,
            "modelFiles": model_files,
            "config": config,
            "payload": payload,
            "entries": entries,
        }
        write_json(draft_dir / "manifest.json", manifest)
        total_seconds = time.perf_counter() - started
        metrics = {
            "schemaVersion": SCHEMA_VERSION,
            "adapter": args.adapter,
            "assetCount": len(entries),
            "regionCount": manifest["regionCount"],
            "modelLoadSeconds": model_load_seconds,
            "buildSeconds": total_seconds,
            "imagesPerSecond": len(entries) / max(total_seconds, 0.001),
            "processRssBytes": process_rss_bytes(),
            "cuda": cuda_metrics(torch),
            "indexSizeBytes": (
                payload["sizeBytes"]
                + (draft_dir / "manifest.json").stat().st_size
            ),
        }
        write_json(draft_dir / "build-metrics.json", metrics)
        load_verified_visual_index_state(
            adapter_name=args.adapter,
            model_dir=model_dir,
            model_seal=args.model_seal,
            index_dir=draft_dir,
            require_directory_name=False,
        )
        final_dir = args.output_root.resolve() / args.adapter / index_bundle_hash
        final_dir.parent.mkdir(parents=True, exist_ok=True)
        if final_dir.exists():
            existing = load_verified_visual_index_state(
                adapter_name=args.adapter,
                model_dir=model_dir,
                model_seal=args.model_seal,
                index_dir=final_dir,
            )
            if existing.manifest != manifest:
                raise ValueError("VISUAL_INDEX_EXISTING_GENERATION_CONFLICT")
            shutil.rmtree(draft_dir)
        else:
            draft_dir.replace(final_dir)
        incremental_plan_output = getattr(
            args,
            "incremental_plan_output",
            None,
        )
        if incremental_plan_output is not None:
            write_visual_incremental_plan(incremental_plan_output, plan)
        return {
            "indexDirectory": str(final_dir),
            "identity": identity,
            "assetCount": len(entries),
            "regionCount": manifest["regionCount"],
            "payload": payload,
            "metrics": metrics,
            "incrementalPlan": plan,
        }
    except Exception:
        if draft_dir.exists():
            shutil.rmtree(draft_dir)
        raise


class LoadedIndex:
    def __init__(
        self,
        adapter_name: str,
        model_dir: Path,
        model_seal: Path,
        index_dir: Path,
        device: str,
        offload_dir: Path,
        gpu_memory_gib: float,
    ):
        verified = load_verified_visual_index_state(
            adapter_name=adapter_name,
            model_dir=model_dir,
            model_seal=model_seal,
            index_dir=index_dir,
        )
        self.manifest = verified.manifest
        self.single_vector_aggregation_by_mode = (
            verified.single_vector_aggregation_by_mode
        )
        self.tensors = verified.tensors
        self.entries = verified.entries
        self.by_asset_id = verified.by_asset_id
        self.single_vector_i2i_aggregates = (
            verified.single_vector_i2i_aggregates
        )
        self.adapter = create_adapter(
            adapter_name,
            model_dir,
            device,
            offload_dir,
            gpu_memory_gib,
        )

    def _validate_tensors(self, torch: Any) -> None:
        adapter = self.manifest["adapter"]
        dimensions = adapter.get("dimensions")
        representation_kind = adapter.get("kind")
        if (
            dimensions != MODELS[adapter["name"]]["dimensions"]
            or self.manifest.get("config", {}).get("tensorDtype") != "float32"
        ):
            raise ValueError("VISUAL_INDEX_TENSOR_CONFIG_MISMATCH")
        representation_ids: set[str] = set()
        asset_ids: set[str] = set()
        region_records: list[dict[str, Any]] = []
        for entry in self.entries:
            asset_id = entry.get("assetId")
            representation_id = entry.get("representationId")
            if (
                not isinstance(asset_id, str)
                or not isinstance(representation_id, str)
                or asset_id in asset_ids
                or representation_id in representation_ids
                or not isinstance(entry.get("coursePackId"), str)
                or not isinstance(entry.get("regions"), list)
                or len(entry["regions"]) < 1
            ):
                raise ValueError("VISUAL_INDEX_ENTRY_INVALID")
            require_hash(entry.get("sourceSha256"), "VISUAL_SOURCE_HASH")
            asset_ids.add(asset_id)
            representation_ids.add(representation_id)
            for region in entry["regions"]:
                bbox = region.get("bbox", {})
                values = [
                    bbox.get("x"),
                    bbox.get("y"),
                    bbox.get("width"),
                    bbox.get("height"),
                ]
                if (
                    bbox.get("coordinateSpace") != "NORMALIZED"
                    or not all(isinstance(value, (int, float)) for value in values)
                    or values[0] < 0
                    or values[1] < 0
                    or values[2] <= 0
                    or values[3] <= 0
                    or values[0] + values[2] > 1
                    or values[1] + values[3] > 1
                ):
                    raise ValueError("VISUAL_INDEX_REGION_INVALID")
                region_records.append(region)
        if (
            len(region_records) != self.manifest.get("regionCount")
            or len(asset_ids) != self.manifest.get("assetCount")
        ):
            raise ValueError("VISUAL_INDEX_COUNT_MISMATCH")

        tensor_keys = set(self.tensors)
        if representation_kind == "SINGLE_VECTOR":
            if tensor_keys != {"embeddings"}:
                raise ValueError("VISUAL_INDEX_TENSOR_KEYS_INVALID")
            embeddings = self.tensors["embeddings"]
            if (
                embeddings.dtype != torch.float32
                or list(embeddings.shape) != [len(region_records), dimensions]
                or not bool(torch.isfinite(embeddings).all().item())
            ):
                raise ValueError("VISUAL_INDEX_TENSOR_SHAPE_INVALID")
            offsets = []
            for region in region_records:
                if (
                    region.get("tensorKey") != "embeddings"
                    or region.get("vectorCount") != 1
                    or not isinstance(region.get("vectorOffset"), int)
                ):
                    raise ValueError("VISUAL_INDEX_REGION_TENSOR_INVALID")
                offsets.append(region["vectorOffset"])
            if sorted(offsets) != list(range(len(region_records))):
                raise ValueError("VISUAL_INDEX_VECTOR_OFFSETS_INVALID")
            if (
                self.single_vector_aggregation_by_mode["IMAGE_TO_IMAGE"]
                == "L2_NORMALIZED_MEAN_REGION"
            ):
                for entry in self.entries:
                    self.single_vector_i2i_aggregates[entry["assetId"]] = (
                        l2_normalized_mean_region(
                            [
                                self.region_tensor(region)
                                for region in entry["regions"]
                            ],
                            torch,
                        )
                    )
        elif representation_kind == "MULTI_VECTOR":
            expected_keys: set[str] = set()
            for region in region_records:
                tensor_key = region.get("tensorKey")
                if (
                    not isinstance(tensor_key, str)
                    or tensor_key in expected_keys
                    or region.get("vectorOffset") is not None
                ):
                    raise ValueError("VISUAL_INDEX_REGION_TENSOR_INVALID")
                expected_keys.add(tensor_key)
                tensor = self.tensors.get(tensor_key)
                if (
                    tensor is None
                    or tensor.dtype != torch.float32
                    or tensor.ndim != 2
                    or tensor.shape[0] != region.get("vectorCount")
                    or tensor.shape[1] != dimensions
                    or not bool(torch.isfinite(tensor).all().item())
                ):
                    raise ValueError("VISUAL_INDEX_TENSOR_SHAPE_INVALID")
            if tensor_keys != expected_keys:
                raise ValueError("VISUAL_INDEX_TENSOR_KEYS_INVALID")
        else:
            raise ValueError("VISUAL_INDEX_REPRESENTATION_KIND_INVALID")

    def region_tensor(self, region: dict[str, Any]) -> Any:
        tensor = self.tensors.get(region["tensorKey"])
        if tensor is None:
            raise ValueError("VISUAL_INDEX_TENSOR_MISSING")
        offset = region.get("vectorOffset")
        if offset is None:
            return tensor
        return tensor[offset]

    def encode_query_image(
        self,
        asset_id: str,
        query_image: Any,
    ) -> tuple[Any, float]:
        from PIL import Image

        decode_started = time.perf_counter()
        if (
            not isinstance(query_image, dict)
            or query_image.get("assetId") != asset_id
            or not isinstance(query_image.get("pngBase64"), str)
        ):
            raise ValueError("QUERY_IMAGE_INVALID")
        declared_hash = require_hash(query_image.get("sha256"), "QUERY_IMAGE_HASH")
        try:
            png_bytes = base64.b64decode(
                query_image["pngBase64"],
                validate=True,
            )
        except (ValueError, TypeError) as error:
            raise ValueError("QUERY_IMAGE_INVALID") from error
        if (
            len(png_bytes) < 8
            or len(png_bytes) > MAX_QUERY_IMAGE_BYTES
            or png_bytes[:8] != b"\x89PNG\r\n\x1a\n"
            or sha256_bytes(png_bytes) != declared_hash
        ):
            raise ValueError("QUERY_IMAGE_BYTES_INVALID")
        entry = self.by_asset_id.get(asset_id)
        if entry is not None and entry.get("sourceSha256") != declared_hash:
            raise ValueError("QUERY_IMAGE_INDEX_HASH_MISMATCH")
        with Image.open(io.BytesIO(png_bytes)) as opened:
            if opened.format != "PNG":
                raise ValueError("QUERY_IMAGE_FORMAT_INVALID")
            opened.verify()
        with Image.open(io.BytesIO(png_bytes)) as opened:
            image = opened.convert("RGB")
            if entry is None:
                region = FULL_IMAGE
            else:
                indexed_region = next(
                    (
                        candidate
                        for candidate in entry["regions"]
                        if candidate["name"] in ("ORIGINAL_ART", "FULL_IMAGE")
                    ),
                    None,
                )
                if indexed_region is None:
                    raise ValueError("QUERY_ASSET_REGION_MISSING")
                region = {
                    "name": indexed_region["name"],
                    **indexed_region["bbox"],
                }
            crop = image.crop(normalized_crop_box(image, region))
        decode_seconds = time.perf_counter() - decode_started
        encoded = self.adapter.encode_images([crop])
        if len(encoded) != 1:
            raise ValueError("QUERY_IMAGE_EMBEDDING_COUNT_INVALID")
        return encoded[0], decode_seconds

    def search(
        self,
        query: dict[str, Any],
        query_image: Any,
        top_k: int,
    ) -> tuple[list[dict[str, Any]], dict[str, float]]:
        started = time.perf_counter()
        mode = query.get("mode")
        if mode not in ("TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_IMAGE"):
            raise ValueError("UNSUPPORTED_MODE")
        text_query = None
        image_query = None
        if mode in ("TEXT_TO_IMAGE", "IMAGE_TEXT_TO_IMAGE"):
            text = query.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("QUERY_TEXT_INVALID")
            text_query = self.adapter.encode_text(text)
        if mode in ("IMAGE_TO_IMAGE", "IMAGE_TEXT_TO_IMAGE"):
            asset_id = query.get("queryAssetId")
            if not isinstance(asset_id, str):
                raise ValueError("QUERY_ASSET_ID_INVALID")
            image_query, image_decode_seconds = self.encode_query_image(
                asset_id,
                query_image,
            )
        else:
            image_decode_seconds = 0.0
        if mode == "TEXT_TO_IMAGE":
            encoded_query = text_query
        elif mode == "IMAGE_TO_IMAGE":
            encoded_query = image_query
        else:
            encoded_query = self.adapter.combine_queries(text_query, image_query)
        encoded_seconds = time.perf_counter() - started

        excluded = set(query.get("excludeAssetIds") or [])
        course_pack_id = query.get("coursePackId")
        score_started = time.perf_counter()
        ranked: list[tuple[float, str, dict[str, Any], dict[str, Any]]] = []
        representation_kind = self.manifest["adapter"]["kind"]
        aggregation = self.single_vector_aggregation_by_mode.get(
            mode,
            DEFAULT_SINGLE_VECTOR_AGGREGATION,
        )
        for entry in self.entries:
            asset_id = entry["assetId"]
            if asset_id in excluded:
                continue
            if course_pack_id is not None and entry["coursePackId"] != course_pack_id:
                continue
            best_score = -math.inf
            best_region = None
            region_scores = []
            region_tensors = [
                self.region_tensor(region)
                for region in entry["regions"]
            ]
            for region, region_tensor in zip(
                entry["regions"],
                region_tensors,
                strict=True,
            ):
                score = self.adapter.score(encoded_query, region_tensor)
                if not math.isfinite(score):
                    raise ValueError("VISUAL_SCORE_NOT_FINITE")
                region_scores.append((score, region))
                if score > best_score:
                    best_score = score
                    best_region = region
            if (
                representation_kind == "SINGLE_VECTOR"
                and aggregation == "L2_NORMALIZED_MEAN_REGION"
            ):
                aggregate = self.single_vector_i2i_aggregates.get(asset_id)
                if aggregate is None:
                    raise ValueError("VISUAL_REGION_AGGREGATE_MISSING")
                best_score = self.adapter.score(encoded_query, aggregate)
                if not math.isfinite(best_score):
                    raise ValueError("VISUAL_SCORE_NOT_FINITE")
                best_region = max(
                    region_scores,
                    key=lambda item: item[0],
                )[1]
            if best_region is None:
                continue
            ranked.append((best_score, asset_id, entry, best_region))
        ranked.sort(key=lambda item: (-item[0], item[1]))
        hits = []
        for rank, (score, asset_id, entry, region) in enumerate(
            ranked[:top_k],
            start=1,
        ):
            hits.append({
                "assetId": asset_id,
                "rank": rank,
                "score": score,
                "region": {
                    **region["bbox"],
                    "origin": "INDEXED_REGION",
                },
                "representationId": entry["representationId"],
            })
        score_seconds = time.perf_counter() - score_started
        total_seconds = time.perf_counter() - started
        return hits, {
            "encodeMs": encoded_seconds * 1000,
            "imageDecodeMs": image_decode_seconds * 1000,
            "scoreMs": score_seconds * 1000,
            "inferenceMs": total_seconds * 1000,
        }


def safe_error_code(error: BaseException) -> str:
    message = str(error)
    allowed = {
        "ADAPTER_UNSUPPORTED",
        "CUDA_UNAVAILABLE",
        "CUDA_MAPPING_UNAVAILABLE",
        "CUDA_MEMORY_BUDGET_UNAVAILABLE",
        "MODEL_OUTPUT_TENSOR_MISSING",
        "SIGLIP_OUTPUT_SHAPE_INVALID",
        "MULTIVECTOR_OUTPUT_SHAPE_INVALID",
        "MULTIVECTOR_OUTPUT_EMPTY",
        "VISUAL_INDEX_SCHEMA_UNSUPPORTED",
        "VISUAL_INDEX_ADAPTER_MISMATCH",
        "VISUAL_INDEX_PAYLOAD_PATH_ESCAPE",
        "VISUAL_INDEX_PAYLOAD_DRIFT",
        "VISUAL_MODEL_DIRECTORY_DRIFT",
        "VISUAL_INDEX_DUPLICATE_ASSET",
        "VISUAL_INDEX_TENSOR_MISSING",
        "VISUAL_INDEX_AGGREGATION_CONFIG_INVALID",
        "VISUAL_INDEX_AGGREGATION_UNSUPPORTED",
        "VISUAL_REGION_AGGREGATE_EMPTY",
        "VISUAL_REGION_AGGREGATE_NOT_FINITE",
        "VISUAL_REGION_AGGREGATE_ZERO_NORM",
        "VISUAL_REGION_AGGREGATE_MISSING",
        "QUERY_ASSET_NOT_INDEXED",
        "QUERY_ASSET_REGION_MISSING",
        "QUERY_IMAGE_INVALID",
        "QUERY_IMAGE_HASH_INVALID",
        "QUERY_IMAGE_BYTES_INVALID",
        "QUERY_IMAGE_INDEX_HASH_MISMATCH",
        "QUERY_IMAGE_FORMAT_INVALID",
        "QUERY_IMAGE_EMBEDDING_COUNT_INVALID",
        "VISUAL_SCORE_NOT_FINITE",
        "UNSUPPORTED_MODE",
        "QUERY_TEXT_INVALID",
        "QUERY_ASSET_ID_INVALID",
        "INVALID_REQUEST",
        "REQUEST_TOO_LARGE",
    }
    if message in allowed:
        return message
    if "out of memory" in message.lower():
        return "CUDA_OOM"
    return "INTERNAL"


def serve(args: argparse.Namespace) -> None:
    loaded = LoadedIndex(
        args.adapter,
        args.model_dir.resolve(strict=True),
        args.model_seal.resolve(strict=True),
        args.index_dir.resolve(strict=True),
        args.device,
        args.offload_dir.resolve(),
        args.gpu_memory_gib,
    )
    identity = loaded.manifest["identity"]
    ready = {
        "v": SCHEMA_VERSION,
        "type": "ready",
        "capabilities": loaded.manifest["adapter"]["capabilities"],
        "identity": identity,
    }
    sys.stdout.write(json.dumps(ready, allow_nan=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        request_id: Any = None
        try:
            if len(line.encode("utf-8")) > 24 * 1024 * 1024:
                raise ValueError("REQUEST_TOO_LARGE")
            request = json.loads(line)
            request_id = request.get("id")
            if request.get("v") != SCHEMA_VERSION or request.get("type") != "search":
                raise ValueError("INVALID_REQUEST")
            top_k = request.get("topK")
            if not isinstance(top_k, int) or not 1 <= top_k <= 50:
                raise ValueError("INVALID_REQUEST")
            query = request.get("query")
            if not isinstance(query, dict):
                raise ValueError("INVALID_REQUEST")
            hits, timing = loaded.search(
                query,
                request.get("queryImage"),
                top_k,
            )
            response = {
                "v": SCHEMA_VERSION,
                "type": "result",
                "id": request_id,
                "status": "SUCCESS" if hits else "EMPTY",
                "reason": None,
                "hits": hits,
                "index": identity,
                "timing": {
                    "queueMs": 0,
                    "inferenceMs": timing["inferenceMs"],
                    "totalMs": timing["inferenceMs"],
                },
                "diagnosticTiming": timing,
            }
        except Exception as error:
            error_code = safe_error_code(error)
            response = {
                "v": SCHEMA_VERSION,
                "type": "result",
                "id": request_id,
                "status": "ERROR",
                "reason": "PROVIDER_UNAVAILABLE",
                "hits": [],
                "index": None,
                "timing": {
                    "queueMs": 0,
                    "inferenceMs": 0,
                    "totalMs": 0,
                },
                "error": {
                    "code": error_code,
                    "retryable": error_code not in {
                        "INVALID_REQUEST",
                        "UNSUPPORTED_MODE",
                        "QUERY_TEXT_INVALID",
                        "QUERY_ASSET_ID_INVALID",
                        "QUERY_IMAGE_INVALID",
                        "QUERY_IMAGE_HASH_INVALID",
                        "QUERY_IMAGE_BYTES_INVALID",
                        "QUERY_IMAGE_INDEX_HASH_MISMATCH",
                        "QUERY_IMAGE_FORMAT_INVALID",
                        "CUDA_OOM",
                    },
                },
            }
        sys.stdout.write(json.dumps(
            response,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ) + "\n")
        sys.stdout.flush()
        if response.get("error", {}).get("code") == "CUDA_OOM":
            raise SystemExit(70)


def download_model(args: argparse.Namespace) -> dict[str, Any]:
    from huggingface_hub import snapshot_download

    model = MODELS[args.adapter]
    local = snapshot_download(
        repo_id=model["id"],
        revision=model["revision"],
        cache_dir=str(args.cache_dir.resolve()),
        local_files_only=False,
    )
    model_dir = Path(local).resolve(strict=True)
    seal = model_snapshot_seal(args.adapter, model_dir)
    seal_path = args.seal_path.resolve()
    seal_path.parent.mkdir(parents=True, exist_ok=True)
    if seal_path.exists():
        if read_json(seal_path) != seal:
            raise ValueError("MODEL_SNAPSHOT_EXISTING_SEAL_CONFLICT")
    else:
        draft = seal_path.with_name(f".{seal_path.name}.{uuid.uuid4()}.tmp")
        write_json(draft, seal)
        draft.replace(seal_path)
    return {
        "adapter": args.adapter,
        "modelId": model["id"],
        "modelRevision": model["revision"],
        "modelDirectory": str(model_dir),
        "modelDirectorySha256": seal["modelDirectorySha256"],
        "modelSeal": str(seal_path),
        "modelSealSha256": sha256_file(seal_path),
        "fileCount": len(seal["files"]),
        "totalBytes": sum(record["sizeBytes"] for record in seal["files"]),
    }


def probe(args: argparse.Namespace) -> dict[str, Any]:
    from PIL import Image
    import torch

    model_info = MODELS[args.adapter]
    model_dir = args.model_dir.resolve(strict=True)
    digest, records, seal_hash = verify_model_snapshot(
        args.adapter,
        model_dir,
        args.model_seal,
    )
    started = time.perf_counter()
    adapter = create_adapter(
        args.adapter,
        model_dir,
        args.device,
        args.offload_dir.resolve(),
        args.gpu_memory_gib,
    )
    model_load_seconds = time.perf_counter() - started
    smoke_started = time.perf_counter()
    text_embedding = adapter.encode_text("版式层级与视觉动线")
    image_embedding = adapter.encode_images([
        Image.new("RGB", (224, 224), color=(32, 96, 160)),
    ])
    if len(image_embedding) != 1:
        raise ValueError("PROBE_IMAGE_EMBEDDING_COUNT_INVALID")
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    smoke_seconds = time.perf_counter() - smoke_started
    return {
        "adapter": args.adapter,
        "modelId": model_info["id"],
        "modelRevision": model_info["revision"],
        "modelDirectorySha256": digest,
        "modelSealSha256": seal_hash,
        "fileCount": len(records),
        "dimensions": adapter.dimensions,
        "representationKind": adapter.representation_kind,
        "textEmbeddingShape": list(text_embedding.shape),
        "imageEmbeddingShape": list(image_embedding[0].shape),
        "loadSeconds": model_load_seconds,
        "smokeSeconds": smoke_seconds,
        "processRssBytes": process_rss_bytes(),
        "hfDeviceMap": getattr(adapter, "hf_device_map", None),
        "gpuMemoryBudgetGiB": getattr(adapter, "gpu_memory_budget_gib", None),
        "cuda": cuda_metrics(torch),
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Lumi isolated self-hosted visual retrieval POC",
    )
    subparsers = result.add_subparsers(dest="command", required=True)

    download = subparsers.add_parser("download")
    download.add_argument("--adapter", choices=sorted(MODELS), required=True)
    download.add_argument("--cache-dir", type=Path, required=True)
    download.add_argument("--seal-path", type=Path, required=True)

    for name in ("probe", "build", "serve"):
        command = subparsers.add_parser(name)
        command.add_argument("--adapter", choices=sorted(MODELS), required=True)
        command.add_argument("--model-dir", type=Path, required=True)
        command.add_argument("--model-seal", type=Path, required=True)
        command.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
        command.add_argument("--offload-dir", type=Path, required=True)
        command.add_argument("--gpu-memory-gib", type=float, default=3.5)
        if name == "build":
            command.add_argument("--workspace-root", type=Path, required=True)
            command.add_argument("--corpus", type=Path, required=True)
            command.add_argument("--asset-manifest", type=Path, required=True)
            command.add_argument("--output-root", type=Path, required=True)
            command.add_argument("--base-index-dir", type=Path)
            command.add_argument("--incremental-plan-output", type=Path)
            command.add_argument(
                "--single-vector-i2i-aggregation",
                choices=SINGLE_VECTOR_AGGREGATIONS,
                default=DEFAULT_SINGLE_VECTOR_AGGREGATION,
            )
        if name == "serve":
            command.add_argument("--index-dir", type=Path, required=True)
    return result


def main(argv: Iterable[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.command == "download":
        output = download_model(args)
    elif args.command == "probe":
        output = probe(args)
    elif args.command == "build":
        output = build_index(args)
    elif args.command == "serve":
        serve(args)
        return 0
    else:
        raise AssertionError(args.command)
    sys.stdout.write(json.dumps(
        output,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ) + "\n")
    return 0


if __name__ == "__main__":
    try:
        exit_code = main()
    except KeyboardInterrupt:
        raise
    except Exception as error:
        sys.stderr.write(json.dumps({
            "ok": False,
            "code": safe_error_code(error),
            "message": str(error),
        }, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
        exit_code = 1
    raise SystemExit(exit_code)

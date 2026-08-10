from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
import torch
from safetensors.torch import save_file


MODULE_PATH = Path(__file__).with_name("poc.py")
SPEC = importlib.util.spec_from_file_location("lumi_visual_poc", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load visual retrieval POC")
POC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POC)


class FakeAdapter:
    dimensions = 768
    representation_kind = "SINGLE_VECTOR"
    torch = torch

    def __init__(self) -> None:
        self.encoded_sizes: list[tuple[int, int]] = []

    def encode_images(self, images: list[Image.Image]) -> list[torch.Tensor]:
        self.encoded_sizes.extend(image.size for image in images)
        return [torch.ones(768, dtype=torch.float32) for _ in images]

    def encode_text(self, _text: str) -> torch.Tensor:
        return torch.tensor([1.0, 0.0], dtype=torch.float32)

    def combine_queries(
        self,
        text_query: torch.Tensor,
        image_query: torch.Tensor,
    ) -> torch.Tensor:
        combined = text_query + image_query
        return combined / torch.linalg.vector_norm(combined)

    def score(
        self,
        query: torch.Tensor,
        candidate: torch.Tensor,
    ) -> float:
        return float(torch.dot(query.float(), candidate.float()).item())


class VisualPocIntegrityTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        revision = POC.MODELS["siglip2"]["revision"]
        self.model_dir = self.root / "models" / "snapshots" / revision
        self.model_dir.mkdir(parents=True)
        (self.model_dir / "config.json").write_text("{}", encoding="utf-8")
        self.seal_path = self.root / "seals" / "siglip2.json"
        self.seal_path.parent.mkdir(parents=True)
        POC.write_json(
            self.seal_path,
            POC.model_snapshot_seal("siglip2", self.model_dir),
        )

        image_stream = io.BytesIO()
        Image.new("RGB", (64, 48), color=(40, 120, 180)).save(
            image_stream,
            format="PNG",
        )
        self.png_bytes = image_stream.getvalue()
        self.image_hash = hashlib.sha256(self.png_bytes).hexdigest()
        self.asset_id = f"asset-{'1' * 64}"

        staging = self.root / "index-staging"
        staging.mkdir()
        payload_path = staging / "embeddings.safetensors"
        save_file(
            {"embeddings": torch.ones((1, 768), dtype=torch.float32)},
            str(payload_path),
        )
        payload = {
            "filename": payload_path.name,
            "sizeBytes": payload_path.stat().st_size,
            "sha256": POC.sha256_file(payload_path),
        }
        model_digest, model_files, seal_hash = POC.verify_model_snapshot(
            "siglip2",
            self.model_dir,
            self.seal_path,
        )
        identity_base = {
            "corpusBundleHash": "a" * 64,
            "indexVersionId": POC.MODELS["siglip2"]["index_version"],
            "modelId": POC.MODELS["siglip2"]["id"],
            "modelRevision": revision,
        }
        entries = [{
            "assetId": self.asset_id,
            "coursePackId": "layout-design",
            "sourceSha256": self.image_hash,
            "representationId": f"siglip2-asset-{'1' * 64}",
            "regions": [{
                "name": "FULL_IMAGE",
                "bbox": {
                    "coordinateSpace": "NORMALIZED",
                    "x": 0.0,
                    "y": 0.0,
                    "width": 1.0,
                    "height": 1.0,
                },
                "tensorKey": "embeddings",
                "vectorOffset": 0,
                "vectorCount": 1,
            }],
        }]
        config = {"tensorDtype": "float32"}
        manifest_hash = POC.sha256_bytes(POC.canonical_json({
            **identity_base,
            "assetManifestSha256": "b" * 64,
            "modelDirectorySha256": model_digest,
            "modelSealSha256": seal_hash,
            "config": config,
            "entries": entries,
            "payload": payload,
        }))
        self.index_dir = self.root / "indexes" / manifest_hash
        self.index_dir.parent.mkdir()
        staging.replace(self.index_dir)
        self.manifest_path = self.index_dir / "manifest.json"
        POC.write_json(self.manifest_path, {
            "schemaVersion": 1,
            "identity": {
                **identity_base,
                "indexBundleHash": manifest_hash,
            },
            "adapter": {
                "name": "siglip2",
                "kind": "SINGLE_VECTOR",
                "dimensions": 768,
                "capabilities": POC.MODELS["siglip2"]["capabilities"],
            },
            "assetCount": 1,
            "regionCount": 1,
            "assetManifestSha256": "b" * 64,
            "modelDirectorySha256": model_digest,
            "modelSealSha256": seal_hash,
            "modelFiles": model_files,
            "config": config,
            "payload": payload,
            "entries": entries,
        })

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def load(self) -> tuple[object, FakeAdapter]:
        adapter = FakeAdapter()
        with patch.object(POC, "create_adapter", return_value=adapter):
            loaded = POC.LoadedIndex(
                "siglip2",
                self.model_dir,
                self.seal_path,
                self.index_dir,
                "cpu",
                self.root / "offload",
                0.0,
            )
        return loaded, adapter

    def test_visual_reuse_key_has_cross_language_numeric_identity(self) -> None:
        self.assertEqual(
            POC.visual_reuse_key(
                source_sha256="a" * 64,
                regions=[{
                    "name": "FULL_IMAGE",
                    "bbox": {
                        "coordinateSpace": "NORMALIZED",
                        "x": 0.0,
                        "y": 0,
                        "width": 1.0,
                        "height": 0.3333333333333333,
                    },
                }],
                config={"gpu": 3.5, "nested": [0.0, 12]},
                model_revision="revision",
            ),
            "1ab786ff0e5feb1c68d1b0d58e6b60911ba2732a5e3ea893c8eb1bdbced61691",
        )

    def test_incremental_build_matches_full_build_and_counts_changes(self) -> None:
        class DeterministicBuildAdapter(FakeAdapter):
            def encode_images(
                self,
                images: list[Image.Image],
            ) -> list[torch.Tensor]:
                self.encoded_sizes.extend(image.size for image in images)
                vectors = []
                for image in images:
                    pixel = image.resize((1, 1)).getpixel((0, 0))
                    vector = torch.zeros(768, dtype=torch.float32)
                    vector[:3] = torch.tensor(pixel, dtype=torch.float32) / 255
                    vectors.append(
                        vector / torch.linalg.vector_norm(vector),
                    )
                return vectors

            def encode_text(self, text: str) -> torch.Tensor:
                digest = bytes.fromhex(
                    hashlib.sha256(text.encode("utf-8")).hexdigest(),
                )
                vector = torch.zeros(768, dtype=torch.float32)
                for offset, value in enumerate(digest):
                    vector[offset] = value / 255
                return vector / torch.linalg.vector_norm(vector)

        def png(path: Path, color: tuple[int, int, int]) -> str:
            Image.new("RGB", (64, 48), color=color).save(path, format="PNG")
            return POC.sha256_file(path)

        def snapshot(
            corpus_hash: str,
            manifest_hash: str,
            assets: list[dict],
        ) -> tuple[dict, list[dict]]:
            return ({
                "corpusBundleHash": corpus_hash,
                "assetManifestSha256": manifest_hash,
                "assetCount": len(assets),
            }, assets)

        asset_a_path = self.root / "asset-a.png"
        asset_b_path = self.root / "asset-b.png"
        asset_b_changed_path = self.root / "asset-b-changed.png"
        asset_a_hash = png(asset_a_path, (30, 60, 90))
        asset_b_hash = png(asset_b_path, (90, 120, 150))
        asset_b_changed_hash = png(asset_b_changed_path, (150, 90, 30))
        asset_a_id = f"asset-{'a' * 64}"
        asset_b_id = f"asset-{'b' * 64}"

        def asset(
            asset_id: str,
            source_hash: str,
            physical: Path,
        ) -> dict:
            return {
                "assetId": asset_id,
                "coursePackId": "layout-design",
                "sha256": source_hash,
                "physical": physical,
                "regions": [dict(POC.FULL_IMAGE)],
            }

        base_assets = [
            asset(asset_a_id, asset_a_hash, asset_a_path),
            asset(asset_b_id, asset_b_hash, asset_b_path),
        ]
        changed_assets = [
            base_assets[0],
            asset(asset_b_id, asset_b_changed_hash, asset_b_changed_path),
        ]
        base_snapshot = snapshot("a" * 64, "b" * 64, base_assets)
        changed_snapshot = snapshot("c" * 64, "d" * 64, changed_assets)
        deleted_snapshot = snapshot("e" * 64, "f" * 64, [base_assets[0]])
        (self.root / "corpus.json").write_text("{}\n", encoding="utf-8")
        (self.root / "assets.json").write_text("{}\n", encoding="utf-8")

        base_args = argparse.Namespace(
            workspace_root=self.root,
            model_dir=self.model_dir,
            model_seal=self.seal_path,
            adapter="siglip2",
            device="cpu",
            offload_dir=self.root / "offload",
            gpu_memory_gib=0.0,
            corpus=self.root / "corpus.json",
            asset_manifest=self.root / "assets.json",
            output_root=self.root / "base-indexes",
            base_index_dir=None,
            incremental_plan_output=None,
            single_vector_i2i_aggregation="MAX_REGION",
        )
        adapter_factory = lambda *_args, **_kwargs: DeterministicBuildAdapter()
        with (
            patch.object(POC, "create_adapter", side_effect=adapter_factory),
            patch.object(
                POC,
                "load_verified_assets",
                return_value=base_snapshot,
            ),
        ):
            base = POC.build_index(base_args)

        no_change_plan = self.root / "no-change-visual-plan.json"
        no_change_args = argparse.Namespace(**{
            **vars(base_args),
            "base_index_dir": Path(base["indexDirectory"]),
            "incremental_plan_output": no_change_plan,
        })
        with (
            patch.object(POC, "create_adapter", side_effect=adapter_factory),
            patch.object(
                POC,
                "load_verified_assets",
                return_value=base_snapshot,
            ),
        ):
            no_change = POC.build_index(no_change_args)
        self.assertEqual(
            no_change["identity"]["indexBundleHash"],
            base["identity"]["indexBundleHash"],
        )
        self.assertEqual(
            no_change["incrementalPlan"]["summary"],
            {"reused": 2, "rebuilt": 0, "deleted": 0},
        )
        self.assertEqual(
            POC.read_json(no_change_plan),
            no_change["incrementalPlan"],
        )

        full_args = argparse.Namespace(**{
            **vars(base_args),
            "output_root": self.root / "full-changed-indexes",
        })
        incremental_args = argparse.Namespace(**{
            **vars(full_args),
            "output_root": self.root / "incremental-changed-indexes",
            "base_index_dir": Path(base["indexDirectory"]),
        })
        with (
            patch.object(POC, "create_adapter", side_effect=adapter_factory),
            patch.object(
                POC,
                "load_verified_assets",
                return_value=changed_snapshot,
            ),
        ):
            full = POC.build_index(full_args)
            incremental = POC.build_index(incremental_args)
        self.assertEqual(
            incremental["incrementalPlan"]["summary"],
            {"reused": 1, "rebuilt": 1, "deleted": 0},
        )
        self.assertEqual(incremental["identity"], full["identity"])
        self.assertEqual(incremental["payload"], full["payload"])
        self.assertEqual(
            POC.read_json(
                Path(incremental["indexDirectory"]) / "manifest.json",
            ),
            POC.read_json(Path(full["indexDirectory"]) / "manifest.json"),
        )
        with patch.object(
            POC,
            "create_adapter",
            side_effect=adapter_factory,
        ):
            full_loaded = POC.LoadedIndex(
                "siglip2",
                self.model_dir,
                self.seal_path,
                Path(full["indexDirectory"]),
                "cpu",
                self.root / "offload",
                0.0,
            )
            incremental_loaded = POC.LoadedIndex(
                "siglip2",
                self.model_dir,
                self.seal_path,
                Path(incremental["indexDirectory"]),
                "cpu",
                self.root / "offload",
                0.0,
            )
        query = {
            "mode": "TEXT_TO_IMAGE",
            "text": "蓝色版式",
            "coursePackId": "layout-design",
        }
        full_hits, _ = full_loaded.search(query, None, 2)
        incremental_hits, _ = incremental_loaded.search(query, None, 2)
        self.assertEqual(incremental_hits, full_hits)

        deleted_args = argparse.Namespace(**{
            **vars(base_args),
            "output_root": self.root / "deleted-indexes",
            "base_index_dir": Path(base["indexDirectory"]),
        })
        with (
            patch.object(POC, "create_adapter", side_effect=adapter_factory),
            patch.object(
                POC,
                "load_verified_assets",
                return_value=deleted_snapshot,
            ),
        ):
            deleted = POC.build_index(deleted_args)
        self.assertEqual(
            deleted["incrementalPlan"]["summary"],
            {"reused": 1, "rebuilt": 0, "deleted": 1},
        )

    def reseal_manifest(self, manifest: dict[str, object]) -> None:
        identity = manifest["identity"]
        identity_base = {
            "corpusBundleHash": identity["corpusBundleHash"],
            "indexVersionId": identity["indexVersionId"],
            "modelId": identity["modelId"],
            "modelRevision": identity["modelRevision"],
        }
        manifest_hash = POC.sha256_bytes(POC.canonical_json({
            **identity_base,
            "assetManifestSha256": manifest["assetManifestSha256"],
            "modelDirectorySha256": manifest["modelDirectorySha256"],
            "modelSealSha256": manifest["modelSealSha256"],
            "config": manifest["config"],
            "entries": manifest["entries"],
            "payload": manifest["payload"],
        }))
        new_index_dir = self.index_dir.parent / manifest_hash
        new_index_dir.mkdir()
        (new_index_dir / "embeddings.safetensors").write_bytes(
            (self.index_dir / "embeddings.safetensors").read_bytes(),
        )
        manifest["identity"] = {
            **identity_base,
            "indexBundleHash": manifest_hash,
        }
        self.index_dir = new_index_dir
        self.manifest_path = new_index_dir / "manifest.json"
        POC.write_json(self.manifest_path, manifest)

    def reseal_i2i_profile(self, profile: str) -> None:
        manifest = POC.read_json(self.manifest_path)
        manifest["config"] = POC.configure_single_vector_aggregation(
            manifest["config"],
            "SINGLE_VECTOR",
            profile,
        )
        manifest["config"]["singleVectorAggregationByMode"] = {
            "TEXT_TO_IMAGE": "MAX_REGION",
            "IMAGE_TO_IMAGE": profile,
            "IMAGE_TEXT_TO_IMAGE": "MAX_REGION",
        }
        manifest["config"]["singleVectorRegionAttributionByMode"] = {
            "IMAGE_TO_IMAGE": "MAX_QUERY_SIMILARITY_FIRST_REGION_TIE",
        }
        manifest["identity"]["indexVersionId"] = (
            POC.index_version_for_aggregation("siglip2", profile)
        )
        self.reseal_manifest(manifest)

    def test_reseals_manifest_and_validates_tensor_layout(self) -> None:
        loaded, _ = self.load()
        self.assertEqual(len(loaded.entries), 1)
        manifest = POC.read_json(self.manifest_path)
        manifest["entries"][0]["coursePackId"] = "book-design"
        POC.write_json(self.manifest_path, manifest)
        with self.assertRaisesRegex(ValueError, "BUNDLE_HASH_MISMATCH"):
            self.load()

    def test_image_query_decodes_and_reencodes_supplied_pixels(self) -> None:
        loaded, adapter = self.load()
        embedding, _ = loaded.encode_query_image(
            self.asset_id,
            {
                "assetId": self.asset_id,
                "sha256": self.image_hash,
                "pngBase64": __import__("base64").b64encode(
                    self.png_bytes,
                ).decode("ascii"),
            },
        )
        self.assertEqual(tuple(embedding.shape), (768,))
        self.assertEqual(adapter.encoded_sizes, [(64, 48)])
        with self.assertRaisesRegex(ValueError, "QUERY_IMAGE_BYTES_INVALID"):
            loaded.encode_query_image(
                self.asset_id,
                {
                    "assetId": self.asset_id,
                    "sha256": "f" * 64,
                    "pngBase64": "AAAA",
                },
            )

    def test_legacy_and_v2_manifest_profiles_have_distinct_identities(self) -> None:
        legacy, _ = self.load()
        self.assertEqual(
            legacy.single_vector_aggregation_by_mode,
            {
                "TEXT_TO_IMAGE": "MAX_REGION",
                "IMAGE_TO_IMAGE": "MAX_REGION",
                "IMAGE_TEXT_TO_IMAGE": "MAX_REGION",
            },
        )
        legacy_hash = legacy.manifest["identity"]["indexBundleHash"]
        self.reseal_i2i_profile("L2_NORMALIZED_MEAN_REGION")
        upgraded, _ = self.load()
        self.assertEqual(
            upgraded.single_vector_aggregation_by_mode["IMAGE_TO_IMAGE"],
            "L2_NORMALIZED_MEAN_REGION",
        )
        self.assertEqual(
            upgraded.manifest["identity"]["indexVersionId"],
            "siglip2-224-two-region-i2i-l2-mean-v2",
        )
        self.assertNotEqual(
            upgraded.manifest["identity"]["indexBundleHash"],
            legacy_hash,
        )

    def test_manifest_profile_and_index_version_must_agree_both_ways(self) -> None:
        legacy_with_v2_identity = POC.read_json(self.manifest_path)
        legacy_with_v2_identity["identity"]["indexVersionId"] = (
            "siglip2-224-two-region-i2i-l2-mean-v2"
        )
        self.reseal_manifest(legacy_with_v2_identity)
        with self.assertRaisesRegex(ValueError, "MODEL_IDENTITY_MISMATCH"):
            self.load()

        mean_with_v1_identity = POC.read_json(self.manifest_path)
        mean_with_v1_identity["config"] = (
            POC.configure_single_vector_aggregation(
                mean_with_v1_identity["config"],
                "SINGLE_VECTOR",
                "L2_NORMALIZED_MEAN_REGION",
            )
        )
        mean_with_v1_identity["identity"]["indexVersionId"] = (
            "siglip2-224-two-region-v1"
        )
        self.reseal_manifest(mean_with_v1_identity)
        with self.assertRaisesRegex(ValueError, "MODEL_IDENTITY_MISMATCH"):
            self.load()

    def test_l2_normalized_mean_is_deterministic_and_rejects_zero_norm(self) -> None:
        single = torch.tensor([0.6, 0.8], dtype=torch.float32)
        first = POC.l2_normalized_mean_region([single], torch)
        second = POC.l2_normalized_mean_region([single], torch)
        self.assertTrue(torch.allclose(first, single, atol=1e-7, rtol=0))
        self.assertTrue(torch.equal(first, second))
        with self.assertRaisesRegex(ValueError, "ZERO_NORM"):
            POC.l2_normalized_mean_region([
                torch.tensor([1.0, 0.0]),
                torch.tensor([-1.0, 0.0]),
            ], torch)

    def test_legacy_config_is_unchanged_and_v2_requires_attribution(self) -> None:
        legacy = {
            "tensorDtype": "float32",
            "singleVectorAggregation": "MAX_REGION",
        }
        configured_legacy = POC.configure_single_vector_aggregation(
            dict(legacy),
            "SINGLE_VECTOR",
            "MAX_REGION",
        )
        self.assertEqual(configured_legacy, legacy)
        self.assertEqual(
            POC.canonical_json(configured_legacy),
            POC.canonical_json(legacy),
        )
        configured_v2 = POC.configure_single_vector_aggregation(
            dict(legacy),
            "SINGLE_VECTOR",
            "L2_NORMALIZED_MEAN_REGION",
        )
        self.assertNotIn("singleVectorAggregation", configured_v2)
        self.assertEqual(
            configured_v2["singleVectorAggregationByMode"]["IMAGE_TO_IMAGE"],
            "L2_NORMALIZED_MEAN_REGION",
        )
        self.assertNotEqual(
            POC.canonical_json(configured_v2),
            POC.canonical_json(legacy),
        )
        missing_attribution = dict(configured_v2)
        missing_attribution.pop("singleVectorRegionAttributionByMode")
        with self.assertRaisesRegex(ValueError, "CONFIG_INVALID"):
            POC.single_vector_aggregation_by_mode(
                missing_attribution,
                "SINGLE_VECTOR",
            )
        self.assertEqual(
            POC.index_version_for_aggregation("siglip2", "MAX_REGION"),
            "siglip2-224-two-region-v1",
        )
        self.assertEqual(
            POC.index_version_for_aggregation(
                "siglip2",
                "L2_NORMALIZED_MEAN_REGION",
            ),
            "siglip2-224-two-region-i2i-l2-mean-v2",
        )

    def test_i2i_mean_profile_is_mode_separated_and_region_is_attribution(self) -> None:
        loaded = POC.LoadedIndex.__new__(POC.LoadedIndex)
        loaded.manifest = {
            "adapter": {
                "kind": "SINGLE_VECTOR",
            },
        }
        loaded.single_vector_aggregation_by_mode = {
            "TEXT_TO_IMAGE": "MAX_REGION",
            "IMAGE_TO_IMAGE": "L2_NORMALIZED_MEAN_REGION",
            "IMAGE_TEXT_TO_IMAGE": "MAX_REGION",
        }
        loaded.adapter = FakeAdapter()
        loaded.tensors = {
            "embeddings": torch.tensor([
                [1.0, 0.0],
                [-0.8, 0.6],
                [0.8, 0.6],
                [0.8, 0.6],
            ], dtype=torch.float32),
        }

        def region(offset: int, x: float) -> dict[str, object]:
            return {
                "name": "FULL_IMAGE",
                "bbox": {
                    "coordinateSpace": "NORMALIZED",
                    "x": x,
                    "y": 0.0,
                    "width": 0.4,
                    "height": 1.0,
                },
                "tensorKey": "embeddings",
                "vectorOffset": offset,
                "vectorCount": 1,
            }

        loaded.entries = [
            {
                "assetId": "asset-a",
                "coursePackId": "layout-design",
                "representationId": "representation-a",
                "regions": [region(0, 0.0), region(1, 0.5)],
            },
            {
                "assetId": "asset-b",
                "coursePackId": "layout-design",
                "representationId": "representation-b",
                "regions": [region(2, 0.0), region(3, 0.5)],
            },
        ]
        loaded.single_vector_i2i_aggregates = {
            entry["assetId"]: POC.l2_normalized_mean_region(
                [
                    loaded.region_tensor(region_record)
                    for region_record in entry["regions"]
                ],
                torch,
            )
            for entry in loaded.entries
        }
        loaded.encode_query_image = lambda _asset_id, _query_image: (
            torch.tensor([1.0, 0.0], dtype=torch.float32),
            0.0,
        )
        text_hits, _ = loaded.search({
            "mode": "TEXT_TO_IMAGE",
            "text": "test",
            "excludeAssetIds": [],
            "coursePackId": "layout-design",
        }, None, 2)
        image_hits, _ = loaded.search({
            "mode": "IMAGE_TO_IMAGE",
            "queryAssetId": "asset-query",
            "excludeAssetIds": [],
            "coursePackId": "layout-design",
        }, {}, 2)

        self.assertEqual(
            [hit["assetId"] for hit in text_hits],
            ["asset-a", "asset-b"],
        )
        self.assertEqual(
            [hit["assetId"] for hit in image_hits],
            ["asset-b", "asset-a"],
        )
        self.assertEqual(
            image_hits[1]["region"]["x"],
            0.0,
            "returned region is the strongest individual attribution",
        )

    def test_build_parser_defaults_to_max_and_accepts_new_profile(self) -> None:
        required = [
            "build",
            "--adapter", "siglip2",
            "--model-dir", "model",
            "--model-seal", "seal.json",
            "--device", "cpu",
            "--offload-dir", "offload",
            "--workspace-root", ".",
            "--corpus", "corpus.json",
            "--asset-manifest", "assets.json",
            "--output-root", "indexes",
        ]
        default_args = POC.parser().parse_args(required)
        self.assertEqual(
            default_args.single_vector_i2i_aggregation,
            "MAX_REGION",
        )
        upgraded_args = POC.parser().parse_args([
            *required,
            "--single-vector-i2i-aggregation",
            "L2_NORMALIZED_MEAN_REGION",
        ])
        self.assertEqual(
            upgraded_args.single_vector_i2i_aggregation,
            "L2_NORMALIZED_MEAN_REGION",
        )


if __name__ == "__main__":
    unittest.main()

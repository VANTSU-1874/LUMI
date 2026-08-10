from __future__ import annotations

import argparse
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("text_retrieval.py")
SPEC = importlib.util.spec_from_file_location("lumi_text_retrieval", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
TEXT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TEXT)


def hashed_bundle() -> dict:
    node_hashes = {
        name: TEXT.sha256_bytes(name.encode("utf-8"))
        for name in ("document", "section", "text", "image")
    }
    annotation_hash = TEXT.sha256_bytes(b"caption")
    bundle = {
        "schemaVersion": 2,
        "corpusVersion": "fixture",
        "parser": {"id": "fixture", "version": "1.0.0"},
        "contentVersion": "fixture",
        "objects": [{
            "schemaVersion": 2,
            "id": "layout-fixture",
            "title": "海报层级练习",
            "sourceCoursePack": {"id": "layout-design", "version": "1"},
            "nodes": [
                {
                    "id": "node-document",
                    "kind": "DOCUMENT",
                    "title": "海报层级练习",
                    "parentId": None,
                    "childrenIds": ["node-section"],
                    "relatedIds": [],
                    "location": None,
                    "contentHash": node_hashes["document"],
                },
                {
                    "id": "node-section",
                    "kind": "SECTION",
                    "title": "标题与正文",
                    "level": 2,
                    "parentId": "node-document",
                    "childrenIds": ["node-text", "node-image"],
                    "relatedIds": [],
                    "location": None,
                    "contentHash": node_hashes["section"],
                },
                {
                    "id": "node-text",
                    "kind": "TEXT",
                    "text": "先拉开字号与字重，再检查阅读顺序。",
                    "role": "ACTION",
                    "legacyStatementId": None,
                    "parentId": "node-section",
                    "childrenIds": [],
                    "relatedIds": [],
                    "location": None,
                    "contentHash": node_hashes["text"],
                },
                {
                    "id": "node-image",
                    "kind": "IMAGE",
                    "assetId": "asset-fixture",
                    "parentId": "node-section",
                    "childrenIds": [],
                    "relatedIds": [],
                    "location": None,
                    "contentHash": node_hashes["image"],
                },
            ],
            "annotations": [{
                "id": "annotation-caption",
                "targetNodeId": "node-image",
                "kind": "CAPTION",
                "origin": "SOURCE",
                "payload": {
                    "kind": "CAPTION",
                    "text": "标题位于左上，正文沿竖向网格排列。",
                },
                "annotationHash": annotation_hash,
            }],
        }],
        "assets": [],
        "unreferencedAssetIds": [],
    }
    bundle["bundleHash"] = TEXT.sha256_stable(bundle)
    return bundle


def reseal_bundle(bundle: dict) -> dict:
    updated = json.loads(json.dumps(bundle))
    updated.pop("bundleHash", None)
    updated["bundleHash"] = TEXT.sha256_stable(updated)
    return updated


def search_entry(
    representation_id: str,
    node_id: str,
    object_id: str,
    course_pack_id: str = "layout-design",
    *,
    source_kind: str = "NODE",
    node_kind: str = "TEXT",
    role: str | None = "ACTION",
) -> dict:
    return {
        "representationId": representation_id,
        "nodeId": node_id,
        "objectId": object_id,
        "coursePackId": course_pack_id,
        "sourceKind": source_kind,
        "nodeKind": node_kind,
        "role": role,
        "contentHash": TEXT.sha256_bytes(representation_id.encode("utf-8")),
    }


class FakeScalar:
    def __init__(self, value: float) -> None:
        self.value = value

    def item(self) -> float:
        return self.value


class FakeQuery:
    def to(self, _device: str) -> FakeQuery:
        return self


class FakeEncoder:
    def encode(self, texts: list[str], query: bool) -> list[FakeQuery]:
        if texts != ["fixture"] or query is not True:
            raise AssertionError("unexpected encoder invocation")
        return [FakeQuery()]


class FakeEmbeddings:
    device = "cpu"

    def __init__(self, scores: list[float]) -> None:
        self.scores = scores
        self.matmul_count = 0

    def __matmul__(self, _query: FakeQuery) -> list[FakeScalar]:
        self.matmul_count += 1
        return [FakeScalar(score) for score in self.scores]


def loaded_index_fixture(
    entries: list[dict],
    scores: list[float],
) -> object:
    loaded = TEXT.LoadedIndex.__new__(TEXT.LoadedIndex)
    loaded.encoder = FakeEncoder()
    loaded.entries = entries
    loaded.embeddings = FakeEmbeddings(scores)
    return loaded


class TextRetrievalUnitTests(unittest.TestCase):
    def test_fixed_model_contract_is_immutable_and_self_hosted(self) -> None:
        self.assertEqual(TEXT.MODEL_ID, "BAAI/bge-small-zh-v1.5")
        self.assertEqual(
            TEXT.MODEL_REVISION,
            "7999e1d3359715c523056ef9478215996d62a620",
        )
        self.assertEqual(TEXT.MODEL_LICENSE, "MIT")
        self.assertEqual(TEXT.POOLING, "CLS")
        self.assertTrue(TEXT.NORMALIZE)
        self.assertTrue(TEXT.QUERY_INSTRUCTION.endswith("："))

    def test_extracts_hierarchical_nodes_and_source_caption_deterministically(self) -> None:
        bundle = hashed_bundle()
        first = TEXT.extract_records(bundle)
        second = TEXT.extract_records(json.loads(json.dumps(bundle)))
        self.assertEqual(first, second)
        self.assertEqual(len(first), 4)
        text_record = next(record for record in first if record["nodeId"] == "node-text")
        self.assertEqual(text_record["coursePackId"], "layout-design")
        self.assertEqual(text_record["sourceKind"], "NODE")
        self.assertEqual(text_record["role"], "ACTION")
        self.assertIn("海报层级练习", text_record["text"])
        self.assertIn("标题与正文", text_record["text"])
        caption = next(record for record in first if record["sourceKind"] == "SOURCE_CAPTION")
        self.assertEqual(caption["nodeId"], "node-image")
        self.assertEqual(caption["nodeKind"], "IMAGE")
        self.assertEqual(caption["role"], "CAPTION")

    def test_rejects_corpus_hash_drift(self) -> None:
        bundle = hashed_bundle()
        bundle["objects"][0]["title"] = "被篡改"
        with self.assertRaisesRegex(ValueError, "TEXT_CORPUS_HASH_DRIFT"):
            TEXT.extract_records(bundle)

    def test_model_snapshot_seal_detects_byte_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model_dir = root / "model"
            model_dir.mkdir()
            config = model_dir / "config.json"
            config.write_text('{"hidden_size":512}\n', encoding="utf-8")
            seal_path = root / "seal.json"
            TEXT.write_json(seal_path, TEXT.model_snapshot_seal(model_dir))
            directory_hash, seal_hash = TEXT.verify_model_snapshot(model_dir, seal_path)
            self.assertEqual(len(directory_hash), 64)
            self.assertEqual(len(seal_hash), 64)
            config.write_text('{"hidden_size":768}\n', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "TEXT_MODEL_SNAPSHOT_DRIFT"):
                TEXT.verify_model_snapshot(model_dir, seal_path)

    def test_index_manifest_is_content_addressed_and_payload_sealed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            index_dir = Path(temporary)
            payload = index_dir / TEXT.PAYLOAD_NAME
            payload.write_bytes(b"fixture-safetensors")
            records = TEXT.extract_records(hashed_bundle())
            base = TEXT.base_index_manifest(
                hashed_bundle()["bundleHash"],
                "a" * 64,
                "b" * 64,
                payload,
                records,
            )
            manifest = TEXT.seal_index_manifest(base)
            TEXT.write_json(index_dir / TEXT.MANIFEST_NAME, manifest)
            verified = TEXT.verify_index_manifest(index_dir)
            self.assertEqual(verified, manifest)
            payload.write_bytes(b"drift")
            with self.assertRaisesRegex(ValueError, "TEXT_INDEX_PAYLOAD_DRIFT"):
                TEXT.verify_index_manifest(index_dir)

    def test_legacy_index_is_verified_but_not_incrementally_compatible(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            index_dir = Path(temporary)
            payload = index_dir / TEXT.PAYLOAD_NAME
            payload.write_bytes(b"fixture-safetensors")
            records = TEXT.extract_records(hashed_bundle())
            base = TEXT.base_index_manifest(
                hashed_bundle()["bundleHash"],
                "a" * 64,
                "b" * 64,
                payload,
                records,
            )
            base["model"].pop("indexEncodingPolicy")
            legacy_hash = TEXT.sha256_stable(TEXT.LEGACY_INDEX_CONFIG)
            base["configHash"] = legacy_hash
            base["identity"]["indexVersionId"] = (
                f"bge-small-zh-v1-5-{legacy_hash[:12]}"
            )
            base["builder"]["version"] = "1.0.0"
            manifest = TEXT.seal_index_manifest(base)
            TEXT.write_json(index_dir / TEXT.MANIFEST_NAME, manifest)

            verified = TEXT.verify_index_manifest(index_dir)

            self.assertEqual(verified, manifest)
            self.assertNotEqual(
                TEXT.sha256_stable(
                    TEXT.manifest_incremental_compatibility_payload(verified),
                ),
                TEXT.sha256_stable(TEXT.incremental_compatibility_payload(
                    "a" * 64,
                    "b" * 64,
                )),
            )

    def test_incremental_build_is_content_equivalent_to_full_build(self) -> None:
        import torch

        class DeterministicEncoder:
            calls: list[list[str]] = []

            def __init__(self, _model_dir: Path, _device: str) -> None:
                pass

            def encode(self, texts: list[str], query: bool) -> torch.Tensor:
                if len(texts) != 1:
                    raise AssertionError("index encoding must be single-record")
                self.calls.append(texts)
                encoded_text = (
                    f"{TEXT.QUERY_INSTRUCTION}{texts[0]}"
                    if query
                    else texts[0]
                )
                digest = bytes.fromhex(
                    TEXT.sha256_bytes(encoded_text.encode("utf-8")),
                )
                vector = torch.zeros(TEXT.MODEL_DIMENSIONS, dtype=torch.float32)
                for offset, value in enumerate(digest):
                    vector[offset] = value / 255
                return torch.nn.functional.normalize(
                    vector,
                    p=2,
                    dim=0,
                ).unsqueeze(0)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model_dir = root / "model"
            model_dir.mkdir()
            (model_dir / "config.json").write_text(
                '{"hidden_size":512}\n',
                encoding="utf-8",
            )
            seal_path = root / "model-seal.json"
            TEXT.write_json(seal_path, TEXT.model_snapshot_seal(model_dir))
            base_corpus = hashed_bundle()
            base_corpus_path = root / "base-corpus.json"
            TEXT.write_json(base_corpus_path, base_corpus)
            base_args = argparse.Namespace(
                corpus=base_corpus_path,
                model_dir=model_dir,
                model_seal=seal_path,
                output_root=root / "base-indexes",
                base_index_dir=None,
                incremental_plan_output=None,
                device="cpu",
                batch_size=1,
            )
            with patch.object(TEXT, "BgeEncoder", DeterministicEncoder):
                base = TEXT.build_index(base_args)

            no_change_plan = root / "no-change-plan.json"
            no_change_args = argparse.Namespace(
                **{
                    **vars(base_args),
                    "base_index_dir": Path(base["indexDirectory"]),
                    "incremental_plan_output": no_change_plan,
                },
            )
            with patch.object(TEXT, "BgeEncoder", DeterministicEncoder):
                no_change = TEXT.build_index(no_change_args)
            self.assertEqual(
                no_change["identity"]["indexBundleHash"],
                base["identity"]["indexBundleHash"],
            )
            self.assertEqual(
                no_change["incrementalPlan"]["summary"],
                {"reused": 4, "rebuilt": 0, "deleted": 0},
            )
            self.assertEqual(
                TEXT.read_json(no_change_plan),
                no_change["incrementalPlan"],
            )

            changed_corpus = json.loads(json.dumps(base_corpus))
            changed_text = changed_corpus["objects"][0]["nodes"][2]
            changed_text["text"] = "先确定主次，再通过留白检查阅读顺序。"
            changed_text["contentHash"] = TEXT.sha256_bytes(
                changed_text["text"].encode("utf-8"),
            )
            changed_corpus = reseal_bundle(changed_corpus)
            changed_path = root / "changed-corpus.json"
            TEXT.write_json(changed_path, changed_corpus)
            full_args = argparse.Namespace(
                **{
                    **vars(base_args),
                    "corpus": changed_path,
                    "output_root": root / "full-indexes",
                },
            )
            incremental_args = argparse.Namespace(
                **{
                    **vars(full_args),
                    "output_root": root / "incremental-indexes",
                    "base_index_dir": Path(base["indexDirectory"]),
                },
            )
            with patch.object(TEXT, "BgeEncoder", DeterministicEncoder):
                full = TEXT.build_index(full_args)
                incremental = TEXT.build_index(incremental_args)
            self.assertEqual(
                incremental["incrementalPlan"]["summary"],
                {"reused": 3, "rebuilt": 1, "deleted": 1},
            )
            self.assertEqual(incremental["identity"], full["identity"])
            self.assertEqual(
                incremental["payloadSha256"],
                full["payloadSha256"],
            )
            self.assertEqual(
                TEXT.read_json(
                    Path(incremental["indexDirectory"]) / TEXT.MANIFEST_NAME,
                ),
                TEXT.read_json(
                    Path(full["indexDirectory"]) / TEXT.MANIFEST_NAME,
                ),
            )
            from safetensors.torch import load_file

            def loaded(result: dict) -> object:
                value = TEXT.LoadedIndex.__new__(TEXT.LoadedIndex)
                value.manifest = TEXT.verify_index_manifest(
                    Path(result["indexDirectory"]),
                )
                value.entries = value.manifest["entries"]
                value.embeddings = load_file(
                    str(
                        Path(result["indexDirectory"])
                        / TEXT.PAYLOAD_NAME
                    ),
                    device="cpu",
                )["embeddings"]
                value.encoder = DeterministicEncoder(model_dir, "cpu")
                return value

            full_hits, _, _ = loaded(full).search(
                "怎么检查阅读顺序",
                "layout-design",
                4,
            )
            incremental_hits, _, _ = loaded(incremental).search(
                "怎么检查阅读顺序",
                "layout-design",
                4,
            )
            self.assertEqual(incremental_hits, full_hits)

            deleted_corpus = json.loads(json.dumps(base_corpus))
            deleted_corpus["objects"][0]["annotations"] = []
            deleted_corpus = reseal_bundle(deleted_corpus)
            deleted_path = root / "deleted-corpus.json"
            TEXT.write_json(deleted_path, deleted_corpus)
            deleted_args = argparse.Namespace(
                **{
                    **vars(base_args),
                    "corpus": deleted_path,
                    "output_root": root / "deleted-indexes",
                    "base_index_dir": Path(base["indexDirectory"]),
                },
            )
            with patch.object(TEXT, "BgeEncoder", DeterministicEncoder):
                deleted = TEXT.build_index(deleted_args)
            self.assertEqual(
                deleted["incrementalPlan"]["summary"],
                {"reused": 3, "rebuilt": 0, "deleted": 1},
            )

    def test_object_candidates_are_scoped_native_text_nodes_with_stable_ties(
        self,
    ) -> None:
        scored_entries = [
            (
                0.99,
                search_entry(
                    "caption",
                    "image",
                    "object-b",
                    source_kind="SOURCE_CAPTION",
                    node_kind="IMAGE",
                    role="CAPTION",
                ),
            ),
            (
                0.98,
                search_entry(
                    "document",
                    "document",
                    "object-b",
                    node_kind="DOCUMENT",
                    role=None,
                ),
            ),
            (0.90, search_entry("b-z", "node-z", "object-b")),
            (0.90, search_entry("b-a", "node-a", "object-b")),
            (0.90, search_entry("a-a", "node-c", "object-a")),
            (
                1.00,
                search_entry(
                    "foreign",
                    "node-foreign",
                    "object-foreign",
                    "brand-vi-design",
                ),
            ),
        ]

        candidates = TEXT.rank_object_candidates(
            scored_entries,
            "layout-design",
        )

        self.assertEqual(
            [candidate["objectId"] for candidate in candidates],
            ["object-a", "object-b"],
        )
        self.assertEqual(
            [candidate["objectRank"] for candidate in candidates],
            [1, 2],
        )
        self.assertEqual(candidates[0]["objectScore"], 0.90)
        self.assertEqual(
            [node["nodeId"] for node in candidates[1]["nodes"]],
            ["node-a", "node-z"],
        )
        self.assertEqual(
            [node["innerRank"] for node in candidates[1]["nodes"]],
            [1, 2],
        )
        self.assertEqual(
            set(candidates[1]),
            {
                "objectId",
                "coursePackId",
                "objectRank",
                "objectScore",
                "nodes",
            },
        )
        self.assertEqual(
            set(candidates[1]["nodes"][0]),
            {
                "representationId",
                "nodeId",
                "innerRank",
                "score",
                "sourceKind",
                "nodeKind",
                "role",
                "contentHash",
            },
        )

    def test_object_candidates_enforce_object_and_node_caps(self) -> None:
        scored_entries = []
        for object_number in range(12):
            for node_number in range(4):
                scored_entries.append((
                    100.0 - object_number - node_number / 10,
                    search_entry(
                        f"rep-{object_number:02}-{node_number}",
                        f"node-{object_number:02}-{node_number}",
                        f"object-{object_number:02}",
                    ),
                ))

        candidates = TEXT.rank_object_candidates(
            scored_entries,
            "layout-design",
        )

        self.assertEqual(len(candidates), TEXT.MAX_OBJECT_CANDIDATES)
        self.assertEqual(
            [candidate["objectRank"] for candidate in candidates],
            list(range(1, 11)),
        )
        self.assertEqual(candidates[-1]["objectId"], "object-09")
        self.assertNotIn(
            "object-10",
            [candidate["objectId"] for candidate in candidates],
        )
        for candidate in candidates:
            self.assertEqual(
                len(candidate["nodes"]),
                TEXT.MAX_OBJECT_CANDIDATE_NODES,
            )
            self.assertEqual(
                [node["innerRank"] for node in candidate["nodes"]],
                [1, 2, 3],
            )

    def test_detailed_search_reuses_scores_without_changing_hits_or_diagnostics(
        self,
    ) -> None:
        entries = [
            search_entry("layout-text", "layout-node", "layout-object"),
            search_entry(
                "layout-caption",
                "layout-image",
                "layout-object",
                source_kind="SOURCE_CAPTION",
                node_kind="IMAGE",
                role="CAPTION",
            ),
            search_entry(
                "brand-text",
                "brand-node",
                "brand-object",
                "brand-vi-design",
            ),
        ]
        scores = [0.90, 0.95, 1.00]
        loaded = loaded_index_fixture(entries, scores)
        expected_diagnostics = TEXT.pack_competition_diagnostics(
            list(zip(scores, entries)),
            "layout-design",
        )

        (
            hits,
            object_candidates,
            diagnostics,
            _,
        ) = loaded.search_with_object_candidates(
            "fixture",
            "layout-design",
            10,
        )

        self.assertEqual(loaded.embeddings.matmul_count, 1)
        self.assertEqual(
            [hit["representationId"] for hit in hits],
            ["layout-caption", "layout-text"],
        )
        self.assertEqual(diagnostics, expected_diagnostics)
        self.assertEqual(
            [candidate["objectId"] for candidate in object_candidates],
            ["layout-object"],
        )
        self.assertEqual(
            [node["representationId"] for node in object_candidates[0]["nodes"]],
            ["layout-text"],
        )

    def test_provider_error_response_has_empty_object_candidates(self) -> None:
        response = TEXT.provider_error_response(None, "INVALID_REQUEST")

        self.assertEqual(response["status"], "ERROR")
        self.assertEqual(response["hits"], [])
        self.assertEqual(response["objectCandidates"], [])
        self.assertIsNone(response["diagnostics"])
        self.assertEqual(response["error"], {
            "code": "INVALID_REQUEST",
            "retryable": False,
        })


if __name__ == "__main__":
    unittest.main()

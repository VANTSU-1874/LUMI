from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("t44_reranker.py")
SPEC = importlib.util.spec_from_file_location(
    "lumi_t44_reranker",
    MODULE_PATH,
)
assert SPEC is not None and SPEC.loader is not None
RERANKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RERANKER)


def write_model_fixture(root: Path) -> Path:
    model_dir = root / RERANKER.MODEL_REVISION
    model_dir.mkdir()
    files = {
        "README.md": "---\nlicense: mit\n---\nfixture\n",
        "config.json": json.dumps({
            "architectures": [
                "XLMRobertaForSequenceClassification",
            ],
            "hidden_size": 768,
            "max_position_embeddings": 514,
            "model_type": "xlm-roberta",
            "num_hidden_layers": 12,
        }),
        "model.safetensors": "fixture",
        "sentencepiece.bpe.model": "fixture",
        "special_tokens_map.json": "{}",
        "tokenizer.json": "{}",
        "tokenizer_config.json": "{}",
    }
    for name, content in files.items():
        (model_dir / name).write_text(content, encoding="utf-8")
    return model_dir


def runtime_input() -> dict:
    cases = []
    for index in range(50):
        object_ids = [
            f"object-{index:02d}-{rank}"
            for rank in range(1, 6)
        ]
        node_id = f"node-{index:064x}"
        cases.append({
            "caseId": f"case-{index:02d}",
            "question": f"学生问题 {index}",
            "coursePackId": "layout-design",
            "coursePackVersion": "1",
            "objectRanking": [
                {"objectId": object_id, "rank": rank}
                for rank, object_id in enumerate(
                    object_ids,
                    start=1,
                )
            ],
            "candidates": [{
                "nodeId": node_id,
                "objectId": object_ids[0],
                "coursePackId": "layout-design",
                "contentHash": f"{index + 100:064x}",
                "text": f"候选证据 {index}",
                "tensorOffset": index,
            }],
        })
    return {
        "schemaVersion": 1,
        "kind": "T44_RERANKER_SHADOW_INPUT",
        "config": {
            "topM": 5,
            "topK": 8,
            "maxPerObject": 3,
            "repetitions": 3,
            "batchSize": 32,
            "maxLength": 512,
        },
        "runtimeSuite": {
            "id": "lumi-t44-support-dev-runtime",
            "version": "2026-07-28.1",
            "suiteHash": "a" * 64,
        },
        "corpusBundleHash": "b" * 64,
        "cases": cases,
    }


class T44RerankerUnitTests(unittest.TestCase):
    def test_fixed_candidate_contract(self) -> None:
        self.assertEqual(
            RERANKER.MODEL_ID,
            "BAAI/bge-reranker-base",
        )
        self.assertEqual(
            RERANKER.MODEL_REVISION,
            "2cfc18c9415c912f9d8155881c133215df768a70",
        )
        self.assertEqual(RERANKER.MODEL_LICENSE, "MIT")
        self.assertEqual(RERANKER.TOP_M, 5)
        self.assertEqual(RERANKER.TOP_K, 8)
        self.assertEqual(RERANKER.MAX_PER_OBJECT, 3)
        self.assertEqual(RERANKER.REPETITIONS, 3)

    def test_model_snapshot_seal_detects_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model_dir = write_model_fixture(root)
            seal_path = root / "seal.json"
            RERANKER.write_json(
                seal_path,
                RERANKER.model_snapshot_seal(model_dir),
            )
            directory_hash, seal_hash = (
                RERANKER.verify_model_snapshot(
                    model_dir,
                    seal_path,
                )
            )
            self.assertEqual(len(directory_hash), 64)
            self.assertEqual(len(seal_hash), 64)
            (model_dir / "README.md").write_text(
                "---\nlicense: mit\n---\ndrift\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                ValueError,
                "MODEL_SNAPSHOT_DRIFT",
            ):
                RERANKER.verify_model_snapshot(
                    model_dir,
                    seal_path,
                )

    def test_snapshot_rejects_unapproved_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model_dir = write_model_fixture(Path(temporary))
            (model_dir / "pytorch_model.bin").write_bytes(b"duplicate")
            with self.assertRaisesRegex(
                ValueError,
                "MODEL_FILE_SET_INVALID",
            ):
                RERANKER.model_snapshot_seal(model_dir)

    def test_runtime_input_is_strict_and_qrel_blind(self) -> None:
        value = runtime_input()
        validated = RERANKER.validate_shadow_input(value)
        self.assertEqual(len(validated["cases"]), 50)
        value["cases"][0]["requiredEvidenceGroups"] = []
        with self.assertRaisesRegex(
            ValueError,
            "CASE_KEYS_INVALID",
        ):
            RERANKER.validate_shadow_input(value)

    def test_runtime_input_rejects_candidate_outside_top_m(self) -> None:
        value = runtime_input()
        value["cases"][0]["candidates"][0]["objectId"] = (
            "object-not-ranked"
        )
        with self.assertRaisesRegex(
            ValueError,
            "CANDIDATE_OUTSIDE_TOP_M",
        ):
            RERANKER.validate_shadow_input(value)

    def test_runtime_input_accepts_fewer_than_five_real_objects(self) -> None:
        value = runtime_input()
        value["cases"][0]["objectRanking"] = (
            value["cases"][0]["objectRanking"][:2]
        )
        validated = RERANKER.validate_shadow_input(value)
        self.assertEqual(
            len(validated["cases"][0]["objectRanking"]),
            2,
        )

    def test_runtime_input_preserves_zero_object_as_empty(self) -> None:
        value = runtime_input()
        value["cases"][0]["objectRanking"] = []
        value["cases"][0]["candidates"] = []
        validated = RERANKER.validate_shadow_input(value)
        self.assertEqual(
            validated["cases"][0]["objectRanking"],
            [],
        )
        self.assertEqual(
            validated["cases"][0]["candidates"],
            [],
        )

    def test_ranking_uses_node_id_for_stable_ties(self) -> None:
        candidates = [
            {
                "nodeId": f"node-{'b' * 64}",
                "objectId": "object-b",
                "coursePackId": "layout-design",
            },
            {
                "nodeId": f"node-{'a' * 64}",
                "objectId": "object-a",
                "coursePackId": "layout-design",
            },
        ]
        ranking = RERANKER.rank_scores(
            candidates,
            [0.5, 0.5],
        )
        self.assertEqual(
            [row["nodeId"] for row in ranking],
            [f"node-{'a' * 64}", f"node-{'b' * 64}"],
        )


if __name__ == "__main__":
    unittest.main()

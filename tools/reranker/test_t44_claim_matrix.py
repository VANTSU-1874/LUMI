from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("t44_claim_matrix.py")
SPEC = importlib.util.spec_from_file_location(
    "lumi_t44_claim_matrix",
    MODULE_PATH,
)
assert SPEC is not None and SPEC.loader is not None
MATRIX = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MATRIX)


def decomposition(question: str) -> dict:
    claim_id = "claim-1"
    claim_text = question
    return {
        "schemaVersion": 1,
        "kind": "QUERY_CLAIM_DECOMPOSITION",
        "decomposerId": "lumi-query-claim-decomposer-v1",
        "decomposerVersion": "2026-07-29.1",
        "configHash": "a" * 64,
        "wholeQuery": question,
        "wholeQueryHash": MATRIX.sha256_stable(question),
        "claims": [{
            "claimId": claim_id,
            "text": claim_text,
            "textHash": MATRIX.sha256_stable(claim_text),
            "sourceRule": "WHOLE_FALLBACK",
            "sourceSpan": {
                "startCodePoint": 0,
                "endCodePoint": len(claim_text),
            },
        }],
        "probes": [{
            "probeId": "probe-whole",
            "kind": "WHOLE_QUERY",
            "text": question,
            "textHash": MATRIX.sha256_stable(question),
            "claimIds": [claim_id],
        }],
    }


def runtime_input() -> dict:
    cases = []
    for index in range(50):
        case_id = f"case-{index:02d}"
        object_id = f"object-{index:02d}"
        node_id = f"node-{index:064x}"
        question = f"这个方案第 {index} 处怎么调整?"
        candidate_nodes = [{
            "nodeId": node_id,
            "objectId": object_id,
            "coursePackId": "layout-design",
            "objectRank": 1,
            "kind": "TEXT",
            "role": "FACT",
            "text": f"候选证据 {index}",
            "nodeContentHash": f"{index + 100:064x}",
            "objectContentHash": f"{index + 200:064x}",
            "sourceHash": f"{index + 300:064x}",
        }]
        cases.append({
            "caseId": case_id,
            "coursePackId": "layout-design",
            "coursePackVersion": "1",
            "normalizedQuestion": question,
            "decomposition": decomposition(question),
            "expectedProviderCalls": 2,
            "probeRankings": [{
                "probeId": "probe-whole",
            }],
            "objectRanking": [{
                "objectId": object_id,
                "coursePackId": "layout-design",
                "rank": 1,
                "weightedRrfScore": 1 / 61,
                "bestSourceRank": 1,
                "reserved": True,
                "reservations": [],
                "sources": [],
            }],
            "candidateNodes": candidate_nodes,
            "candidateNodeIdsSha256":
                MATRIX.sha256_stable([node_id]),
        })
    return {
        "schemaVersion": 1,
        "kind": "T44_CLAIM_CANDIDATE_RUNTIME_INPUT",
        "runtimeSuite": {
            "id": "lumi-t44-claim-recovery-test-runtime",
            "version": "2026-07-29.1",
            "suiteHash": "b" * 64,
        },
        "corpusSnapshot": {
            "bundleHash": "c" * 64,
        },
        "config": MATRIX.CANDIDATE_CONFIG,
        "configHash":
            MATRIX.sha256_stable(MATRIX.CANDIDATE_CONFIG),
        "expectedProviderCalls": 100,
        "expectedChannelCalls": {
            "LEXICAL": 50,
            "TEXT_VECTOR": 50,
        },
        "cases": cases,
    }


class T44ClaimMatrixUnitTests(unittest.TestCase):
    def test_frozen_model_and_matrix_contract(self) -> None:
        self.assertEqual(
            MATRIX.SCORE_CONFIG["modelId"],
            "BAAI/bge-small-zh-v1.5",
        )
        self.assertEqual(
            MATRIX.SCORE_CONFIG["modelRevision"],
            "7999e1d3359715c523056ef9478215996d62a620",
        )
        self.assertEqual(MATRIX.REPETITIONS, 3)
        self.assertEqual(MATRIX.MAX_CLAIMS, 4)
        self.assertEqual(MATRIX.MAX_CANDIDATES, 176)

    def test_runtime_input_is_strict_and_label_blind(self) -> None:
        value = runtime_input()
        validated = MATRIX.validate_candidate_input(value)
        self.assertEqual(len(validated["cases"]), 50)
        value["cases"][0]["requiredEvidenceGroups"] = []
        with self.assertRaisesRegex(
            ValueError,
            "LABEL_FIELD_FORBIDDEN",
        ):
            MATRIX.validate_candidate_input(value)

    def test_nested_label_fields_are_also_rejected(self) -> None:
        value = runtime_input()
        value["cases"][0]["probeRankings"][0]["qrels"] = {}
        with self.assertRaisesRegex(
            ValueError,
            "LABEL_FIELD_FORBIDDEN",
        ):
            MATRIX.validate_candidate_input(value)

    def test_candidate_node_set_hash_is_verified(self) -> None:
        value = runtime_input()
        value["cases"][0]["candidateNodeIdsSha256"] = "0" * 64
        with self.assertRaisesRegex(
            ValueError,
            "CANDIDATE_SET_HASH_INVALID",
        ):
            MATRIX.validate_candidate_input(value)

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
        ranking = MATRIX.rank_scores(
            candidates,
            [0.5, 0.5],
        )
        self.assertEqual(
            [row["nodeId"] for row in ranking],
            [
                f"node-{'a' * 64}",
                f"node-{'b' * 64}",
            ],
        )

    def test_matrix_timing_rejects_score_drift(self) -> None:
        calls = 0

        def drifting() -> list[list[float]]:
            nonlocal calls
            calls += 1
            return [[float(calls)]]

        with self.assertRaisesRegex(
            ValueError,
            "MATRIX_NONDETERMINISTIC",
        ):
            MATRIX.timed_matrix(
                object(),
                "cpu",
                drifting,
            )


if __name__ == "__main__":
    unittest.main()

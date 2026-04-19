"""
Unit tests for the M3 #4 ingestion + shot-batch agent tools.

These tools form the LangGraph HITL layer that lets the chat supervisor
(a) classify a producer's request to the right ingestion surface and
(b) propose the three ingestion pipelines + shot-batch run as
interrupt-gated actions.
"""

from __future__ import annotations

import unittest

from deep.tools import (
    ALL_TOOLS,
    DEFAULT_RUNTIME_ALLOWLIST,
    SUPERVISOR_CORE_TOOLS,
    TOOL_POLICY_TOKENS,
    filter_tools_by_allowlist,
    is_tool_allowed,
    recommend_ingestion_path,
    request_generate_shot_batch,
    request_ingestion_run,
)


class RecommendIngestionPathTests(unittest.TestCase):
    def test_short_brief_routes_to_idea(self) -> None:
        out = recommend_ingestion_path.invoke(
            {
                "user_request": "A kid finds a dragon egg in his backyard.",
            }
        )
        self.assertEqual(out["mode"], "idea")
        self.assertIn("title", out["requiredFields"])
        self.assertIn("idea", out["requiredFields"])
        self.assertTrue(out["recommendationId"].startswith("ingestreco_"))

    def test_screenplay_formatting_routes_to_screenplay(self) -> None:
        out = recommend_ingestion_path.invoke(
            {
                "user_request": (
                    "INT. LIBRARY - NIGHT\n\nSARAH (30) leans over a dusty book. "
                    "EXT. STREET - LATER\n\nShe runs. CUT TO: a stranger watching."
                ),
            }
        )
        self.assertEqual(out["mode"], "screenplay")
        self.assertEqual(
            out["requiredFields"],
            ["title", "screenplay", "style"],
        )

    def test_long_prose_routes_to_novel(self) -> None:
        paragraph = (
            "The harbour lay silent under a bruised sky, and Maeve stood at the "
            "end of the pier with the letter pressed tight against her ribs. "
        ) * 12
        out = recommend_ingestion_path.invoke(
            {
                "user_request": paragraph + "\n\n" + paragraph,
            }
        )
        self.assertEqual(out["mode"], "novel")
        self.assertIn("targetEpisodeCount", out["requiredFields"])

    def test_caller_flag_overrides_heuristic(self) -> None:
        out = recommend_ingestion_path.invoke(
            {
                "user_request": "just a short pitch",
                "has_novel_text": True,
            }
        )
        self.assertEqual(out["mode"], "novel")

    def test_recommendation_is_deterministic(self) -> None:
        a = recommend_ingestion_path.invoke(
            {"user_request": "A heist in Kyoto told in flashbacks."}
        )
        b = recommend_ingestion_path.invoke(
            {"user_request": "A heist in Kyoto told in flashbacks."}
        )
        self.assertEqual(a["recommendationId"], b["recommendationId"])


class RequestIngestionRunTests(unittest.TestCase):
    def test_shape_is_waiting_for_human(self) -> None:
        payload = request_ingestion_run.invoke(
            {
                "mode": "screenplay",
                "title": "  Night Train  ",
                "rationale": "User pasted slug-line formatted text.",
                "hints": {
                    "style": "Neo-noir, anamorphic",
                    "targetEpisodeCount": 3,
                    "ignoredKey": "this should be dropped",
                },
            }
        )
        self.assertEqual(payload["action"], "request_ingestion_run")
        self.assertEqual(payload["status"], "waiting_for_human")
        self.assertEqual(payload["schemaVersion"], "v2")
        self.assertEqual(payload["input"]["mode"], "screenplay")
        self.assertEqual(payload["input"]["title"], "Night Train")
        self.assertEqual(payload["input"]["hints"]["style"], "Neo-noir, anamorphic")
        self.assertEqual(payload["input"]["hints"]["targetEpisodeCount"], 3)
        self.assertNotIn("ignoredKey", payload["input"]["hints"])

    def test_invalid_mode_rejected_by_pydantic_literal(self) -> None:
        # The tool's Literal[] type is enforced by langchain's Pydantic schema
        # before the body runs; attempting an unsupported mode surfaces as a
        # validation error rather than silently falling through.
        from pydantic import ValidationError

        with self.assertRaises(ValidationError):
            request_ingestion_run.invoke(
                {
                    "mode": "not-a-mode",
                    "title": "X",
                    "rationale": "",
                    "hints": {},
                }
            )

    def test_empty_title_gets_placeholder(self) -> None:
        payload = request_ingestion_run.invoke(
            {
                "mode": "novel",
                "title": "   ",
                "rationale": "",
                "hints": {},
            }
        )
        self.assertEqual(payload["input"]["title"], "Untitled novel")


class RequestGenerateShotBatchTests(unittest.TestCase):
    def test_clamps_concurrency(self) -> None:
        payload = request_generate_shot_batch.invoke(
            {
                "storyboard_id": "sb_1",
                "branch_id": "br_main",
                "node_count": 12,
                "rationale": "All shots still unrendered.",
                "concurrency": 99,
            }
        )
        self.assertEqual(payload["input"]["concurrency"], 6)
        self.assertEqual(payload["input"]["nodeCount"], 12)
        self.assertTrue(payload["input"]["skipExisting"])

    def test_negative_concurrency_becomes_one(self) -> None:
        payload = request_generate_shot_batch.invoke(
            {
                "storyboard_id": "sb_1",
                "branch_id": "br_main",
                "node_count": 0,
                "rationale": "",
                "concurrency": -5,
            }
        )
        self.assertEqual(payload["input"]["concurrency"], 1)
        self.assertEqual(payload["input"]["nodeCount"], 0)

    def test_shape_is_waiting_for_human(self) -> None:
        payload = request_generate_shot_batch.invoke(
            {
                "storyboard_id": "sb_42",
                "branch_id": "br_main",
                "node_count": 8,
                "rationale": "Producer asked to render everything.",
            }
        )
        self.assertEqual(payload["status"], "waiting_for_human")
        self.assertEqual(payload["action"], "request_generate_shot_batch")


class PolicyAndRegistryTests(unittest.TestCase):
    def test_policy_tokens_registered(self) -> None:
        self.assertEqual(
            TOOL_POLICY_TOKENS[recommend_ingestion_path.name], "ingestion.run"
        )
        self.assertEqual(
            TOOL_POLICY_TOKENS[request_ingestion_run.name], "ingestion.run"
        )
        self.assertEqual(
            TOOL_POLICY_TOKENS[request_generate_shot_batch.name], "shot_batch.run"
        )

    def test_default_allowlist_includes_new_tokens(self) -> None:
        self.assertIn("ingestion.run", DEFAULT_RUNTIME_ALLOWLIST)
        self.assertIn("shot_batch.run", DEFAULT_RUNTIME_ALLOWLIST)

    def test_is_tool_allowed_under_default_policy(self) -> None:
        # Passing empty allowlist should trigger default policy.
        self.assertTrue(is_tool_allowed([], "ingestion.run"))
        self.assertTrue(is_tool_allowed([], "shot_batch.run"))
        # But team.manage is still gated behind explicit opt-in.
        self.assertFalse(is_tool_allowed([], "team.manage"))

    def test_supervisor_core_includes_request_tools(self) -> None:
        supervisor_names = {getattr(t, "name", "") for t in SUPERVISOR_CORE_TOOLS}
        self.assertIn(recommend_ingestion_path.name, supervisor_names)
        self.assertIn(request_ingestion_run.name, supervisor_names)
        self.assertIn(request_generate_shot_batch.name, supervisor_names)

    def test_new_tools_present_in_all_tools(self) -> None:
        all_names = {getattr(t, "name", "") for t in ALL_TOOLS}
        self.assertIn(recommend_ingestion_path.name, all_names)
        self.assertIn(request_ingestion_run.name, all_names)
        self.assertIn(request_generate_shot_batch.name, all_names)

    def test_filter_by_restrictive_allowlist_drops_batch_tool(self) -> None:
        # Explicit allowlist that omits shot_batch.run should remove the batch
        # request tool while still allowing ingestion tools.
        allowlist = ["ingestion.run", "graph.patch"]
        filtered = filter_tools_by_allowlist(
            [recommend_ingestion_path, request_ingestion_run, request_generate_shot_batch],
            allowlist,
        )
        filtered_names = {getattr(t, "name", "") for t in filtered}
        self.assertIn(recommend_ingestion_path.name, filtered_names)
        self.assertIn(request_ingestion_run.name, filtered_names)
        self.assertNotIn(request_generate_shot_batch.name, filtered_names)


if __name__ == "__main__":
    unittest.main()

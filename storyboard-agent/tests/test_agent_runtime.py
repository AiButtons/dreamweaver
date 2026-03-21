import json
import unittest

from agent import _apply_policy_guard, _extract_team_constraints


class AgentRuntimePolicyTests(unittest.TestCase):
    def test_extract_team_constraints_reads_enabled_members_and_allowlist(self):
        state = {
            "team_config": {
                "teamId": "producer_guarded_default",
                "members": [
                    {"agentName": "planner", "enabled": True},
                    {"agentName": "continuity_critic", "enabled": False},
                    {"agentName": "visual_director", "enabled": True},
                ],
            },
            "effective_tool_scope": ["graph.patch", "execution.plan"],
        }
        members, allowlist, team_id = _extract_team_constraints(state)
        self.assertEqual(team_id, "producer_guarded_default")
        self.assertEqual(members, {"planner", "visual_director"})
        self.assertEqual(allowlist, ["graph.patch", "execution.plan"])

    def test_policy_guard_blocks_disallowed_action(self):
        state = {
            "team_config": {"teamId": "custom_team", "revisionId": "custom_team:v2"},
            "effective_tool_scope": ["graph.patch"],
        }
        result = {
            "messages": [
                {
                    "role": "assistant",
                    "content": json.dumps(
                        {
                            "action": "approve_media_prompt",
                            "status": "waiting_for_human",
                        }
                    ),
                }
            ]
        }
        guarded = _apply_policy_guard(state, result)
        self.assertIn("policy_trace", guarded)
        self.assertGreater(len(guarded["policy_trace"]), 0)
        final_payload = json.loads(guarded["messages"][-1]["content"])
        self.assertEqual(final_payload["status"], "blocked")
        self.assertEqual(final_payload["action"], "approve_media_prompt")

    def test_policy_guard_keeps_allowed_action(self):
        state = {
            "team_config": {"teamId": "custom_team", "revisionId": "custom_team:v2"},
            "effective_tool_scope": ["media.prompt"],
        }
        result = {
            "messages": [
                {
                    "role": "assistant",
                    "content": json.dumps(
                        {
                            "action": "approve_media_prompt",
                            "status": "waiting_for_human",
                        }
                    ),
                }
            ]
        }
        guarded = _apply_policy_guard(state, result)
        self.assertNotIn("policy_trace", guarded)
        self.assertEqual(len(guarded["messages"]), 1)


if __name__ == "__main__":
    unittest.main()


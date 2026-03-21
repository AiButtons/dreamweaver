"""
Storyboard Agent entrypoint.

Modes:
- v1_linear: legacy deterministic linear graph (explicit team profile only)
- v2_deep: deepagents multi-agent runtime (default)
- shadow_compare: v2_deep primary + v1 comparison diagnostics
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Set, Tuple, TypedDict

try:
    from langgraph.graph import END, StateGraph
except ModuleNotFoundError:
    END = "__end__"
    StateGraph = None  # type: ignore[assignment]

from deep import create_storyboard_deep_agent_graph

try:
    from linear_agent import graph as linear_graph
except ModuleNotFoundError:
    linear_graph = None


class RouterState(TypedDict, total=False):
    messages: List[Dict[str, Any]]
    storyboardId: str
    storyboard_id: str
    team_config: Dict[str, Any]
    runtime_policy: Dict[str, Any]
    effective_tool_scope: List[str]
    effective_resource_scope: List[str]
    policy_trace: List[Dict[str, Any]]
    shadow_compare: Dict[str, Any]


_ACTION_POLICY_TOKENS: Dict[str, str] = {
    "approve_graph_patch": "graph.patch",
    "approve_media_prompt": "media.prompt",
    "approve_execution_plan": "execution.plan",
    "approve_batch_ops": "execution.plan",
    "approve_dailies_batch": "dailies.batch",
    "preview_simulation_critic_plan": "simulation.critic",
    "approve_merge_policy": "branch.merge",
    "approve_repair_plan": "repair.plan",
    "select_agent_team": "team.manage",
    "create_agent_team": "team.manage",
    "update_agent_team_member": "team.manage",
    "publish_agent_team_revision": "team.manage",
    "generate_team_from_prompt": "team.manage",
}

_GRAPH_CACHE: Dict[Tuple[str, str], Any] = {}


def _stable_bucket(raw: str) -> int:
    if not raw:
        return 0
    hash_value = 0
    for char in raw:
        hash_value = ((hash_value << 5) - hash_value) + ord(char)
        hash_value &= 0xFFFFFFFF
    return abs(hash_value) % 100


def _last_assistant_content(result: Dict[str, Any]) -> str:
    messages = result.get("messages", [])
    if not isinstance(messages, list):
        return ""
    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        if str(message.get("role", "")) in {"assistant", "ai"}:
            return str(message.get("content", ""))
    return ""


def _try_json(content: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def _compare_results(v2_result: Dict[str, Any], v1_result: Dict[str, Any]) -> Dict[str, Any]:
    v2_payload = _try_json(_last_assistant_content(v2_result))
    v1_payload = _try_json(_last_assistant_content(v1_result))

    v2_hitl = v2_payload.get("hitl", {}) if isinstance(v2_payload.get("hitl"), dict) else {}
    v1_hitl = v1_payload.get("hitl", {}) if isinstance(v1_payload.get("hitl"), dict) else {}
    v2_action = str(v2_hitl.get("action", ""))
    v1_action = str(v1_hitl.get("action", ""))

    return {
        "status": "ok",
        "v2HitlAction": v2_action,
        "v1HitlAction": v1_action,
        "sameAction": bool(v2_action and v1_action and v2_action == v1_action),
    }


def _is_tool_allowed(allowlist: List[str], token: str) -> bool:
    if len(allowlist) == 0:
        return True
    if "*" in allowlist:
        return True
    if token in allowlist:
        return True
    if token.startswith("media.") and "media.prompt" in allowlist:
        return True
    return False


def _extract_action(payload: Dict[str, Any]) -> str:
    if not isinstance(payload, dict):
        return ""
    direct_action = payload.get("action")
    if isinstance(direct_action, str) and direct_action:
        return direct_action
    hitl = payload.get("hitl")
    if isinstance(hitl, dict):
        nested_action = hitl.get("action")
        if isinstance(nested_action, str) and nested_action:
            return nested_action
    return ""


def _extract_team_constraints(state: RouterState) -> Tuple[Set[str], List[str], str]:
    team_config = state.get("team_config", {})
    team_id = ""
    enabled_members: Set[str] = set()
    if isinstance(team_config, dict):
        team_id = str(team_config.get("teamId", "")).strip().lower()
        members = team_config.get("members")
        if isinstance(members, list):
            for member in members:
                if not isinstance(member, dict):
                    continue
                if not bool(member.get("enabled", True)):
                    continue
                agent_name = str(member.get("agentName", "")).strip().lower()
                if agent_name:
                    enabled_members.add(agent_name)

    allowlist_raw = state.get("effective_tool_scope", [])
    allowlist = (
        [str(item).strip() for item in allowlist_raw if isinstance(item, str) and str(item).strip()]
        if isinstance(allowlist_raw, list)
        else []
    )
    return enabled_members, allowlist, team_id


def _resolve_deep_graph(state: RouterState):
    enabled_members, allowlist, _ = _extract_team_constraints(state)
    cache_key = (
        "|".join(sorted(enabled_members)),
        "|".join(sorted(allowlist)),
    )
    cached = _GRAPH_CACHE.get(cache_key)
    if cached is not None:
        return cached
    graph = create_storyboard_deep_agent_graph(
        enabled_member_names=enabled_members if len(enabled_members) > 0 else None,
        tool_allowlist=allowlist,
    )
    _GRAPH_CACHE[cache_key] = graph
    return graph


def _apply_policy_guard(state: RouterState, result: RouterState) -> RouterState:
    allowlist_raw = state.get("effective_tool_scope", [])
    allowlist = (
        [str(item).strip() for item in allowlist_raw if isinstance(item, str) and str(item).strip()]
        if isinstance(allowlist_raw, list)
        else []
    )
    if len(allowlist) == 0:
        return result

    payload = _try_json(_last_assistant_content(result))
    action = _extract_action(payload)
    if not action:
        return result
    token = _ACTION_POLICY_TOKENS.get(action)
    if not token:
        return result
    if _is_tool_allowed(allowlist, token):
        return result

    team_config = state.get("team_config", {})
    team_id = str(team_config.get("teamId", "")) if isinstance(team_config, dict) else ""
    revision_id = str(team_config.get("revisionId", "")) if isinstance(team_config, dict) else ""
    blocked_payload = {
        "schemaVersion": "v2",
        "status": "blocked",
        "blockedReason": f"Action '{action}' is outside team tool allowlist.",
        "action": action,
        "policyEvidence": {
            "teamId": team_id,
            "revisionId": revision_id,
            "requiredToken": token,
            "allowlist": allowlist,
            "whyAllowed": False,
            "whichPolicyRule": "toolAllowlist",
        },
        "nextAction": "manual_mode",
        "nextPayload": {
            "reason": "policy_denied",
            "action": action,
        },
    }

    messages = result.get("messages", [])
    if isinstance(messages, list):
        messages.append({"role": "assistant", "content": json.dumps(blocked_payload)})
        result["messages"] = messages
    else:
        result["messages"] = [{"role": "assistant", "content": json.dumps(blocked_payload)}]

    policy_trace = result.get("policy_trace", [])
    if not isinstance(policy_trace, list):
        policy_trace = []
    policy_trace.append(
        {
            "stage": "policy_guard",
            "rule": "tool_allowlist",
            "allowed": False,
            "action": action,
            "requiredToken": token,
        }
    )
    result["policy_trace"] = policy_trace
    return result


def _run_selected_graph(state: RouterState) -> RouterState:
    team_config = state.get("team_config", {})
    _, _, team_id = _extract_team_constraints(state)
    mode = "v2_deep"
    if team_id in {"legacy_linear", "legacy_v1"}:
        mode = "v1_linear"
    if team_id in {"shadow_compare"}:
        mode = "shadow_compare"
    if os.getenv("AGENT_GLOBAL_KILL_SWITCH", "false").strip().lower() == "true":
        mode = "v1_linear"

    rollout_percent_raw = os.getenv("AGENT_ROLLOUT_PERCENT", "100").strip()
    try:
        rollout_percent = max(0, min(100, int(rollout_percent_raw)))
    except ValueError:
        rollout_percent = 100
    storyboard_identifier = (
        str(state.get("storyboardId", ""))
        or str(state.get("storyboard_id", ""))
    )
    if mode == "v2_deep" and rollout_percent < 100:
        if _stable_bucket(storyboard_identifier) >= rollout_percent:
            mode = "v1_linear"

    policy_trace: List[Dict[str, Any]] = []
    runtime_policy = state.get("runtime_policy", {})
    if isinstance(runtime_policy, dict):
        policy_trace.append(
            {
                "stage": "router",
                "rule": "runtime_policy_observed",
                "requiresHitl": bool(runtime_policy.get("requiresHitl", True)),
                "maxBatchSize": int(runtime_policy.get("maxBatchSize", 0) or 0),
            }
        )
    if isinstance(team_config, dict):
        policy_trace.append(
            {
                "stage": "router",
                "rule": "team_config_observed",
                "teamId": str(team_config.get("teamId", "")),
                "revisionId": str(team_config.get("revisionId", "")),
                "resolvedMode": mode,
                "rolloutPercent": rollout_percent,
                "rolloutBucket": _stable_bucket(storyboard_identifier),
            }
        )

    if mode == "v1_linear":
        if linear_graph is None:
            return {
                "messages": [
                    {
                        "role": "assistant",
                        "content": json.dumps(
                            {
                                "schemaVersion": "v2",
                                "status": "failed",
                                "blockedReason": "Linear agent dependencies are unavailable.",
                                "nextAction": "manual_mode",
                            }
                        ),
                    }
                ],
                "policy_trace": policy_trace,
            }
        result = linear_graph.invoke(state)
        result["policy_trace"] = policy_trace
        return result

    try:
        deep_graph = _resolve_deep_graph(state)
    except RuntimeError as error:
        return {
            "messages": [
                {
                    "role": "assistant",
                    "content": json.dumps(
                        {
                            "schemaVersion": "v2",
                            "status": "failed",
                            "blockedReason": str(error),
                            "nextAction": "manual_mode",
                        }
                    ),
                }
            ],
            "policy_trace": policy_trace,
        }
    v2_result = deep_graph.invoke(state)
    v2_result = _apply_policy_guard(state, v2_result)
    if mode != "shadow_compare":
        v2_result["policy_trace"] = policy_trace
        return v2_result

    try:
        if linear_graph is None:
            comparison = {
                "status": "failed",
                "error": "Linear agent dependencies are unavailable.",
            }
        else:
            v1_result = linear_graph.invoke(state)
            comparison = _compare_results(v2_result, v1_result)
    except Exception as error:
        comparison = {"status": "failed", "error": str(error)}

    merged = dict(v2_result)
    merged["shadow_compare"] = comparison
    merged["policy_trace"] = policy_trace
    return merged


if StateGraph is not None:
    router = StateGraph(RouterState)
    router.add_node("dispatch", _run_selected_graph)
    router.set_entry_point("dispatch")
    router.add_edge("dispatch", END)
    graph = router.compile()
else:
    router = None
    graph = None

"""
Storyboard Agent (LangGraph)

Hardened deterministic orchestration graph for:
- graph patch proposals
- media prompt proposals
- strict HITL gating

Graph id: storyboard_agent
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, TypedDict

from langchain_core.messages import AIMessage
from langgraph.graph import END, StateGraph

ALLOWED_NODE_TYPES = {
    "scene",
    "shot",
    "branch",
    "merge",
    "character_ref",
    "background_ref",
}
ALLOWED_EDGE_TYPES = {"serial", "parallel", "branch", "merge"}
MAX_PATCH_OPERATIONS_PER_APPROVAL = 1
MAX_PROMPT_CHARS = 2400
SCHEMA_VERSION = "v1"


class StoryboardAgentState(TypedDict, total=False):
    messages: List[Dict[str, Any]]
    graph_snapshot: Dict[str, Any]
    entities: Dict[str, Any]
    rolling_context_map: Dict[str, Any]
    pending_approvals: List[Dict[str, Any]]
    provider_policy: Dict[str, Any]

    intent: str
    confidence: float
    context_bundle: Dict[str, Any]
    plan: Dict[str, Any]
    guarded_plan: Dict[str, Any]
    hitl_request: Dict[str, Any]
    execution_result: Dict[str, Any]
    refreshed_context: Dict[str, Any]
    diagnostics: Dict[str, Any]
    warnings: List[str]


@dataclass(frozen=True)
class IntentRule:
    intent: str
    tokens: List[str]
    confidence: float


INTENT_RULES: List[IntentRule] = [
    IntentRule("branch", ["branch", "split", "parallel"], 0.88),
    IntentRule("merge", ["merge", "combine"], 0.86),
    IntentRule("media_video", ["video", "shot", "clip", "animate"], 0.9),
    IntentRule("media_image", ["image", "compose", "still", "frame"], 0.9),
    IntentRule("consistency", ["continuity", "identity", "wardrobe", "character"], 0.82),
]


def _safe_json(data: Any) -> str:
    try:
        return json.dumps(data, indent=2, ensure_ascii=True)
    except Exception:
        return "{\"error\":\"serialization_failed\"}"


def _last_user_text(state: StoryboardAgentState) -> str:
    messages = state.get("messages", [])
    if not messages:
        return ""
    for message in reversed(messages):
        role = str(message.get("role", ""))
        if role in ("user", "human"):
            return str(message.get("content", "")).strip().lower()
    return str(messages[-1].get("content", "")).strip().lower()


def _normalize_prompt(prompt: str) -> str:
    compact = " ".join(prompt.split())
    return compact[:MAX_PROMPT_CHARS]


def _lineage_hash(node_id: str, summary: str) -> str:
    digest = hashlib.sha256(f"{node_id}:{summary}".encode("utf-8")).hexdigest()[:16]
    return f"ln_{digest}"


def _target_node_from_snapshot(state: StoryboardAgentState) -> Dict[str, Any]:
    snapshot = state.get("graph_snapshot", {})
    nodes = snapshot.get("nodes", [])
    if not isinstance(nodes, list) or len(nodes) == 0:
        return {}
    candidate = nodes[-1]
    return candidate if isinstance(candidate, dict) else {}


def _sanitize_graph_patch(plan: Dict[str, Any], warnings: List[str]) -> Dict[str, Any]:
    operations_raw = plan.get("operations", [])
    if not isinstance(operations_raw, list):
        warnings.append("planner emitted non-list operations. Reset to empty list.")
        operations_raw = []

    sanitized_ops: List[Dict[str, Any]] = []
    for operation in operations_raw:
        if not isinstance(operation, dict):
            continue
        op_name = str(operation.get("op", ""))
        if op_name not in {
            "create_node",
            "update_node",
            "delete_node",
            "create_edge",
            "update_edge",
            "delete_edge",
        }:
            warnings.append(f"unsupported operation '{op_name}' dropped.")
            continue

        safe: Dict[str, Any] = {"op": op_name}
        for key in [
            "nodeId",
            "edgeId",
            "label",
            "segment",
            "sourceNodeId",
            "targetNodeId",
            "branchId",
        ]:
            if key in operation:
                safe[key] = operation[key]

        node_type = operation.get("nodeType")
        if node_type in ALLOWED_NODE_TYPES:
            safe["nodeType"] = node_type
        elif node_type is not None:
            warnings.append(f"invalid nodeType '{node_type}' removed.")

        edge_type = operation.get("edgeType")
        if edge_type in ALLOWED_EDGE_TYPES:
            safe["edgeType"] = edge_type
        elif edge_type is not None:
            warnings.append(f"invalid edgeType '{edge_type}' removed.")

        position = operation.get("position")
        if isinstance(position, dict):
            try:
                safe["position"] = {
                    "x": float(position.get("x", 0)),
                    "y": float(position.get("y", 0)),
                }
            except Exception:
                warnings.append("invalid position dropped.")

        if isinstance(operation.get("order"), (int, float)):
            safe["order"] = int(operation["order"])
        if isinstance(operation.get("isPrimary"), bool):
            safe["isPrimary"] = operation["isPrimary"]

        sanitized_ops.append(safe)

    if len(sanitized_ops) == 0:
        warnings.append("no valid operations found; planner fallback applied.")
        fallback = {
            "op": "create_node",
            "nodeType": "scene",
            "label": "Fallback Scene Node",
            "segment": "Fallback node because planner output was empty.",
        }
        sanitized_ops = [fallback]

    if len(sanitized_ops) > MAX_PATCH_OPERATIONS_PER_APPROVAL:
        warnings.append(
            f"trimmed operations from {len(sanitized_ops)} to {MAX_PATCH_OPERATIONS_PER_APPROVAL} "
            "to enforce one-mutation-per-approval.",
        )
        sanitized_ops = sanitized_ops[:MAX_PATCH_OPERATIONS_PER_APPROVAL]

    return {
        **plan,
        "operations": sanitized_ops,
    }


def _sanitize_media_prompt(plan: Dict[str, Any], warnings: List[str]) -> Dict[str, Any]:
    media_type = str(plan.get("mediaType", "image"))
    if media_type not in {"image", "video"}:
        warnings.append(f"invalid mediaType '{media_type}' -> defaulting to image.")
        media_type = "image"

    prompt = _normalize_prompt(str(plan.get("prompt", "")))
    if not prompt:
        warnings.append("empty prompt detected, applied fallback prompt.")
        prompt = "Generate a cinematic result while preserving character identity lock."

    negative_prompt = _normalize_prompt(str(plan.get("negativePrompt", "")))
    context_summary = _normalize_prompt(str(plan.get("contextSummary", "")))

    return {
        **plan,
        "mediaType": media_type,
        "prompt": prompt,
        "negativePrompt": negative_prompt,
        "contextSummary": context_summary,
    }


def intent_router(state: StoryboardAgentState) -> StoryboardAgentState:
    text = _last_user_text(state)
    for rule in INTENT_RULES:
        if any(token in text for token in rule.tokens):
            return {"intent": rule.intent, "confidence": rule.confidence}
    return {"intent": "draft", "confidence": 0.7}


def context_builder(state: StoryboardAgentState) -> StoryboardAgentState:
    target_node = _target_node_from_snapshot(state)
    target_node_id = str(target_node.get("id", ""))
    rolling_map = state.get("rolling_context_map", {})
    rolling = rolling_map.get(target_node_id, {}) if isinstance(rolling_map, dict) else {}

    summary = str(rolling.get("rollingSummary", ""))
    context_bundle = {
        "targetNodeId": target_node_id,
        "targetNode": target_node,
        "rollingContext": rolling,
        "lineageHash": _lineage_hash(target_node_id, summary),
        "nodeCount": len(state.get("graph_snapshot", {}).get("nodes", [])),
        "edgeCount": len(state.get("graph_snapshot", {}).get("edges", [])),
    }

    diagnostics = {
        "contextBuilder": {
            "targetNodeId": target_node_id,
            "lineageHash": context_bundle["lineageHash"],
            "summaryChars": len(summary),
        }
    }
    return {"context_bundle": context_bundle, "diagnostics": diagnostics}


def planner(state: StoryboardAgentState) -> StoryboardAgentState:
    intent = state.get("intent", "draft")
    context = state.get("context_bundle", {})
    target_node_id = str(context.get("targetNodeId", ""))
    rolling_summary = str(context.get("rollingContext", {}).get("rollingSummary", ""))
    compact_summary = _normalize_prompt(rolling_summary)[:800]

    if intent == "branch":
        plan = {
            "type": "graph_patch",
            "title": "Propose Branch",
            "rationale": "Create a deliberate alternate storyline branch.",
            "diffSummary": f"Create one branch node from node {target_node_id}.",
            "operations": [
                {
                    "op": "create_node",
                    "nodeType": "branch",
                    "label": "Alternate Branch",
                    "segment": "A divergent storyline branch begins here.",
                }
            ],
        }
    elif intent == "merge":
        plan = {
            "type": "graph_patch",
            "title": "Propose Merge",
            "rationale": "Merge parallel paths into a single continuation.",
            "diffSummary": f"Create one merge edge targeting node {target_node_id}.",
            "operations": [{"op": "create_edge", "edgeType": "merge"}],
        }
    elif intent == "media_video":
        plan = {
            "type": "media_prompt",
            "mediaType": "video",
            "nodeId": target_node_id,
            "prompt": f"{compact_summary} Cinematic motion shot preserving identity lock.",
            "negativePrompt": "identity drift, face swap, silhouette mismatch",
            "contextSummary": compact_summary,
        }
    else:
        plan = {
            "type": "media_prompt",
            "mediaType": "image",
            "nodeId": target_node_id,
            "prompt": f"{compact_summary} Film still preserving identity lock.",
            "negativePrompt": "identity drift, age mismatch, facial mismatch",
            "contextSummary": compact_summary,
        }

    return {"plan": plan}


def consistency_guard(state: StoryboardAgentState) -> StoryboardAgentState:
    plan = dict(state.get("plan", {}))
    warnings = list(state.get("warnings", []))

    if not plan:
        warnings.append("planner returned empty plan.")
        return {"guarded_plan": {}, "warnings": warnings}

    plan_type = str(plan.get("type", ""))
    if plan_type == "graph_patch":
        guarded = _sanitize_graph_patch(plan, warnings)
    elif plan_type == "media_prompt":
        guarded = _sanitize_media_prompt(plan, warnings)
        directives = (
            " Identity lock: preserve immutable facial markers, age band, body silhouette, "
            "skin/hair signature. Wardrobe/hair/makeup may vary only via explicit variant."
        )
        guarded["prompt"] = _normalize_prompt(f"{guarded.get('prompt', '')}{directives}")
    else:
        warnings.append(f"unknown plan type '{plan_type}', forcing media_prompt fallback.")
        guarded = _sanitize_media_prompt(
            {
                "type": "media_prompt",
                "mediaType": "image",
                "nodeId": state.get("context_bundle", {}).get("targetNodeId", ""),
                "prompt": "Generate a cinematic still with strict identity lock.",
                "negativePrompt": "identity drift",
                "contextSummary": "",
            },
            warnings,
        )

    return {"guarded_plan": guarded, "warnings": warnings}


def hitl_gate(state: StoryboardAgentState) -> StoryboardAgentState:
    guarded = state.get("guarded_plan", {})
    if not guarded:
        return {"hitl_request": {"status": "failed", "reason": "empty_guarded_plan"}}

    if guarded.get("type") == "graph_patch":
        payload = {
            "schemaVersion": SCHEMA_VERSION,
            "action": "approve_graph_patch",
            "status": "waiting_for_human",
            "input": {
                "patchId": "patch-proposal",
                "title": guarded.get("title", "Graph Patch"),
                "rationale": guarded.get("rationale", ""),
                "diffSummary": guarded.get("diffSummary", ""),
                "operations": guarded.get("operations", []),
            },
            "queue": [{"kind": "mutation", "count": 1}],
        }
    else:
        payload = {
            "schemaVersion": SCHEMA_VERSION,
            "action": "approve_media_prompt",
            "status": "waiting_for_human",
            "input": {
                "nodeId": guarded.get("nodeId", ""),
                "mediaType": guarded.get("mediaType", "image"),
                "prompt": guarded.get("prompt", ""),
                "negativePrompt": guarded.get("negativePrompt", ""),
                "contextSummary": guarded.get("contextSummary", ""),
            },
            "queue": [{"kind": "media_execution", "count": 1}],
        }
    return {"hitl_request": payload}


def executor(state: StoryboardAgentState) -> StoryboardAgentState:
    request = state.get("hitl_request", {})
    if not request or request.get("status") != "waiting_for_human":
        return {
            "execution_result": {
                "status": "failed",
                "next": "manual_mode",
                "reason": "invalid_or_missing_hitl_request",
            }
        }

    provider_policy = state.get("provider_policy", {})
    requires_hitl = bool(provider_policy.get("requiresHitl", True))

    result = {
        "status": "queued",
        "next": "await_human_approval" if requires_hitl else "manual_mode",
        "requestedAction": request.get("action"),
        "payload": request.get("input", {}),
        "retryPolicy": {"maxRetries": 2, "timeoutSeconds": 30},
        "guardrails": {"parallelToolCalls": False, "maxPatchOperations": 1},
    }
    return {"execution_result": result}


def post_update_context_refresh(state: StoryboardAgentState) -> StoryboardAgentState:
    execution = state.get("execution_result", {})
    target_node_id = str(state.get("context_bundle", {}).get("targetNodeId", ""))
    refreshed = {
        "status": "pending_refresh" if execution.get("status") == "queued" else "skipped",
        "affectedNodeIds": [target_node_id] if target_node_id else [],
        "lineageHash": state.get("context_bundle", {}).get("lineageHash", ""),
    }
    return {"refreshed_context": refreshed}


def responder(state: StoryboardAgentState) -> StoryboardAgentState:
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "intent": state.get("intent", "draft"),
        "confidence": state.get("confidence", 0.0),
        "plan": state.get("guarded_plan", {}),
        "hitl": state.get("hitl_request", {}),
        "execution": state.get("execution_result", {}),
        "contextRefresh": state.get("refreshed_context", {}),
        "warnings": state.get("warnings", []),
        "diagnostics": state.get("diagnostics", {}),
    }
    message = AIMessage(content=_safe_json(payload))
    messages = list(state.get("messages", []))
    messages.append({"role": "assistant", "content": message.content})
    return {"messages": messages}


workflow = StateGraph(StoryboardAgentState)
workflow.add_node("intent_router", intent_router)
workflow.add_node("context_builder", context_builder)
workflow.add_node("planner", planner)
workflow.add_node("consistency_guard", consistency_guard)
workflow.add_node("hitl_gate", hitl_gate)
workflow.add_node("executor", executor)
workflow.add_node("post_update_context_refresh", post_update_context_refresh)
workflow.add_node("responder", responder)

workflow.set_entry_point("intent_router")
workflow.add_edge("intent_router", "context_builder")
workflow.add_edge("context_builder", "planner")
workflow.add_edge("planner", "consistency_guard")
workflow.add_edge("consistency_guard", "hitl_gate")
workflow.add_edge("hitl_gate", "executor")
workflow.add_edge("executor", "post_update_context_refresh")
workflow.add_edge("post_update_context_refresh", "responder")
workflow.add_edge("responder", END)

graph = workflow.compile()


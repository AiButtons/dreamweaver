"""
Deterministic tools used by the V2 deep-agent supervisor and subagents.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Dict, List, Literal

from langchain_core.tools import tool

ALLOWED_NODE_TYPES = {
    "scene",
    "shot",
    "branch",
    "merge",
    "character_ref",
    "background_ref",
}
ALLOWED_EDGE_TYPES = {"serial", "parallel", "branch", "merge"}
ALLOWED_GRAPH_OPS = {
    "create_node",
    "update_node",
    "delete_node",
    "create_edge",
    "update_edge",
    "delete_edge",
}

# Ingestion modes recognized by the supervisor when routing a producer's
# intent to the right ingestion surface. These mirror the three library-page
# dialogs (From Screenplay / From Idea / From Novel) wired up by ViMax M1–M3.
ALLOWED_INGESTION_MODES = {"screenplay", "idea", "novel"}


def _json_hash(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _safe_str(value: Any, fallback: str = "") -> str:
    return value if isinstance(value, str) else fallback


def _sanitize_graph_operations(operations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sanitized: List[Dict[str, Any]] = []
    for raw_operation in operations:
        operation = _as_dict(raw_operation)
        op_name = _safe_str(operation.get("op"))
        if op_name not in ALLOWED_GRAPH_OPS:
            continue
        parsed: Dict[str, Any] = {"op": op_name}

        for key in (
            "nodeId",
            "edgeId",
            "label",
            "segment",
            "sourceNodeId",
            "targetNodeId",
            "branchId",
        ):
            value = operation.get(key)
            if isinstance(value, str) and value:
                parsed[key] = value

        node_type = operation.get("nodeType")
        if isinstance(node_type, str) and node_type in ALLOWED_NODE_TYPES:
            parsed["nodeType"] = node_type

        edge_type = operation.get("edgeType")
        if isinstance(edge_type, str) and edge_type in ALLOWED_EDGE_TYPES:
            parsed["edgeType"] = edge_type

        position = operation.get("position")
        if isinstance(position, dict):
            parsed["position"] = {
                "x": float(position.get("x", 0)),
                "y": float(position.get("y", 0)),
            }

        if isinstance(operation.get("order"), (int, float)):
            parsed["order"] = int(operation["order"])
        if isinstance(operation.get("isPrimary"), bool):
            parsed["isPrimary"] = operation["isPrimary"]

        sanitized.append(parsed)
    return sanitized


@tool
def planner_propose_graph_patch(
    storyboard_id: str,
    branch_id: str,
    title: str,
    rationale: str,
    diff_summary: str,
    operations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Builds a deterministic graph-patch proposal from planner output."""
    sanitized_ops = _sanitize_graph_operations(operations)
    payload = {
        "storyboardId": storyboard_id,
        "branchId": branch_id,
        "title": title,
        "rationale": rationale,
        "diffSummary": diff_summary,
        "operations": sanitized_ops,
        "createdAt": int(time.time() * 1000),
    }
    payload["patchId"] = f"patch_{_json_hash(payload)}"
    return payload


@tool
def planner_propose_media_prompt(
    storyboard_id: str,
    branch_id: str,
    node_id: str,
    media_type: Literal["image", "video"],
    prompt: str,
    negative_prompt: str,
    context_summary: str,
    model_id: str = "",
) -> Dict[str, Any]:
    """Builds a deterministic media prompt proposal.

    Optional ``model_id`` lets the agent pin a specific backend model for this proposal:
      - images: ``zennah-image-gen`` (default), ``zennah-qwen-edit``, ``zennah-qwen-multiview``,
        ``gpt-image-1``, ``dall-e-3``.
      - videos: ``ltx-2.3`` (default, recommended — supports I2V + keyframe + retake),
        ``ltx-2`` (legacy), ``veo-3.1``.
    Pass an empty string to defer model choice to the executor.
    """
    model_id_norm = (model_id or "").strip()
    payload = {
        "storyboardId": storyboard_id,
        "branchId": branch_id,
        "nodeId": node_id,
        "mediaType": media_type,
        "modelId": model_id_norm or None,
        "prompt": " ".join(prompt.split())[:2400],
        "negativePrompt": " ".join(negative_prompt.split())[:1200],
        "contextSummary": " ".join(context_summary.split())[:2400],
        "createdAt": int(time.time() * 1000),
    }
    payload["promptId"] = f"prompt_{_json_hash(payload)}"
    return payload


@tool
def simulate_execution_plan(
    storyboard_id: str,
    branch_id: str,
    operations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Dry-run simulator that checks operation shape and returns risk profile."""
    sanitized_ops = _sanitize_graph_operations(operations)
    issues: List[Dict[str, Any]] = []
    if len(sanitized_ops) == 0:
        issues.append(
            {
                "code": "EMPTY_PLAN",
                "severity": "high",
                "message": "Execution plan has no valid operations.",
            }
        )

    for operation in sanitized_ops:
        if operation["op"] in {"create_edge", "update_edge"} and not operation.get("edgeType"):
            issues.append(
                {
                    "code": "EDGE_TYPE_REQUIRED",
                    "severity": "medium",
                    "message": "Edge operations should include edgeType.",
                    "op": operation,
                }
            )

    risk_level: Literal["low", "medium", "high", "critical"] = "low"
    if any(issue["severity"] == "high" for issue in issues):
        risk_level = "high"
    elif any(issue["severity"] == "medium" for issue in issues):
        risk_level = "medium"

    return {
        "storyboardId": storyboard_id,
        "branchId": branch_id,
        "valid": len(issues) == 0,
        "riskLevel": risk_level,
        "summary": "Dry-run simulation completed.",
        "issues": issues,
        "operationCount": len(sanitized_ops),
        "estimatedTotalCost": round(len(sanitized_ops) * 0.18, 2),
        "estimatedDurationSec": round(max(len(sanitized_ops), 1) * 1.6, 2),
        "planHash": _json_hash(
            {
                "storyboardId": storyboard_id,
                "branchId": branch_id,
                "operations": sanitized_ops,
            }
        ),
    }


@tool
def continuity_critic(
    storyboard_id: str,
    branch_id: str,
    rolling_summary: str,
    character_ids: List[str],
    selected_wardrobes: List[str],
) -> Dict[str, Any]:
    """Continuity critic for narration and identity consistency."""
    summary = rolling_summary.lower()
    violations: List[Dict[str, Any]] = []
    if "suddenly alive" in summary and "died" in summary:
        violations.append(
            {
                "code": "NARRATIVE_CONTRADICTION",
                "severity": "high",
                "message": "Narrative timeline contradiction detected.",
            }
        )
    if len(character_ids) > 0 and len(selected_wardrobes) == 0:
        violations.append(
            {
                "code": "WARDROBE_MISSING",
                "severity": "medium",
                "message": "Character present without explicit wardrobe variant.",
            }
        )

    return {
        "storyboardId": storyboard_id,
        "branchId": branch_id,
        "violations": violations,
        "status": "ok" if len(violations) == 0 else "warning",
    }


@tool
def producer_guard(
    storyboard_id: str,
    branch_id: str,
    operation_count: int,
    risk_level: Literal["low", "medium", "high", "critical"],
) -> Dict[str, Any]:
    """Scores approval policy for producer-facing HITL controls."""
    if risk_level in {"high", "critical"} or operation_count > 3:
        mode = "per_operation"
    elif operation_count > 1:
        mode = "batch_with_override"
    else:
        mode = "single"
    return {
        "storyboardId": storyboard_id,
        "branchId": branch_id,
        "approvalMode": mode,
        "requiresHitl": True,
        "maxBatchSize": 1 if mode == "per_operation" else 5,
    }


@tool
def recommend_ingestion_path(
    user_request: str,
    has_screenplay_text: bool = False,
    has_novel_text: bool = False,
    has_idea_text: bool = False,
) -> Dict[str, Any]:
    """Classifies a producer request to one of the three ingestion surfaces.

    Returns a deterministic recommendation (``mode``) with a short rationale and
    the input fields the UI will need to collect. This tool is non-mutating: it
    emits a recommendation only. The supervisor should hand off to
    ``request_ingestion_run`` (HITL) to actually kick off the pipeline.

    ``mode`` is one of ``screenplay`` | ``idea`` | ``novel``.

    Heuristics:
      * If the caller already pasted raw screenplay text (slug lines, INT./EXT.,
        dialogue blocks) → screenplay.
      * If the caller already pasted a long prose passage (>800 chars or
        multiple paragraphs of narration) → novel.
      * Otherwise, treat short briefs / premises / loglines as idea.
    """
    request_norm = " ".join(user_request.split()).lower()
    request_compact = request_norm[:4000]
    request_len = len(request_compact)

    screenplay_signals = 0
    for marker in ("int.", "ext.", "fade in", "fade out", "cut to", "scene "):
        if marker in request_compact:
            screenplay_signals += 1

    novel_signals = 0
    if request_len > 800:
        novel_signals += 1
    if request_compact.count("\n\n") >= 2:
        novel_signals += 1
    for marker in ("chapter ", "he said", "she said", "—", "“", "”"):
        if marker in request_compact:
            novel_signals += 1
            break

    idea_signals = 0
    for marker in ("idea:", "premise", "logline", "pitch", "concept"):
        if marker in request_compact:
            idea_signals += 1

    # Caller-provided input flags override heuristics when present.
    mode: str
    rationale: str
    if has_screenplay_text or screenplay_signals >= 2:
        mode = "screenplay"
        rationale = (
            "Request contains explicit screenplay formatting (slug lines / action "
            "blocks). Route to From-Screenplay ingestion."
        )
    elif has_novel_text or novel_signals >= 2 or (request_len > 1200 and idea_signals == 0):
        mode = "novel"
        rationale = (
            "Request reads like long-form prose. Route to From-Novel ingestion so "
            "the pipeline can chunk + compress + split into episodes."
        )
    elif has_idea_text or idea_signals >= 1 or request_len <= 800:
        mode = "idea"
        rationale = (
            "Request is a premise / logline / short brief. Route to From-Idea "
            "ingestion so the pipeline can expand it into a screenplay first."
        )
    else:
        mode = "idea"
        rationale = (
            "Ambiguous request. Defaulting to From-Idea because it is the cheapest "
            "ingestion path and can be re-ingested after more detail is gathered."
        )

    required_fields: List[str]
    if mode == "screenplay":
        required_fields = ["title", "screenplay", "style"]
    elif mode == "novel":
        required_fields = ["title", "novel", "style", "targetEpisodeCount"]
    else:
        required_fields = ["title", "idea", "style", "targetShotCount"]

    return {
        "mode": mode,
        "rationale": rationale,
        "requiredFields": required_fields,
        "requestLength": request_len,
        "recommendationId": f"ingestreco_{_json_hash({'r': request_compact[:2000], 'm': mode})}",
    }


@tool
def request_ingestion_run(
    mode: Literal["screenplay", "idea", "novel"],
    title: str,
    rationale: str,
    hints: Dict[str, Any],
) -> Dict[str, Any]:
    """Requests human approval to kick off an ingestion pipeline. Interrupt target.

    The producer confirms the mode + title + rationale in chat, and the UI opens
    the corresponding library-page dialog pre-populated with hints. The agent
    never ingests silently — this tool is the HITL gate between intent and
    pipeline execution.

    ``hints`` may include any of: ``style``, ``targetEpisodeCount``,
    ``targetShotCount``, ``userRequirement``, ``novelExcerpt``, ``ideaSynopsis``.
    """
    mode_norm = mode if mode in ALLOWED_INGESTION_MODES else "idea"
    clean_hints: Dict[str, Any] = {}
    for key in (
        "style",
        "userRequirement",
        "ideaSynopsis",
        "novelExcerpt",
        "screenplayExcerpt",
    ):
        value = hints.get(key)
        if isinstance(value, str) and value:
            clean_hints[key] = " ".join(value.split())[:2400]
    for key in ("targetEpisodeCount", "targetShotCount"):
        value = hints.get(key)
        if isinstance(value, (int, float)) and value > 0:
            clean_hints[key] = int(value)
    return {
        "schemaVersion": "v2",
        "action": "request_ingestion_run",
        "status": "waiting_for_human",
        "input": {
            "mode": mode_norm,
            "title": " ".join(title.split())[:200] or f"Untitled {mode_norm}",
            "rationale": " ".join(rationale.split())[:1200],
            "hints": clean_hints,
        },
    }


@tool
def request_generate_shot_batch(
    storyboard_id: str,
    branch_id: str,
    node_count: int,
    rationale: str,
    skip_existing: bool = True,
    concurrency: int = 3,
) -> Dict[str, Any]:
    """Requests human approval to run the Generate-All-Shots batch. Interrupt target.

    Triggers the per-shot image batch pipeline (portraits-as-references,
    bounded-concurrency) on the active storyboard once the producer approves in
    chat. Use ``skip_existing=True`` to preserve any shots the producer already
    rendered manually. Cap ``concurrency`` in [1, 6] — higher values saturate
    media-gen quotas.
    """
    safe_concurrency = max(1, min(6, int(concurrency) if isinstance(concurrency, (int, float)) else 3))
    safe_node_count = max(0, int(node_count) if isinstance(node_count, (int, float)) else 0)
    return {
        "schemaVersion": "v2",
        "action": "request_generate_shot_batch",
        "status": "waiting_for_human",
        "input": {
            "storyboardId": storyboard_id,
            "branchId": branch_id,
            "nodeCount": safe_node_count,
            "rationale": " ".join(rationale.split())[:1200],
            "skipExisting": bool(skip_existing),
            "concurrency": safe_concurrency,
        },
    }


@tool
def request_export_reel(
    storyboard_id: str,
    rationale: str,
    shot_count: int = 0,
    estimated_duration_s: float = 0.0,
) -> Dict[str, Any]:
    """Requests human approval to export the storyboard's reel as an mp4.
    Interrupt target.

    Calls the server-side ffmpeg pipeline: normalizes every shot into a
    uniform 1920x1080@30 clip (video / still-image loop / silent black
    fallback per what's been rendered) and concats them into a single
    mp4 uploaded to Convex storage. The export row is persisted so
    producers can re-download without paying another ffmpeg run.

    The export is idempotent in behavior (always produces a fresh row
    and a fresh mp4) but not in effect (each run costs ffmpeg + upload
    time), so agent-initiated exports should be rare + deliberate.
    """
    safe_shot_count = max(0, int(shot_count) if isinstance(shot_count, (int, float)) else 0)
    safe_duration = max(
        0.0,
        float(estimated_duration_s)
        if isinstance(estimated_duration_s, (int, float))
        else 0.0,
    )
    return {
        "schemaVersion": "v2",
        "action": "request_export_reel",
        "status": "waiting_for_human",
        "input": {
            "storyboardId": storyboard_id,
            "shotCount": safe_shot_count,
            "estimatedDurationS": safe_duration,
            "rationale": " ".join(rationale.split())[:1200],
        },
    }


@tool
def request_generate_shot_audio_batch(
    storyboard_id: str,
    branch_id: str,
    node_count: int,
    rationale: str,
    skip_existing: bool = True,
    concurrency: int = 3,
    voice: str = "nova",
    model: str = "tts-1",
    speed: float = 1.0,
) -> Dict[str, Any]:
    """Requests human approval to run the Generate-All-Audio (TTS) batch. Interrupt target.

    Triggers per-shot narration rendering via OpenAI TTS. Unlike the video
    batch this has no image prerequisite — the pipeline derives narration
    text from each shot's segment (or promptPack.imagePrompt as fallback).

    ``voice`` is validated against the OpenAI TTS vocabulary
    (alloy/echo/fable/onyx/nova/shimmer); unrecognized values are coerced
    to "nova" at the route boundary.
    ``speed`` is clamped in [0.25, 4.0]. ``concurrency`` caps at 5.
    """
    safe_concurrency = max(
        1,
        min(5, int(concurrency) if isinstance(concurrency, (int, float)) else 3),
    )
    safe_node_count = max(0, int(node_count) if isinstance(node_count, (int, float)) else 0)
    safe_speed = max(
        0.25,
        min(4.0, float(speed) if isinstance(speed, (int, float)) else 1.0),
    )
    voice_norm = (voice or "").strip().lower() or "nova"
    model_norm = (model or "").strip() or "tts-1"
    return {
        "schemaVersion": "v2",
        "action": "request_generate_shot_audio_batch",
        "status": "waiting_for_human",
        "input": {
            "storyboardId": storyboard_id,
            "branchId": branch_id,
            "nodeCount": safe_node_count,
            "rationale": " ".join(rationale.split())[:1200],
            "skipExisting": bool(skip_existing),
            "concurrency": safe_concurrency,
            "voice": voice_norm,
            "model": model_norm,
            "speed": safe_speed,
        },
    }


@tool
def request_generate_shot_video_batch(
    storyboard_id: str,
    branch_id: str,
    node_count: int,
    rationale: str,
    skip_existing: bool = True,
    concurrency: int = 2,
    video_model_id: str = "ltx-2.3",
) -> Dict[str, Any]:
    """Requests human approval to run the Generate-All-Videos batch. Interrupt target.

    Triggers the per-shot image-to-video batch (LTX-2.3 I2V with each shot's
    already-generated image as keyframe 0). Shots without an active image are
    skipped by the pipeline — the producer should run the image batch first.

    ``concurrency`` is capped in [1, 4] because LTX-2.3 takes 60-180s per shot
    and higher worker counts race the 30-min stale-mediaAsset sweeper.

    ``video_model_id`` accepts ``ltx-2.3`` (default, I2V + keyframe + retake),
    ``ltx-2`` (legacy), or ``veo-3.1``.
    """
    safe_concurrency = max(
        1,
        min(4, int(concurrency) if isinstance(concurrency, (int, float)) else 2),
    )
    safe_node_count = max(0, int(node_count) if isinstance(node_count, (int, float)) else 0)
    model_norm = (video_model_id or "").strip() or "ltx-2.3"
    return {
        "schemaVersion": "v2",
        "action": "request_generate_shot_video_batch",
        "status": "waiting_for_human",
        "input": {
            "storyboardId": storyboard_id,
            "branchId": branch_id,
            "nodeCount": safe_node_count,
            "rationale": " ".join(rationale.split())[:1200],
            "skipExisting": bool(skip_existing),
            "concurrency": safe_concurrency,
            "videoModelId": model_norm,
        },
    }


@tool
def repair_plan(
    storyboard_id: str,
    branch_id: str,
    violations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Builds a deterministic repair plan for continuity/simulation failures."""
    repair_ops: List[Dict[str, Any]] = []
    for index, violation in enumerate(violations):
        code = _safe_str(_as_dict(violation).get("code"), "UNKNOWN")
        repair_ops.append(
            {
                "opId": f"repair_{index + 1}",
                "title": f"Repair {code}",
                "rationale": "Auto-generated by Repair Agent",
                "op": "update_node",
                "payload": {"repairCode": code},
                "requiresHitl": True,
            }
        )
    return {
        "storyboardId": storyboard_id,
        "branchId": branch_id,
        "repairPlanId": f"repairplan_{_json_hash({'violations': violations})}",
        "operations": repair_ops,
        "confidence": 0.72 if len(repair_ops) > 0 else 0.0,
    }


@tool
def build_autonomous_dailies_batch(
    storyboard_id: str,
    branch_id: str,
    source_reel_id: str,
    title: str,
    summary: str,
    target_node_ids: List[str],
    continuity_risks: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Builds an autonomous dailies execution plan from reel metadata and risks."""
    operations: List[Dict[str, Any]] = []
    for index, node_id in enumerate(target_node_ids[:8]):
        op_name: Literal["generate_image", "generate_video"] = (
            "generate_video" if index % 2 == 1 else "generate_image"
        )
        operations.append(
            {
                "opId": f"daily_gen_{index + 1}",
                "op": op_name,
                "title": f"Autonomous dailies render for {node_id}",
                "rationale": "Coverage expansion for daily candidate reel.",
                "nodeId": node_id,
                "requiresHitl": True,
                "payload": {
                    "prompt": f"{summary} Preserve identity lock and narrative continuity.",
                    "negativePrompt": "identity drift, continuity mismatch",
                },
            }
        )

    for index, risk in enumerate(continuity_risks[:4]):
        risk_obj = _as_dict(risk)
        risk_code = _safe_str(risk_obj.get("code"), f"RISK_{index + 1}")
        node_ids = risk_obj.get("nodeIds")
        primary_node_id = (
            node_ids[0]
            if isinstance(node_ids, list) and len(node_ids) > 0 and isinstance(node_ids[0], str)
            else ""
        )
        if not primary_node_id:
            continue
        operations.append(
            {
                "opId": f"daily_fix_{index + 1}",
                "op": "update_node",
                "title": f"Continuity repair {risk_code}",
                "rationale": _safe_str(risk_obj.get("message"), "Continuity warning remediation."),
                "nodeId": primary_node_id,
                "requiresHitl": True,
                "payload": {
                    "suggestedFix": _safe_str(risk_obj.get("suggestedFix"), ""),
                },
            }
        )

    plan_payload = {
        "storyboardId": storyboard_id,
        "branchId": branch_id,
        "source": "dailies",
        "sourceId": source_reel_id,
        "title": title,
        "rationale": "Autonomous dailies batch plan requiring producer confirmation.",
        "operations": operations,
    }
    plan_id = f"dailyplan_{_json_hash(plan_payload)}"
    return {
        "reelId": source_reel_id,
        "executionPlan": {
            "planId": plan_id,
            "storyboardId": storyboard_id,
            "branchId": branch_id,
            "title": title,
            "rationale": "Autonomous dailies batch plan requiring producer confirmation.",
            "source": "dailies",
            "sourceId": source_reel_id,
            "taskType": "dailies_batch",
            "operations": operations,
            "dryRun": {
                "valid": True,
                "riskLevel": "medium" if len(continuity_risks) > 0 else "low",
                "summary": summary,
                "issues": continuity_risks,
                "estimatedTotalCost": round(max(len(operations), 1) * 0.22, 2),
                "estimatedDurationSec": round(max(len(operations), 1) * 2.1, 2),
                "planHash": _json_hash({"planId": plan_id, "operations": operations}),
            },
        },
    }


@tool
def simulate_story_playthrough(
    storyboard_id: str,
    branch_id: str,
    timeline_events: List[str],
    node_count: int,
    edge_count: int,
    branch_edge_count: int,
    merge_edge_count: int,
) -> Dict[str, Any]:
    """Runs simulation+critic heuristics and outputs repair batch candidates."""
    issues: List[Dict[str, Any]] = []
    compact_timeline = " | ".join(" ".join(event.split())[:200] for event in timeline_events[:30]).lower()

    if node_count > 0 and edge_count == 0:
        issues.append(
            {
                "code": "SIM_ORPHAN_GRAPH",
                "severity": "high",
                "message": "Storyboard graph has nodes but no edges; timeline cannot play through.",
                "nodeIds": [],
                "edgeIds": [],
                "suggestedFix": "Connect root scene to downstream beats before media generation.",
            }
        )
    if branch_edge_count > merge_edge_count + 2:
        issues.append(
            {
                "code": "SIM_BRANCH_IMBALANCE",
                "severity": "medium",
                "message": "Branch count exceeds merge count; unresolved arcs may reduce coherence.",
                "nodeIds": [],
                "edgeIds": [],
                "suggestedFix": "Insert merge or convergence beats for unresolved branches.",
            }
        )
    if "died" in compact_timeline and "alive" in compact_timeline:
        issues.append(
            {
                "code": "SIM_CAUSALITY_CONTRADICTION",
                "severity": "high",
                "message": "Timeline suggests causality contradiction between death and alive states.",
                "nodeIds": [],
                "edgeIds": [],
                "suggestedFix": "Add explicit revival or alternate-branch transition event.",
            }
        )
    if len(timeline_events) > 18:
        issues.append(
            {
                "code": "SIM_PACING_DENSITY",
                "severity": "medium",
                "message": "High event density may compress pacing and reduce emotional readability.",
                "nodeIds": [],
                "edgeIds": [],
                "suggestedFix": "Split dense sections into staged beats and add transition shots.",
            }
        )

    risk_level: Literal["low", "medium", "high", "critical"] = "low"
    if any(issue["severity"] == "high" for issue in issues):
        risk_level = "high"
    elif any(issue["severity"] == "medium" for issue in issues):
        risk_level = "medium"

    repair_operations: List[Dict[str, Any]] = []
    for index, issue in enumerate(issues[:8]):
        repair_operations.append(
            {
                "opId": f"sim_fix_{index + 1}",
                "op": "update_node",
                "title": f"Repair {issue['code']}",
                "rationale": issue["message"],
                "requiresHitl": True,
                "payload": {"suggestedFix": issue.get("suggestedFix", "")},
            }
        )

    simulation_run_id = f"simrun_{_json_hash({'events': timeline_events, 'counts': [node_count, edge_count]})}"
    confidence = 0.86 if len(issues) <= 1 else 0.74 if len(issues) <= 3 else 0.62
    impact_score = round(min(1.0, max(0.2, len(issues) * 0.18)), 2)
    summary = (
        "Simulation critic pass: no high-risk issues."
        if len(issues) == 0
        else f"Simulation critic found {len(issues)} issue(s) requiring producer review."
    )
    return {
        "simulationRunId": simulation_run_id,
        "storyboardId": storyboard_id,
        "branchId": branch_id,
        "summary": summary,
        "riskLevel": risk_level,
        "issues": issues,
        "repairOperations": repair_operations,
        "confidence": confidence,
        "impactScore": impact_score,
        "executionPlan": {
            "planId": f"simplan_{_json_hash({'run': simulation_run_id, 'ops': repair_operations})}",
            "storyboardId": storyboard_id,
            "branchId": branch_id,
            "title": "Simulation Critic Repair Batch",
            "rationale": summary,
            "source": "simulation_critic",
            "sourceId": simulation_run_id,
            "taskType": "simulation_critic_batch",
            "operations": repair_operations,
            "dryRun": {
                "valid": True,
                "riskLevel": risk_level,
                "summary": summary,
                "issues": issues,
                "estimatedTotalCost": round(max(len(repair_operations), 1) * 0.15, 2),
                "estimatedDurationSec": round(max(len(repair_operations), 1) * 1.7, 2),
                "planHash": _json_hash(repair_operations and {"ops": repair_operations} or {"ops": []}),
            },
        },
    }


@tool
def approve_graph_patch(
    patch_id: str,
    title: str,
    rationale: str,
    diff_summary: str,
    operations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Requests human approval for a graph patch. Interrupt target."""
    return {
        "schemaVersion": "v2",
        "action": "approve_graph_patch",
        "status": "waiting_for_human",
        "input": {
            "patchId": patch_id,
            "title": title,
            "rationale": rationale,
            "diffSummary": diff_summary,
            "operations": _sanitize_graph_operations(operations),
        },
    }


@tool
def approve_media_prompt(
    node_id: str,
    media_type: Literal["image", "video"],
    prompt: str,
    negative_prompt: str,
    context_summary: str,
) -> Dict[str, Any]:
    """Requests human approval for a media prompt. Interrupt target."""
    return {
        "schemaVersion": "v2",
        "action": "approve_media_prompt",
        "status": "waiting_for_human",
        "input": {
            "nodeId": node_id,
            "mediaType": media_type,
            "prompt": " ".join(prompt.split())[:2400],
            "negativePrompt": " ".join(negative_prompt.split())[:1200],
            "contextSummary": " ".join(context_summary.split())[:2400],
        },
    }


@tool
def approve_execution_plan(
    plan_id: str,
    storyboard_id: str,
    branch_id: str,
    title: str,
    rationale: str,
    operations: List[Dict[str, Any]],
    dry_run: Dict[str, Any],
) -> Dict[str, Any]:
    """Requests human approval for a multi-op execution plan. Interrupt target."""
    return {
        "schemaVersion": "v2",
        "action": "approve_execution_plan",
        "status": "waiting_for_human",
        "input": {
            "planId": plan_id,
            "storyboardId": storyboard_id,
            "branchId": branch_id,
            "title": title,
            "rationale": rationale,
            "operations": operations,
            "dryRun": dry_run,
        },
    }


@tool
def approve_batch_ops(
    plan_id: str,
    operations: List[Dict[str, Any]],
    dry_run: Dict[str, Any],
) -> Dict[str, Any]:
    """Requests human approval for a batched operation set. Interrupt target."""
    return {
        "schemaVersion": "v2",
        "action": "approve_batch_ops",
        "status": "waiting_for_human",
        "input": {
            "planId": plan_id,
            "operations": operations,
            "dryRun": dry_run,
        },
    }


@tool
def preview_simulation_critic_plan(
    simulation_run_id: str,
    storyboard_id: str,
    branch_id: str,
    summary: str,
    risk_level: Literal["low", "medium", "high", "critical"],
    issues: List[Dict[str, Any]],
    confidence: float,
    impact_score: float,
    execution_plan: Dict[str, Any],
) -> Dict[str, Any]:
    """Requests human preview of simulation critic rationale before batch approval."""
    return {
        "schemaVersion": "v2",
        "action": "preview_simulation_critic_plan",
        "status": "waiting_for_human",
        "input": {
            "simulationRunId": simulation_run_id,
            "storyboardId": storyboard_id,
            "branchId": branch_id,
            "summary": summary,
            "riskLevel": risk_level,
            "issues": issues,
            "confidence": confidence,
            "impactScore": impact_score,
            "executionPlan": execution_plan,
        },
    }


@tool
def approve_dailies_batch(
    plan_id: str,
    storyboard_id: str,
    branch_id: str,
    title: str,
    rationale: str,
    source_id: str,
    operations: List[Dict[str, Any]],
    dry_run: Dict[str, Any],
) -> Dict[str, Any]:
    """Requests human approval for autonomous dailies batch execution."""
    return {
        "schemaVersion": "v2",
        "action": "approve_dailies_batch",
        "status": "waiting_for_human",
        "input": {
            "planId": plan_id,
            "storyboardId": storyboard_id,
            "branchId": branch_id,
            "title": title,
            "rationale": rationale,
            "source": "dailies",
            "sourceId": source_id,
            "taskType": "dailies_batch",
            "operations": operations,
            "dryRun": dry_run,
        },
    }


@tool
def approve_merge_policy(
    branch_id: str,
    source_branch_id: str,
    target_branch_id: str,
    policy: str,
    semantic_diff: Dict[str, Any],
) -> Dict[str, Any]:
    """Requests human approval for merge policy. Interrupt target."""
    return {
        "schemaVersion": "v2",
        "action": "approve_merge_policy",
        "status": "waiting_for_human",
        "input": {
            "branchId": branch_id,
            "sourceBranchId": source_branch_id,
            "targetBranchId": target_branch_id,
            "policy": policy,
            "semanticDiff": semantic_diff,
        },
    }


@tool
def approve_repair_plan(
    repair_plan_id: str,
    operations: List[Dict[str, Any]],
    confidence: float,
) -> Dict[str, Any]:
    """Requests human approval for auto-repair operations. Interrupt target."""
    return {
        "schemaVersion": "v2",
        "action": "approve_repair_plan",
        "status": "waiting_for_human",
        "input": {
            "repairPlanId": repair_plan_id,
            "operations": operations,
            "confidence": confidence,
        },
    }


@tool
def select_agent_team(
    team_id: str,
    revision_id: str = "",
) -> Dict[str, Any]:
    """Requests human confirmation to switch the active agent team."""
    payload: Dict[str, Any] = {"teamId": team_id}
    if revision_id:
        payload["revisionId"] = revision_id
    return {
        "schemaVersion": "v2",
        "action": "select_agent_team",
        "status": "waiting_for_human",
        "input": payload,
    }


@tool
def create_agent_team(
    name: str,
    description: str,
    team_goal: str,
) -> Dict[str, Any]:
    """Requests human confirmation to create a new custom agent team."""
    return {
        "schemaVersion": "v2",
        "action": "create_agent_team",
        "status": "waiting_for_human",
        "input": {
            "name": name,
            "description": description,
            "teamGoal": team_goal,
        },
    }


@tool
def update_agent_team_member(
    team_id: str,
    revision_id: str,
    member: Dict[str, Any],
) -> Dict[str, Any]:
    """Requests human confirmation to update member persona/scope."""
    return {
        "schemaVersion": "v2",
        "action": "update_agent_team_member",
        "status": "waiting_for_human",
        "input": {
            "teamId": team_id,
            "revisionId": revision_id,
            "member": member,
        },
    }


@tool
def publish_agent_team_revision(
    team_id: str,
    revision_id: str,
) -> Dict[str, Any]:
    """Requests human confirmation to publish a team revision."""
    return {
        "schemaVersion": "v2",
        "action": "publish_agent_team_revision",
        "status": "waiting_for_human",
        "input": {
            "teamId": team_id,
            "revisionId": revision_id,
        },
    }


@tool
def generate_team_from_prompt(
    input_prompt: str,
    team_id: str = "",
    publish: bool = False,
) -> Dict[str, Any]:
    """Requests human confirmation for prompt-to-team draft generation."""
    payload: Dict[str, Any] = {
        "inputPrompt": input_prompt,
        "publish": publish,
    }
    if team_id:
        payload["teamId"] = team_id
    return {
        "schemaVersion": "v2",
        "action": "generate_team_from_prompt",
        "status": "waiting_for_human",
        "input": payload,
    }


ALL_TOOLS = [
    planner_propose_graph_patch,
    planner_propose_media_prompt,
    simulate_execution_plan,
    build_autonomous_dailies_batch,
    simulate_story_playthrough,
    continuity_critic,
    producer_guard,
    recommend_ingestion_path,
    repair_plan,
    approve_graph_patch,
    approve_media_prompt,
    approve_execution_plan,
    approve_batch_ops,
    preview_simulation_critic_plan,
    approve_dailies_batch,
    approve_merge_policy,
    approve_repair_plan,
    request_ingestion_run,
    request_generate_shot_batch,
    request_generate_shot_video_batch,
    request_generate_shot_audio_batch,
    request_export_reel,
    select_agent_team,
    create_agent_team,
    update_agent_team_member,
    publish_agent_team_revision,
    generate_team_from_prompt,
]

# Supervisor-only core: the minimum tools the top-level orchestrator needs to
# call directly. Every other tool is specialized work that belongs inside a
# subagent and must be reached via `task` delegation. Narrowing the supervisor
# here is the "allowlist at init" defense — even if the runtime allowlist is
# misconfigured, the supervisor cannot directly invoke mutation-adjacent tools
# (graph_patch / media_prompt / team_* / etc.) because they are never added to
# its tool set in the first place.
#
# `select_agent_team` stays on the supervisor because team switching is an
# orchestration-level authority, not specialized work. All other team.manage
# tools (create/update/publish/generate_from_prompt) are gated behind the
# `team_architect` subagent.
SUPERVISOR_CORE_TOOLS = [
    producer_guard,
    continuity_critic,
    recommend_ingestion_path,
    approve_graph_patch,
    approve_media_prompt,
    approve_execution_plan,
    approve_batch_ops,
    preview_simulation_critic_plan,
    approve_dailies_batch,
    approve_merge_policy,
    approve_repair_plan,
    request_ingestion_run,
    request_generate_shot_batch,
    request_generate_shot_video_batch,
    request_generate_shot_audio_batch,
    request_export_reel,
    select_agent_team,
]

# Safe default scope applied when the runtime `effective_tool_scope` is unset
# or empty. Previously an empty allowlist was interpreted as "allow
# everything", which collapsed the policy posture. The default explicitly
# excludes `team.manage` so team mutations always require an explicit opt-in
# (caller passes a list containing "team.manage" or "*"). Every other
# capability is enabled by default so existing storyboards keep working.
DEFAULT_RUNTIME_ALLOWLIST: List[str] = [
    "graph.patch",
    "media.prompt",
    "execution.plan",
    "simulation.critic",
    "continuity.check",
    "dailies.batch",
    "execution.guard",
    "repair.plan",
    "branch.merge",
    "ingestion.run",
    "shot_batch.run",
    "shot_video_batch.run",
    "shot_audio_batch.run",
    "reel_export.run",
]

TOOL_POLICY_TOKENS: Dict[str, str] = {
    planner_propose_graph_patch.name: "graph.patch",
    planner_propose_media_prompt.name: "media.prompt",
    simulate_execution_plan.name: "execution.plan",
    build_autonomous_dailies_batch.name: "dailies.batch",
    simulate_story_playthrough.name: "simulation.critic",
    continuity_critic.name: "continuity.check",
    producer_guard.name: "execution.guard",
    repair_plan.name: "repair.plan",
    approve_graph_patch.name: "graph.patch",
    approve_media_prompt.name: "media.prompt",
    approve_execution_plan.name: "execution.plan",
    approve_batch_ops.name: "execution.plan",
    preview_simulation_critic_plan.name: "simulation.critic",
    approve_dailies_batch.name: "dailies.batch",
    approve_merge_policy.name: "branch.merge",
    approve_repair_plan.name: "repair.plan",
    recommend_ingestion_path.name: "ingestion.run",
    request_ingestion_run.name: "ingestion.run",
    request_generate_shot_batch.name: "shot_batch.run",
    request_generate_shot_video_batch.name: "shot_video_batch.run",
    request_generate_shot_audio_batch.name: "shot_audio_batch.run",
    request_export_reel.name: "reel_export.run",
    select_agent_team.name: "team.manage",
    create_agent_team.name: "team.manage",
    update_agent_team_member.name: "team.manage",
    publish_agent_team_revision.name: "team.manage",
    generate_team_from_prompt.name: "team.manage",
}


def is_tool_allowed(allowlist: List[str], token: str) -> bool:
    """Checks whether ``token`` is permitted by the runtime allowlist.

    Semantics:
      * Empty allowlist → apply ``DEFAULT_RUNTIME_ALLOWLIST`` (deny-by-default
        for tokens not in the default, notably ``team.manage``).
      * ``["*"]`` → allow everything (explicit open-scope, e.g. local dev).
      * Otherwise → token must appear in the allowlist verbatim. The legacy
        prefix expansion for ``media.`` still applies so a caller passing only
        ``media.prompt`` also grants sibling ``media.*`` tokens.
    """
    effective = allowlist if len(allowlist) > 0 else DEFAULT_RUNTIME_ALLOWLIST
    if "*" in effective:
        return True
    if token in effective:
        return True
    if token.startswith("media.") and "media.prompt" in effective:
        return True
    return False


def filter_tools_by_allowlist(tools: List[Any], allowlist: List[str]) -> List[Any]:
    allowed: List[Any] = []
    for tool in tools:
        tool_name = str(getattr(tool, "name", ""))
        token = TOOL_POLICY_TOKENS.get(tool_name)
        if token is None:
            # Tools without a policy token can't be governed — drop them so
            # nothing un-audited slips into an init-time allowlist.
            continue
        if is_tool_allowed(allowlist, token):
            allowed.append(tool)
    return allowed

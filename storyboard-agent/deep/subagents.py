"""
Subagent catalog for V2 storyboard deep-agent orchestration.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from .tools import (
    ALL_TOOLS,
    build_autonomous_dailies_batch,
    continuity_critic,
    create_agent_team,
    filter_tools_by_allowlist,
    generate_team_from_prompt,
    planner_propose_graph_patch,
    planner_propose_media_prompt,
    preview_simulation_critic_plan,
    publish_agent_team_revision,
    producer_guard,
    repair_plan,
    select_agent_team,
    simulate_story_playthrough,
    simulate_execution_plan,
    update_agent_team_member,
)


def get_subagents(
    enabled_member_names: Optional[Set[str]] = None,
    tool_allowlist: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    member_filter = (
        {name.strip().lower() for name in enabled_member_names if name.strip()}
        if enabled_member_names
        else None
    )
    allowlist = tool_allowlist or []

    definitions: List[Dict[str, Any]] = [
        {
            "name": "planner",
            "description": "Produces storyboard graph/media execution plans as deterministic operation sets.",
            "system_prompt": (
                "You are the Planner agent. Produce concise, typed operation sets only. "
                "Use planner tools to emit operations and never mutate state directly."
            ),
            "tools": [
                planner_propose_graph_patch,
                planner_propose_media_prompt,
                simulate_execution_plan,
                generate_team_from_prompt,
            ],
        },
        {
            "name": "continuity_critic",
            "description": "Finds character and narrative continuity risks before apply.",
            "system_prompt": (
                "You are the Continuity Critic. Detect contradictions and identify risky changes. "
                "Return structured violations with severity."
            ),
            "tools": [continuity_critic],
        },
        {
            "name": "simulation_critic",
            "description": "Runs timeline playthrough simulation and emits repair batch candidates.",
            "system_prompt": (
                "You are the Simulation Critic. Evaluate pacing, causality, and arc coherence. "
                "Return deterministic issue objects and repair operations only. "
                "Always invoke preview_simulation_critic_plan before requesting approve_batch_ops."
            ),
            "tools": [simulate_story_playthrough, repair_plan, preview_simulation_critic_plan],
        },
        {
            "name": "dailies_producer",
            "description": "Builds autonomous dailies candidate reels and batch execution proposals.",
            "system_prompt": (
                "You are the Dailies Producer. Build candidate reels and propose batch operations "
                "for missing media coverage and continuity stabilization."
            ),
            "tools": [build_autonomous_dailies_batch, producer_guard],
        },
        {
            "name": "visual_director",
            "description": "Refines visual generation intent while preserving identity lock constraints.",
            "system_prompt": (
                "You are the Visual Director. Improve prompt quality and cinematic intent while preserving "
                "character identity constraints and rolling narrative continuity."
            ),
            "tools": [planner_propose_media_prompt],
        },
        {
            "name": "producer_guard",
            "description": "Scores risk and chooses approval granularity for safe execution.",
            "system_prompt": (
                "You are the Producer Guard. Enforce human approval policy and choose safe batching mode "
                "based on risk and operation count."
            ),
            "tools": [producer_guard],
        },
        {
            "name": "team_architect",
            "description": "Builds and tunes custom subagent team definitions for producer intent.",
            "system_prompt": (
                "You are the Team Architect. Convert producer intent into team compositions, "
                "member personas, and publish flows with explicit confirmation."
            ),
            "tools": [
                select_agent_team,
                create_agent_team,
                update_agent_team_member,
                publish_agent_team_revision,
                generate_team_from_prompt,
            ],
        },
        {
            "name": "repair_agent",
            "description": "Proposes constrained repair operations for failed continuity/simulation outcomes.",
            "system_prompt": (
                "You are the Repair Agent. Generate minimal-impact repair plans from violations. "
                "Prefer targeted updates over broad rewrites."
            ),
            "tools": [repair_plan],
        },
    ]

    filtered: List[Dict[str, Any]] = []
    for definition in definitions:
        agent_name = str(definition.get("name", "")).strip().lower()
        if member_filter is not None and agent_name not in member_filter:
            continue
        tools = definition.get("tools", [])
        if not isinstance(tools, list):
            continue
        allowed_tools = filter_tools_by_allowlist(tools, allowlist)
        if len(allowed_tools) == 0:
            continue
        filtered.append(
            {
                **definition,
                "tools": allowed_tools,
            }
        )

    if len(filtered) > 0:
        return filtered

    # Fallback keeps orchestration alive in strict policies while preventing mutation tools.
    fallback_tools = filter_tools_by_allowlist(ALL_TOOLS, allowlist)
    if len(fallback_tools) == 0:
        fallback_tools = [producer_guard]
    return [
        {
            "name": "producer_guard",
            "description": "Fallback guard agent under strict policy constraints.",
            "system_prompt": (
                "No permitted subagent tools are available for this team revision. "
                "Respond with explicit blockedReason and policy evidence."
            ),
            "tools": fallback_tools[:1],
        }
    ]

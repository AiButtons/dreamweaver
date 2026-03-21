"""
Factory for V2 deep-agent graph creation.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional, Set, List

from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore

from deepagents import create_deep_agent

from .subagents import get_subagents
from .tools import (
    ALL_TOOLS,
    approve_batch_ops,
    approve_dailies_batch,
    approve_execution_plan,
    approve_graph_patch,
    approve_media_prompt,
    approve_merge_policy,
    approve_repair_plan,
    create_agent_team,
    generate_team_from_prompt,
    preview_simulation_critic_plan,
    publish_agent_team_revision,
    select_agent_team,
    filter_tools_by_allowlist,
    update_agent_team_member,
)


def _build_backend() -> Optional[Any]:
    """
    Builds long-term memory backend composition.
    Falls back safely when backend classes are unavailable in runtime env.
    """
    try:
        from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
    except Exception:
        return None

    return CompositeBackend(
        [
            # Workspace-shared, opt-in memory store for reusable identity packs.
            StateBackend(path=("/identity",), prefix="identity"),
            StoreBackend(path=("/memories",), prefix="workspace"),
        ]
    )


def _interrupt_config() -> Dict[str, Dict[str, Any]]:
    return {
        approve_graph_patch.name: {"allowed_decisions": ["approve", "edit", "reject"]},
        approve_media_prompt.name: {"allowed_decisions": ["approve", "edit", "reject"]},
        approve_execution_plan.name: {"allowed_decisions": ["approve", "edit", "reject"]},
        approve_batch_ops.name: {"allowed_decisions": ["approve", "edit", "reject"]},
        preview_simulation_critic_plan.name: {"allowed_decisions": ["approve", "reject"]},
        approve_dailies_batch.name: {"allowed_decisions": ["approve", "edit", "reject"]},
        approve_merge_policy.name: {"allowed_decisions": ["approve", "reject"]},
        approve_repair_plan.name: {"allowed_decisions": ["approve", "edit", "reject"]},
        select_agent_team.name: {"allowed_decisions": ["approve", "reject"]},
        create_agent_team.name: {"allowed_decisions": ["approve", "edit", "reject"]},
        update_agent_team_member.name: {"allowed_decisions": ["approve", "edit", "reject"]},
        publish_agent_team_revision.name: {"allowed_decisions": ["approve", "reject"]},
        generate_team_from_prompt.name: {"allowed_decisions": ["approve", "edit", "reject"]},
    }


def create_storyboard_deep_agent_graph(
    enabled_member_names: Optional[Set[str]] = None,
    tool_allowlist: Optional[List[str]] = None,
):
    model_name = os.getenv("STORYBOARD_AGENT_MODEL", "openai:gpt-4.1-mini")
    backend = _build_backend()
    checkpointer = MemorySaver()
    store = InMemoryStore()
    allowlist = tool_allowlist or []
    filtered_tools = filter_tools_by_allowlist(ALL_TOOLS, allowlist)
    if len(filtered_tools) == 0:
        filtered_tools = ALL_TOOLS

    kwargs: Dict[str, Any] = {
        "model": model_name,
        "tools": filtered_tools,
        "subagents": get_subagents(
            enabled_member_names=enabled_member_names,
            tool_allowlist=allowlist,
        ),
        "checkpointer": checkpointer,
        "store": store,
        "interrupt_on": _interrupt_config(),
        "middleware": [],
        "system_prompt": (
            "You are Storyboard Supervisor V2. Use write_todos to decompose tasks, delegate specialized work "
            "with task to subagents, and never apply mutations without approval tools. "
            "For autonomous dailies, prefer building batch plans with explicit sourceId and taskType. "
            "For simulation critic loops, emit repair batches with deterministic risk metadata. "
            "If team_config/runtime_policy/effective_tool_scope are present in state, treat them as hard constraints "
            "for planning and include policy trace evidence in outputs. "
            "Always produce deterministic machine-readable outputs."
        ),
    }
    if backend is not None:
        kwargs["backend"] = backend

    return create_deep_agent(**kwargs)

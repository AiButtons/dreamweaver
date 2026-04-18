"""
Factory for V2 deep-agent graph creation.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Dict, Optional, Set, List

from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore


_logger = logging.getLogger(__name__)

# Checkpointer is a process-wide singleton so the connection pool is reused
# across graph invocations instead of being rebuilt per thread.
_checkpointer_lock = threading.Lock()
_checkpointer_singleton: Optional[Any] = None

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


def _build_checkpointer() -> Any:
    """
    Resolves the checkpointer used by the storyboard deep-agent.

    When ``STORYBOARD_CHECKPOINT_POSTGRES_URI`` is set, a ``PostgresSaver`` is
    created over a ``psycopg_pool.ConnectionPool`` and tables are set up on
    first use. In-flight approval workflows survive process restarts.

    When the env var is unset, the driver is missing, or connection setup
    fails, we fall back to ``MemorySaver`` and emit a warning — in-flight
    approvals are ephemeral in that case.

    Env:
      STORYBOARD_CHECKPOINT_POSTGRES_URI     (required to enable persistence)
      STORYBOARD_CHECKPOINT_POSTGRES_MAX_CONN (optional, default 10)
    """
    uri = os.getenv("STORYBOARD_CHECKPOINT_POSTGRES_URI", "").strip()
    if not uri:
        _logger.info(
            "STORYBOARD_CHECKPOINT_POSTGRES_URI not set; using MemorySaver. "
            "In-flight approval workflows will be lost on process restart."
        )
        return MemorySaver()

    try:
        from langgraph.checkpoint.postgres import PostgresSaver
        from psycopg_pool import ConnectionPool
    except ImportError as exc:
        _logger.warning(
            "PostgresSaver/psycopg_pool not importable (%s); falling back to "
            "MemorySaver. In-flight approvals will not persist.",
            exc,
        )
        return MemorySaver()

    try:
        max_conn_env = os.getenv("STORYBOARD_CHECKPOINT_POSTGRES_MAX_CONN", "10")
        try:
            max_conn = max(1, int(max_conn_env))
        except ValueError:
            max_conn = 10

        pool = ConnectionPool(
            conninfo=uri,
            max_size=max_conn,
            # 10s cap on waiting for an available connection — prevents a
            # misconfigured URI from hanging graph startup for the psycopg
            # default (30s).
            timeout=10,
            kwargs={
                "autocommit": True,
                "prepare_threshold": 0,
                # Short libpq-level connect timeout so DNS/auth failures don't
                # chew through the pool timeout on every attempt.
                "connect_timeout": 5,
            },
            open=True,
        )
        saver = PostgresSaver(pool)
        saver.setup()
        _logger.info(
            "PostgresSaver checkpointer initialized (pool max_size=%d).", max_conn
        )
        return saver
    except Exception as exc:  # psycopg connection/auth/DNS/etc.
        _logger.exception(
            "PostgresSaver initialization failed (%s); falling back to "
            "MemorySaver. In-flight approvals will not persist.",
            exc,
        )
        return MemorySaver()


def _resolve_checkpointer() -> Any:
    """Returns the process-wide checkpointer singleton."""
    global _checkpointer_singleton
    if _checkpointer_singleton is not None:
        return _checkpointer_singleton
    with _checkpointer_lock:
        if _checkpointer_singleton is None:
            _checkpointer_singleton = _build_checkpointer()
    return _checkpointer_singleton


def _build_backend() -> Optional[Any]:
    """
    Previously composed a ``CompositeBackend`` of a ``StateBackend`` for identity
    packs and a ``StoreBackend`` for workspace memories. The constructors were
    written against an older ``deepagents`` API — the installed version
    (``deepagents==0.4.1``) requires a ``ToolRuntime`` at instantiation and
    ``CompositeBackend`` now takes ``(default, routes: dict)``, so the old call
    shape raises ``TypeError`` and the graph can't even be built from the CLI.

    Returning ``None`` lets ``create_deep_agent`` fall back to its default
    backend, which is the behavior the live langgraph-dev server is already
    relying on (``agent.py`` imports cleanly because it doesn't exercise this
    path). If identity/workspace routing is needed again, re-introduce a
    factory ``(runtime) -> BackendProtocol`` and pass it as ``backend=``.
    """
    return None


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
    checkpointer = _resolve_checkpointer()
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

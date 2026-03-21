# Storyboard Agent

Dedicated LangGraph/DeepAgents service for Dreamweaver storyboard orchestration.

## Graph

- Graph id: `storyboard_agent`
- Runtime modes:
  1. `v2_deep` (default): DeepAgents supervisor + subagents + HITL interrupts
  2. `v1_linear`: Legacy deterministic linear graph
  3. `shadow_compare`: V2 primary + V1 diagnostics comparison

Set with:
`STORYBOARD_AGENT_MODE=v2_deep|v1_linear|shadow_compare`

## V2 DeepAgents primitives

- Supervisor scaffolding via `create_deep_agent`
- Subagents:
  - planner
  - continuity_critic
  - simulation_critic
  - dailies_producer
  - visual_director
  - producer_guard
  - repair_agent
- Delegation via DeepAgents `task`
- Planning via DeepAgents `write_todos`
- HITL via `interrupt_on` + checkpointer + thread continuity
- Long-term memory backend composition (`CompositeBackend` with state/store backends when available)

## Local run

1. Create env and install:
   - `uv sync` (or `pip install -e .`)
2. Start custom routes:
   - `uvicorn server:app --reload --port 8123`
3. Run LangGraph server using `langgraph.json` in your deployment workflow.

## Contract notes

- Outputs are deterministic machine objects.
- Mutation tools remain guarded behind explicit approval actions.
- V2 keeps compatibility with V1 approval action names while adding:
  - `preview_simulation_critic_plan`
  - `approve_execution_plan`
  - `approve_batch_ops`
  - `approve_dailies_batch`
  - `approve_merge_policy`
  - `approve_repair_plan`
  - `select_agent_team`
  - `create_agent_team`
  - `update_agent_team_member`
  - `publish_agent_team_revision`
  - `generate_team_from_prompt`

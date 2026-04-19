"""Pure tests for the EpisodeSplitter agent. Covers the Pydantic schema
contract and the wiring — no LLM calls. Live behavior is validated via
integration_live.py's Novel2Video flow (when added in Phase 2)."""

from __future__ import annotations

import pytest

from viMax_port.episode_splitter import (
    EpisodeSplitter,
    EpisodeSpec,
    SplitEpisodesResponse,
)


def test_episode_spec_requires_fields():
    ep = EpisodeSpec(
        index=0,
        title="The Fever",
        summary="Maya discovers Oliver has a fever and stays home from work.",
        key_beats=[
            "Maya flips pancakes.",
            "Oliver appears in the doorway clutching a stuffed dinosaur.",
        ],
    )
    assert ep.index == 0
    assert ep.title == "The Fever"
    assert len(ep.key_beats) == 2


def test_split_episodes_response_is_list():
    parsed = SplitEpisodesResponse(
        episodes=[
            EpisodeSpec(index=0, title="a", summary="...", key_beats=["beat 1"]),
            EpisodeSpec(index=1, title="b", summary="...", key_beats=["beat 2"]),
        ],
    )
    assert len(parsed.episodes) == 2
    assert parsed.episodes[0].index == 0
    assert parsed.episodes[1].index == 1


class _StubChatModel:
    def __init__(self, response_episodes: list[EpisodeSpec]) -> None:
        self._response = SplitEpisodesResponse(episodes=response_episodes)
        self.calls: list[dict] = []

    def with_structured_output(self, _schema, method=None, strict=None):
        # Return self so ainvoke is what runs.
        self._method = method
        self._strict = strict
        return self

    async def ainvoke(self, messages):
        self.calls.append({"messages": messages})
        return self._response


@pytest.mark.asyncio
async def test_split_into_episodes_forwards_narrative_and_count():
    stub = _StubChatModel(
        response_episodes=[
            EpisodeSpec(index=0, title="One", summary="first episode", key_beats=["b1"]),
            EpisodeSpec(index=1, title="Two", summary="second episode", key_beats=["b2"]),
        ],
    )
    splitter = EpisodeSplitter(chat_model=stub)
    result = await splitter.split_into_episodes(
        narrative="Alice walks into a room. She sees Bob.",
        target_episode_count=2,
    )
    assert len(result) == 2
    assert result[0].title == "One"
    assert stub._method == "json_schema"
    assert stub._strict is True

    # Verify the narrative + target count made it into the human message.
    human_msg = stub.calls[0]["messages"][1][1]
    assert "Alice walks into a room" in human_msg
    assert "2" in human_msg  # target count


@pytest.mark.asyncio
async def test_split_into_episodes_renumbers_indices():
    """Model might return out-of-order indices — we re-number defensively."""
    stub = _StubChatModel(
        response_episodes=[
            EpisodeSpec(index=5, title="A", summary="...", key_beats=["b"]),
            EpisodeSpec(index=99, title="B", summary="...", key_beats=["b"]),
            EpisodeSpec(index=0, title="C", summary="...", key_beats=["b"]),
        ],
    )
    splitter = EpisodeSplitter(chat_model=stub)
    result = await splitter.split_into_episodes(narrative="...")
    assert [ep.index for ep in result] == [0, 1, 2]


@pytest.mark.asyncio
async def test_split_into_episodes_auto_count_when_not_specified():
    stub = _StubChatModel(
        response_episodes=[
            EpisodeSpec(index=0, title="solo", summary="...", key_beats=["b"]),
        ],
    )
    splitter = EpisodeSplitter(chat_model=stub)
    result = await splitter.split_into_episodes(narrative="A short story.")
    assert len(result) == 1
    human_msg = stub.calls[0]["messages"][1][1]
    assert "auto" in human_msg

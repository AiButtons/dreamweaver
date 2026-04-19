"""Pure tests for NovelCompressor. Covers the split (deterministic) + the
wire contract on compress/aggregate (with a stub chat model). No real LLM
calls — the live flow is exercised by tests/integration_live.py."""

from __future__ import annotations

import pytest

from viMax_port.novel_compressor import NovelCompressor


class _StubMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _StubChatModel:
    """Minimal async chat-model stand-in. Returns canned responses keyed by
    the system-prompt signature so the compress + aggregate paths can be
    asserted independently."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def ainvoke(self, messages):
        system = messages[0].content if messages else ""
        human = messages[1].content if len(messages) > 1 else ""
        self.calls.append({"system": system, "human": human})
        if "compression assistant" in system:
            return _StubMessage(content=f"[compressed: {len(human)} chars]")
        if "aggregation and refinement" in system:
            return _StubMessage(content="[aggregated narrative]")
        return _StubMessage(content="unknown")


def test_split_short_text_returns_single_chunk():
    compressor = NovelCompressor(chat_model=_StubChatModel(), chunk_size=200, chunk_overlap=20)
    chunks = compressor.split("Alice walks into a dimly lit room.")
    assert len(chunks) == 1
    assert "Alice" in chunks[0]


def test_split_long_text_returns_multiple_overlapping_chunks():
    compressor = NovelCompressor(chat_model=_StubChatModel(), chunk_size=200, chunk_overlap=40)
    long_text = "Alice walks. " * 200  # ~2600 chars
    chunks = compressor.split(long_text)
    assert len(chunks) >= 2, f"expected multiple chunks, got {len(chunks)}"
    # Each chunk is under (chunk_size + a bit of slop for splitter heuristics).
    for chunk in chunks:
        assert len(chunk) <= 300


@pytest.mark.asyncio
async def test_compress_parallel_runs_per_chunk():
    stub = _StubChatModel()
    compressor = NovelCompressor(chat_model=stub, chunk_size=100, chunk_overlap=10)
    chunks = ["chunk a", "chunk b", "chunk c"]
    compressed = await compressor.compress(chunks, max_concurrent_tasks=2)
    assert len(compressed) == 3
    assert all(c.startswith("[compressed:") for c in compressed)
    # Three compressed calls fired.
    assert len(stub.calls) == 3
    for call in stub.calls:
        assert "compression assistant" in call["system"]


@pytest.mark.asyncio
async def test_aggregate_single_chunk_short_circuits():
    stub = _StubChatModel()
    compressor = NovelCompressor(chat_model=stub, chunk_size=100, chunk_overlap=10)
    result = await compressor.aggregate(["just one"])
    assert result == "just one"
    # No LLM call should have fired.
    assert len(stub.calls) == 0


@pytest.mark.asyncio
async def test_aggregate_empty_returns_empty_string():
    stub = _StubChatModel()
    compressor = NovelCompressor(chat_model=stub, chunk_size=100, chunk_overlap=10)
    result = await compressor.aggregate([])
    assert result == ""
    assert len(stub.calls) == 0


@pytest.mark.asyncio
async def test_aggregate_multiple_chunks_formats_with_indexed_tags():
    stub = _StubChatModel()
    compressor = NovelCompressor(chat_model=stub, chunk_size=100, chunk_overlap=10)
    result = await compressor.aggregate(["first", "second", "third"])
    assert result == "[aggregated narrative]"
    assert len(stub.calls) == 1
    prompt = stub.calls[0]["human"]
    assert "<CHUNK_0_START>" in prompt
    assert "first" in prompt
    assert "<CHUNK_0_END>" in prompt
    assert "<CHUNK_1_START>" in prompt
    assert "<CHUNK_2_START>" in prompt

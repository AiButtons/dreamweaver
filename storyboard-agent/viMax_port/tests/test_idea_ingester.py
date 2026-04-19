"""Pure unit tests for the Idea2Video helpers. No LLM calls.

The `ingest_idea` coordinator itself is covered end-to-end by
`tests/integration_live.py`; this file exercises the parts that don't need
the model (scene-join formatting + Screenwriter class wiring)."""

from __future__ import annotations

import pytest

from viMax_port.idea_ingester import _join_scenes
from viMax_port.screenwriter import (
    Screenwriter,
    WriteScriptBasedOnStoryResponse,
)


def test_join_scenes_single():
    joined = _join_scenes(["INT. ROOM - DAY\n\nAlice sits."])
    assert joined == "INT. ROOM - DAY\n\nAlice sits."


def test_join_scenes_multiple_adds_cut_to_between():
    scenes = [
        "INT. A - DAY\n\nFirst scene.",
        "EXT. B - NIGHT\n\nSecond scene.",
        "INT. C - DAY\n\nThird scene.",
    ]
    joined = _join_scenes(scenes)
    # Every scene's body is present.
    for scene in scenes:
        assert scene in joined
    # Transitions between scenes — should appear twice (between 3 scenes).
    assert joined.count("CUT TO:") == 2


def test_join_scenes_strips_empty_entries():
    joined = _join_scenes(["  ", "INT. A - DAY\nAction.", "\n"])
    assert "Action." in joined
    assert "CUT TO:" not in joined  # no second non-empty scene


def test_join_scenes_empty_input():
    assert _join_scenes([]) == ""


def test_screenwriter_accepts_chat_model():
    # Construct with a dummy object — ensures the class contract stays
    # compatible with `make_chat_model()` output from llm_factory.
    class _StubChatModel:
        def with_structured_output(self, *_args, **_kwargs):
            return self

        async def ainvoke(self, _messages):
            return None

    writer = Screenwriter(chat_model=_StubChatModel())
    assert writer.chat_model is not None


def test_response_schema_shape():
    # Ensure the WriteScriptBasedOnStoryResponse schema still requires
    # `script: List[str]` — guards against accidental field renames.
    payload = WriteScriptBasedOnStoryResponse(script=["scene one", "scene two"])
    assert payload.script == ["scene one", "scene two"]
    with pytest.raises(Exception):
        WriteScriptBasedOnStoryResponse(script="not a list")  # type: ignore[arg-type]

"""Factory for the shared Gemini chat model used by the ViMax port."""

from __future__ import annotations

import os
from typing import Any

from langchain.chat_models import init_chat_model


def make_chat_model(
    model: str = "gemini-2.5-flash",
    temperature: float = 0.2,
) -> Any:
    """Instantiate the Gemini chat model via langchain-google-genai.

    Requires `GEMINI_API_KEY` or `GOOGLE_API_KEY` in the environment. The
    google-genai SDK reads `GOOGLE_API_KEY`, so we propagate from
    `GEMINI_API_KEY` if only that is set.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY / GOOGLE_API_KEY not set")
    os.environ.setdefault("GOOGLE_API_KEY", api_key)
    return init_chat_model(model, model_provider="google_genai", temperature=temperature)

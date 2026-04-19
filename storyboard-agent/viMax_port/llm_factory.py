"""Factory for the shared OpenAI chat model used by the ViMax port.

Uses GPT-5.4 by default for its strong JSON-schema adherence — the ViMax
pipeline leans heavily on nested Pydantic outputs (character lists, shot
decompositions) and frontier OpenAI models with native structured-output
mode are the most reliable way to get them back without parse errors.

Model can be overridden via `VIMAX_PORT_LLM_MODEL` env var for A/B tests or
local dev against cheaper models.
"""

from __future__ import annotations

import os
from typing import Any

from langchain.chat_models import init_chat_model


DEFAULT_MODEL = "gpt-5.4"


def make_chat_model(
    model: str | None = None,
    temperature: float | None = None,
) -> Any:
    """Instantiate the OpenAI chat model via langchain-openai.

    Requires `OPENAI_API_KEY` in the environment. The langchain-openai
    provider reads this automatically.

    Args:
        model: OpenAI model id. Defaults to `$VIMAX_PORT_LLM_MODEL` if set,
            else `DEFAULT_MODEL` (gpt-5.4).
        temperature: Optional sampling temperature. Omitted by default — GPT-5.4
            picks a sensible default and some OpenAI models reject explicit
            temperature arguments.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    resolved_model = model or os.environ.get("VIMAX_PORT_LLM_MODEL") or DEFAULT_MODEL
    kwargs: dict[str, Any] = {}
    if temperature is not None:
        kwargs["temperature"] = temperature
    return init_chat_model(resolved_model, model_provider="openai", **kwargs)

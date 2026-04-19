"""Optional screenplay-to-prose preprocessor.

Screenplay format (slug lines, parentheticals, transitions) can confuse the
downstream ViMax prompts, which were tuned on prose input. When we detect
screenplay markers we run a cheap LLM pass to normalise the input.
"""

from __future__ import annotations

from typing import Any, Tuple

from langchain_core.prompts import ChatPromptTemplate


SYSTEM_PROMPT = """You are a screenplay-to-prose adapter.
Convert the provided screenplay into continuous prose narrative that preserves
every action, character introduction, and dialogue beat. Preserve character
names. Drop slug lines (INT./EXT.), parentheticals, and transition cards (CUT TO:).
Return the prose as a single paragraph block per scene, scenes separated by a
blank line. Do not summarize or shorten."""


USER_PROMPT = "Screenplay:\n\n{script}"


async def maybe_preprocess_screenplay(
    script: str,
    chat_model: Any,
) -> Tuple[str, bool]:
    """If `script` looks like a screenplay, LLM-convert it to prose.

    Returns `(converted_script, did_preprocess)`.
    """
    if not _looks_like_screenplay(script):
        return script, False
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT),
            ("user", USER_PROMPT),
        ]
    )
    chain = prompt | chat_model
    result = await chain.ainvoke({"script": script})
    return str(getattr(result, "content", result)), True


def _looks_like_screenplay(script: str) -> bool:
    markers = (
        "INT.",
        "EXT.",
        "INT ",
        "EXT ",
        "\nCUT TO:",
        "FADE IN:",
        "FADE OUT:",
    )
    head = script[:4000].upper()
    return any(m in head for m in markers)

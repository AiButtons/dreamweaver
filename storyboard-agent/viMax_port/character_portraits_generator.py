"""Ported from ViMax/agents/character_portraits_generator.py.

Changes from upstream:
- Imports `CharacterInScene` from `_vimax_types`; no PIL/ImageOutput dependency.
- `after_func` is inlined as a no-op.
- M1 front-only: `generate_side_portrait` / `generate_back_portrait` are
  removed. They require reference-image support on `/api/image/generate`
  which is a deferred M2 dependency.
"""

from __future__ import annotations

from typing import Any

from tenacity import retry, stop_after_attempt

from ._vimax_types import CharacterInScene


def _after_func(retry_state) -> None:
    return None


prompt_template_front = """
Generate a full-body, front-view portrait of character {identifier} based on the following description, with a pure white background. The character should be centered in the image, occupying most of the frame. Gazing straight ahead. Standing with arms relaxed at sides. Natural expression.
Features: {features}
Style: {style}
"""


def build_front_portrait_prompt(character: CharacterInScene, style: str) -> str:
    """Format the ViMax front-portrait prompt without invoking any image
    generator. M1's coordinator uses this to return prompts to the Next.js
    ingestion route; the route then calls `/api/media/generate` (which runs
    inside the same Next.js process and carries the user's Better Auth
    session cookie) to produce the actual image URL.
    """
    features = (
        "(static) "
        + (character.static_features or "")
        + "; (dynamic) "
        + (character.dynamic_features or "")
    )
    return prompt_template_front.format(
        identifier=character.identifier_in_scene,
        features=features,
        style=style,
    )


class CharacterPortraitsGenerator:
    def __init__(self, image_generator=None) -> None:
        # ViMax's upstream `__init__` only takes `image_generator`. We keep
        # the same signature so any ViMax plug-in code works unchanged — but
        # for M1 the Python coordinator does NOT call `generate_front_portrait`
        # directly (the media proxy wants session cookies Python can't hold).
        # `image_generator` is allowed to be None in the prompt-only path.
        self.image_generator = image_generator

    def build_front_prompt(self, character: CharacterInScene, style: str) -> str:
        """Instance wrapper around `build_front_portrait_prompt` for callers
        that already have a generator instance on hand."""
        return build_front_portrait_prompt(character=character, style=style)

    @retry(stop=stop_after_attempt(3), after=_after_func, reraise=True)
    async def generate_front_portrait(
        self,
        character: CharacterInScene,
        style: str,
    ) -> Any:
        if self.image_generator is None:
            raise RuntimeError(
                "generate_front_portrait called without an image_generator; "
                "use build_front_prompt() for the prompt-only path."
            )
        prompt = build_front_portrait_prompt(character=character, style=style)
        image_output = await self.image_generator.generate_single_image(prompt=prompt)
        return image_output

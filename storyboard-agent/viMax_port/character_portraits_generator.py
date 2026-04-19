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


class CharacterPortraitsGenerator:
    def __init__(self, image_generator) -> None:
        # ViMax's upstream `__init__` only takes `image_generator`. We keep
        # the same signature so any ViMax plug-in code works unchanged.
        self.image_generator = image_generator

    @retry(stop=stop_after_attempt(3), after=_after_func, reraise=True)
    async def generate_front_portrait(
        self,
        character: CharacterInScene,
        style: str,
    ) -> Any:
        features = (
            "(static) "
            + character.static_features
            + "; (dynamic) "
            + character.dynamic_features
        )
        prompt = prompt_template_front.format(
            identifier=character.identifier_in_scene,
            features=features,
            style=style,
        )
        image_output = await self.image_generator.generate_single_image(prompt=prompt)
        return image_output

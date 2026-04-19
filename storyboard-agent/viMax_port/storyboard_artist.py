"""Ported from ViMax/agents/storyboard_artist.py.

Changes from upstream:
- Imports use `_vimax_types` rather than ViMax's `interfaces` package.
- `after_func` is inlined as a no-op.
- PydanticOutputParser + `{format_instructions}` replaced with LangChain's
  `with_structured_output(..., method="json_schema", strict=True)`. GPT-5.4's
  native JSON-schema mode enforces the response shape — no need to inject
  format instructions into the prompt.
- Public class surface and prompt intent are unchanged.
"""

from __future__ import annotations

import asyncio
from typing import List, Literal, Optional

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt

from ._vimax_types import (
    CharacterFacing,
    CharacterInScene,
    ShotBriefDescription,
    ShotDescription,
)


def _after_func(retry_state) -> None:
    return None


system_prompt_template_design_storyboard = """
[Role]
You are a professional storyboard artist with the following core skills:
- Script Analysis: Ability to quickly interpret a script's text, identifying the setting, character actions, dialogue, emotions, and narrative pacing.
- Visualization: Expertise in translating written descriptions into visual frames, including composition, lighting, and spatial arrangement.
- Storyboarding: Proficiency in cinematic language, such as shot types (e.g., close-up, medium shot, wide shot), camera angles (e.g., high angle, eye-level), camera movements (e.g., zoom, pan), and transitions.
- Narrative Continuity: Ability to ensure the storyboard sequence is logically smooth, highlights key plot points, and maintains emotional consistency.
- Technical Knowledge: Understanding of basic storyboard formats and industry standards, such as using numbered shots and concise descriptions.

[Task]
Your task is to design a complete storyboard based on a user-provided script (which contains only one scene). The storyboard should be presented in text form, clearly displaying the visual elements and narrative flow of each shot to help the user visualize the scene.

[Input]
The user will provide the following input.
- Script:A complete scene script containing dialogue, action descriptions, and scene settings. The script focuses on only one scene; there is no need to handle multiple scene transitions. The script input is enclosed within <SCRIPT> and </SCRIPT>.
- Characters List: A list describing basic information for each character, such as name, personality traits, appearance (if relevant). The character list is enclosed within <CHARACTERS> and </CHARACTERS>.
- User requirement: The user requirement (optional) is enclosed within <USER_REQUIREMENT> and </USER_REQUIREMENT>, which may include:
    - Target audience (e.g., children, teenagers, adults).
    - Storyboard style (e.g., realistic, cartoon, abstract).
    - Desired number of shots (e.g., "not more than 10 shots").
    - Other specific instructions (e.g., emphasize the characters' actions).

[Output]
Return a JSON object matching the provided schema. The `storyboard` field must
be an ordered list of shots. Each shot must carry `idx` (0-based), `is_last`,
`cam_idx` (0-based camera position — reuse where possible), `visual_desc`, and
`audio_desc`.

[Guidelines]
- Write every output value in English, regardless of the script's language. The downstream shot-image generator + Next.js UI expects English prose, so translate visual descriptions + audio descriptions into English even when the script is in another language.
- Each shot must have a clear narrative purpose—such as establishing the setting, showing character relationships, or highlighting reactions.
- Use cinematic language deliberately: close-ups for emotion, wide shots for context, and varied angles to direct audience attention.
- When designing a new shot, first consider whether it can be filmed using an existing camera position. Introduce a new one only if the shot size, angle, and focus differ significantly. If the camera undergoes significant movement, it cannot be used thereafter.
- Keep character names in visual descriptions and speaker fields consistent with the character list. In visual descriptions, enclose names in angle brackets (e.g., <Alice>), but not in dialogue or speaker fields.
- When describing visual elements, it is necessary to indicate the position of the element within the frame. For example, Character A is on the left side of the frame, facing toward the right, with a table in front of him. The table is positioned slightly to the left of the center of the frame. Ensure that invisible elements are not included. For instance, do not describe someone behind a closed door if they cannot be seen.
- Avoid unsafe content (violence, discrimination, etc.) in visual descriptions. Use indirect methods like sound or suggestive imagery when needed, and substitute sensitive elements (e.g., ketchup for blood).
- Assign at most one dialogue line per character per shot. Each line of dialogue should correspond to a shot.
- Each shot requires an independent description without reference to each other.
- When the shot focuses on a character, describe which specific body part the focus is on.
- When describing a character, it is necessary to indicate the direction they are facing.
- Set `is_last` to True only on the final shot of the storyboard.
"""

human_prompt_template_design_storyboard = """
<SCRIPT>
{script_str}
</SCRIPT>

<CHARACTERS>
{characters_str}
</CHARACTERS>

<USER_REQUIREMENT>
{user_requirement_str}
</USER_REQUIREMENT>
"""


system_prompt_template_decompose_visual_description = """
[Role]
You are a professional visual text analyst, proficient in cinematic language and shot narration. Your expertise lies in deconstructing a comprehensive shot description accurately into three core components: the static first frame, the static last frame, and the dynamic motion that connects them.

[Task]
Your task is to dissect and rewrite a user-provided visual text description of a shot strictly and insightfully into three distinct parts:
- First Frame Description: Describe the static image at the very beginning of the shot. Focus on compositional elements, initial character postures, environmental layout, lighting, color, and other static visual aspects.
- Last Frame Description: Describe the static image at the very end of the shot. Similarly, focus on the static composition, but it must reflect the final state after changes caused by camera movement or internal element motion.
- Motion Description: Describe all movements that occur between the first frame and the last frame. This includes camera movement (e.g., static, push-in, pull-out, pan, track, follow, tilt, etc.) and movement of elements within the shot (e.g., character movement, object displacement, changes in lighting, etc.). This is the most dynamic part of the entire description. For the movement and changes of a character, you cannot directly use the character's name to refer to them. Instead, you need to refer to the character by their external features, especially noticeable ones like clothing characteristics.

[Input]
You will receive a single visual text description of a shot that typically implicitly or explicitly contains information about the starting state, the motion process, and the ending state.
Additionally, you will receive a sequence of potential characters, each containing an identifier and a feature.
- The description is enclosed within <VISUAL_DESC> and </VISUAL_DESC>.
- The character list is enclosed within <CHARACTERS> and </CHARACTERS>.

[Output]
Return a JSON object matching the provided schema with fields `ff_desc`,
`ff_vis_char_idxs`, `ff_char_facings`, `lf_desc`, `lf_vis_char_idxs`,
`motion_desc`, `variation_type` ("large" | "medium" | "small"), and
`variation_reason`.

`ff_char_facings` is a parallel list to `ff_vis_char_idxs` — same length, same
order. Each entry names the facing direction of the corresponding character
in the first frame:
  * "toward_camera" — facing the lens directly.
  * "away_from_camera" — showing their back to the camera.
  * "screen_left" — strict profile facing screen-left.
  * "screen_right" — strict profile facing screen-right.
  * "three_quarter_left" — angled partway between front and screen-left.
  * "three_quarter_right" — angled partway between front and screen-right.
  * "unknown" — only when the description is genuinely ambiguous.

[Guidelines]
- Write every output value in English, regardless of the script's language. The downstream image generator + UI expects English prose.
- Ensure the first and last frame descriptions are pure "snapshots," containing no ongoing actions (e.g., "He is about to stand up" is unacceptable; it should be "He is sitting on the chair, leaning slightly forward").
- In the motion description, you must clearly distinguish between camera movement and on-screen movement. Use professional cinematic terminology (e.g., dolly shot, pan, zoom, etc.) as precisely as possible to describe camera movement.
- In the motion description, you cannot directly use character names to refer to characters; instead, you should use the characters' visible characteristics to refer to them. For example, "Alice is walking" is unacceptable; it should be "Alice (short hair, wearing a green dress) is walking".
- The last frame description must be logically consistent with the first frame description and the motion description. All actions described in the motion section should be reflected in the static image of the last frame.
- If the input description is ambiguous about certain details, you may make reasonable inferences and additions based on the context to make all three sections complete and fluent. However, core elements must strictly adhere to the input text.
- Use accurate, concise, and professional descriptive language. Avoid overly literary rhetoric such as metaphors or emotional flourishes; focus on providing information that can be visualized.
- Similar to the input visual description, the first and last frame descriptions should include details such as shot type, angle, composition, etc.
- Below are the three types of variation within a shot (not between two shots):
(1) 'large' cases typically involve the exaggerated transition shots which means a significant change in the composition and focus, such as smoothly changing from a wide shot to a close-up. It is usually accompanied by significant camera movement (e.g., drone perspective shots across the city).
(2) 'medium' cases often involve the introduction of new characters and a character turns from the back to face the front (facing the camera).
(3) 'small' cases usually involve minor changes, such as expression changes, movement and pose changes of existing characters(e.g., walking, sitting down, standing up), moderate camera movements(e.g., pan, tilt, track).
- When describing a character, it is necessary to indicate the direction they are facing.
- The first shot must establish the overall scene environment, using the widest possible shot.
- Use as few camera positions as possible.
"""


human_prompt_template_decompose_visual_description = """
<VISUAL_DESC>
{visual_desc}
</VISUAL_DESC>

<CHARACTERS>
{characters_str}
</CHARACTERS>
"""


class VisDescDecompositionResponse(BaseModel):
    ff_desc: str = Field(
        description="A detailed description of the first frame of the shot.",
    )
    ff_vis_char_idxs: List[int] = Field(
        description="Indices of characters visible in the first frame.",
    )
    ff_char_facings: List[CharacterFacing] = Field(
        description=(
            "Facing direction for each character in ff_vis_char_idxs, in the "
            "same order and with the same length. Use 'unknown' only when the "
            "description is genuinely ambiguous."
        ),
    )
    lf_desc: str = Field(
        description="A detailed description of the last frame of the shot.",
    )
    lf_vis_char_idxs: List[int] = Field(
        description="Indices of characters visible in the last frame.",
    )
    motion_desc: str = Field(
        description="The motion description of the shot.",
    )
    variation_type: Literal["large", "medium", "small"] = Field(
        description="The degree of change between the first and last frames.",
    )
    variation_reason: str = Field(
        description="The reason for the variation type of the shot.",
    )


class StoryboardArtist:
    def __init__(self, chat_model) -> None:
        self.chat_model = chat_model

    @retry(stop=stop_after_attempt(3), after=_after_func)
    async def design_storyboard(
        self,
        script: str,
        characters: List[CharacterInScene],
        user_requirement: Optional[str] = None,
        retry_timeout: int = 150,
    ) -> List[ShotBriefDescription]:
        class StoryboardResponse(BaseModel):
            storyboard: List[ShotBriefDescription] = Field(
                description="A complete storyboard of the scene.",
            )

        script_str = script.strip()
        characters_str = "\n".join(
            [f"Character {index}: {char}" for index, char in enumerate(characters)]
        )
        user_requirement_str = user_requirement.strip() if user_requirement else ""

        structured_model = self.chat_model.with_structured_output(
            StoryboardResponse,
            method="json_schema",
            strict=True,
        )
        messages = [
            ("system", system_prompt_template_design_storyboard),
            (
                "human",
                human_prompt_template_design_storyboard.format(
                    script_str=script_str,
                    characters_str=characters_str,
                    user_requirement_str=user_requirement_str,
                ),
            ),
        ]
        response: StoryboardResponse = await asyncio.wait_for(
            structured_model.ainvoke(messages),
            timeout=retry_timeout,
        )
        return response.storyboard

    @retry(stop=stop_after_attempt(3), after=_after_func)
    async def decompose_visual_description(
        self,
        shot_brief_desc: ShotBriefDescription,
        characters: List[CharacterInScene],
        retry_timeout: int = 150,
    ) -> ShotDescription:
        structured_model = self.chat_model.with_structured_output(
            VisDescDecompositionResponse,
            method="json_schema",
            strict=True,
        )
        prompt_template = ChatPromptTemplate.from_messages(
            [
                ("system", system_prompt_template_decompose_visual_description),
                ("human", human_prompt_template_decompose_visual_description),
            ]
        )
        chain = prompt_template | structured_model

        visual_desc = shot_brief_desc.visual_desc.strip()
        characters_str = "\n".join(
            [
                f"{char.identifier_in_scene}: (static) {char.static_features}; (dynamic) {char.dynamic_features}"
                for char in characters
            ]
        )

        decomposition: VisDescDecompositionResponse = await asyncio.wait_for(
            chain.ainvoke(
                input={
                    "visual_desc": visual_desc,
                    "characters_str": characters_str,
                },
            ),
            timeout=retry_timeout,
        )

        # Defensive length alignment: if the LLM emits a facings list that
        # doesn't match ff_vis_char_idxs (shouldn't happen under strict JSON
        # schema, but belt-and-suspenders), truncate or pad with "unknown"
        # so downstream consumers never see a parallel-array mismatch.
        aligned_facings: List[CharacterFacing] = list(decomposition.ff_char_facings)
        expected = len(decomposition.ff_vis_char_idxs)
        if len(aligned_facings) > expected:
            aligned_facings = aligned_facings[:expected]
        while len(aligned_facings) < expected:
            aligned_facings.append("unknown")

        return ShotDescription(
            idx=shot_brief_desc.idx,
            is_last=shot_brief_desc.is_last,
            cam_idx=shot_brief_desc.cam_idx,
            visual_desc=shot_brief_desc.visual_desc,
            variation_type=decomposition.variation_type,
            variation_reason=decomposition.variation_reason,
            ff_desc=decomposition.ff_desc,
            ff_vis_char_idxs=decomposition.ff_vis_char_idxs,
            ff_char_facings=aligned_facings,
            lf_desc=decomposition.lf_desc,
            lf_vis_char_idxs=decomposition.lf_vis_char_idxs,
            motion_desc=decomposition.motion_desc,
            audio_desc=shot_brief_desc.audio_desc,
        )

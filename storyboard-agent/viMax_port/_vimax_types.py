"""Self-contained re-declarations of the ViMax interfaces the ported agents
rely on. Copied verbatim from:
  - ViMax/interfaces/character.py  (CharacterInScene)
  - ViMax/interfaces/shot_description.py  (ShotBriefDescription, ShotDescription)
  - ViMax/interfaces/image_output.py  (simplified ImageOutput)

Rationale: ViMax is not pip-installable; duplicating the minimum surface keeps
this port independent of the ViMax source tree. Do not add behavior here — if
ViMax's upstream types change, re-sync.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class CharacterInScene(BaseModel):
    idx: int = Field(
        description="The index of the character in the scene, starting from 0",
    )
    identifier_in_scene: str = Field(
        description="The identifier for the character in this specific scene, which may differ from the base identifier",
        examples=["Alice", "Bob the Builder"],
    )
    is_visible: bool = Field(
        description="Indicates whether the character is visible in this scene",
        examples=[True, False],
    )
    static_features: str = Field(
        description="The static features of the character in this specific scene, such as facial features and body shape that remain constant or are rarely changed. If the character is not visible, this field can be left empty.",
        examples=[
            "Alice has long blonde hair and blue eyes, and is of slender build.",
            "Bob the Builder is a middle-aged man with a sturdy build.",
        ],
    )
    dynamic_features: str = Field(
        description="The dynamic features of the character in this specific scene, such as clothing and accessories that may change from scene to scene. If not mentioned, this field can be left empty. If the character is not visible, this field should be None.",
        examples=[
            "Wearing a red scarf and a black leather jacket",
        ],
    )

    def __str__(self) -> str:
        s = f"{self.identifier_in_scene}"
        s += "[visible]" if self.is_visible else "[not visible]"
        s += "\n"
        s += f"static features: {self.static_features}\n"
        s += f"dynamic features: {self.dynamic_features}\n"
        return s


class ShotBriefDescription(BaseModel):
    idx: int = Field(
        description="The index of the shot in the sequence, starting from 0.",
        examples=[0, 1, 2],
    )
    is_last: bool = Field(
        description="Whether this is the last shot. If True, the story of the script has ended and no more shots will be planned after this one.",
        examples=[False, True],
    )
    cam_idx: int = Field(
        description="The index of the camera in the scene.",
        examples=[0, 1, 2],
    )
    visual_desc: str = Field(
        description=(
            "A vivid and detailed visual description of the shot. The character identifiers"
            " must match those in the character list and be enclosed in angle brackets"
            " (e.g., <Alice>, <Bob>). All visible characters should be described. If dialogue is"
            " present, include it in quotes inside this description."
        ),
    )
    audio_desc: str = Field(
        description="A detailed description of the audio in the shot.",
    )


class ShotDescription(BaseModel):
    idx: int = Field(
        description="The index of the shot in the sequence, starting from 0."
    )
    is_last: bool = Field(
        description="Whether this is the last shot in the sequence."
    )
    cam_idx: int = Field(
        description="The index of the camera in the scene.",
    )
    visual_desc: str = Field(
        description="Vivid visual description of the shot.",
    )
    variation_type: Literal["large", "medium", "small"] = Field(
        description="The degree of change in the shot's content.",
    )
    variation_reason: str = Field(
        description="The reason for the variation type of the shot.",
    )
    ff_desc: str = Field(
        description="The first frame of the shot.",
    )
    ff_vis_char_idxs: List[int] = Field(
        default_factory=list,
        description="The indices of characters visible in the first frame.",
    )
    lf_desc: str = Field(
        description="The last frame of the shot.",
    )
    lf_vis_char_idxs: List[int] = Field(
        default_factory=list,
        description="The indices of characters visible in the last frame.",
    )
    motion_desc: str = Field(
        description="The motion description of the shot.",
    )
    audio_desc: Optional[str] = Field(
        default=None,
        description="Audio description for the shot.",
    )

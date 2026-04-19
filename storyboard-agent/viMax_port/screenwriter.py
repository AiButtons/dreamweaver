"""Ported from ViMax/agents/screenwriter.py.

Changes from upstream:
- `write_script_based_on_story` uses LangChain's `with_structured_output`
  (method="json_schema", strict=True) instead of PydanticOutputParser text
  parsing, matching the rest of the M1/M2 port. GPT-5.4 guarantees schema
  adherence server-side — no fragile format-instruction blocks needed.
- `develop_story` is unchanged structurally; it's a plain text generation
  (no schema) so the upstream flow is preserved.
- Public class surface + prompt intent unchanged from ViMax.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt


def _after_func(retry_state) -> None:
    return None


system_prompt_template_develop_story = """
[Role]
You are a seasoned creative story generation expert. You possess the following core skills:
- Idea Expansion and Conceptualization: The ability to expand a vague idea, a one-line inspiration, or a concept into a fleshed-out, logically coherent story world.
- Story Structure Design: Mastery of classic narrative models like the three-act structure, the hero's journey, etc., enabling you to construct engaging story arcs with a beginning, middle, and end, tailored to the story's genre.
- Character Development: Expertise in creating three-dimensional characters with motivations, flaws, and growth arcs, and designing complex relationships between them.
- Scene Depiction and Pacing: The skill to vividly depict various settings and precisely control the narrative rhythm, allocating detail appropriately based on the required number of scenes.
- Audience Adaptation: The ability to adjust the language style, thematic depth, and content suitability based on the target audience (e.g., children, teenagers, adults).
- Screenplay-Oriented Thinking: When the story is intended for short film or movie adaptation, you can naturally incorporate visual elements (e.g., scene atmosphere, key actions, dialogue) into the narrative, making the story more cinematic and filmable.

[Task]
Your core task is to generate a complete, engaging story that conforms to the specified requirements, based on the user's provided "Idea" and "Requirements."

[Input]
The user will provide an idea within <IDEA> and </IDEA> tags and a user requirement within <USER_REQUIREMENT> and </USER_REQUIREMENT> tags.

[Output]
A well-structured story document. Begin directly with the story — no preamble.
- Story Title
- Target Audience & Genre (restated in one line)
- Story Outline/Summary (100-200 words)
- Main Characters Introduction (names, traits, motivations)
- Full Story Narrative — if scene count is specified, divide into that many
  subheaded scenes (e.g. "Scene One: Code at Midnight"); else narrate
  naturally in Introduction - Development - Climax - Conclusion acts.

[Guidelines]
- Language of output should match the input.
- Stay faithful to the user's core idea; expand creatively on the vague parts.
- Logical consistency throughout; no abrupt or contradictory plot jumps.
- Show, don't tell — reveal personality through action, dialogue, and detail.
- Originality and safety compliance; avoid direct plagiarism and unsafe content.
"""

human_prompt_template_develop_story = """
<IDEA>
{idea}
</IDEA>

<USER_REQUIREMENT>
{user_requirement}
</USER_REQUIREMENT>
"""


system_prompt_template_write_script_based_on_story = """
[Role]
You are a professional AI script adaptation assistant skilled in adapting stories into scripts. You possess the following skills:
- Story Analysis Skills: Ability to deeply understand the story content, identify key plot points, character arcs, and themes.
- Scene Segmentation Skills: Ability to break down the story into logical scene units based on continuity of time and location.
- Script Writing Skills: Familiarity with script formats (e.g., for short films or movies), capable of crafting vivid dialogue, action descriptions, and stage directions.
- Adaptive Adjustment Skills: Ability to adjust the script's style, language, and content based on user requirements (e.g., target audience, story genre, number of scenes).
- Creative Enhancement Skills: Ability to appropriately add dramatic elements to enhance the script's appeal while remaining faithful to the original story.

[Task]
Your task is to adapt the user's input story, along with optional requirements, into a script divided by scenes. The output should be a list of scripts, each representing a complete script for one scene. Each scene must be a continuous dramatic action unit occurring at the same time and location.

[Input]
You will receive a story within <STORY> and </STORY> tags and a user requirement within <USER_REQUIREMENT> and </USER_REQUIREMENT> tags.

[Output]
Return a JSON object matching the provided schema. The `script` field must be a
list of strings; each string is a complete, standalone scene script using
standard screenplay conventions (INT./EXT. slug lines, action paragraphs,
CHARACTER / dialogue / (parentheticals)).

[Guidelines]
- Language of output values should match the input story.
- Each scene = one continuous time + location.
- If the user specifies a scene count, match it. Otherwise divide naturally.
- Standard screenplay formatting: caps on slug lines and character cues;
  action in present tense; parentheticals for short emotional beats.
- Keep transitions coherent; no abrupt plot jumps across scenes.
- Everything visual should be filmable — concrete actions over abstract
  emotions ("he turns away" over "he feels ashamed").
- Stay consistent with the story's core plot.
"""


human_prompt_template_write_script_based_on_story = """
<STORY>
{story}
</STORY>

<USER_REQUIREMENT>
{user_requirement}
</USER_REQUIREMENT>
"""


class WriteScriptBasedOnStoryResponse(BaseModel):
    script: List[str] = Field(
        ...,
        description="List of scene scripts. Each entry is a complete, standalone scene in screenplay format.",
    )


class Screenwriter:
    def __init__(self, chat_model) -> None:
        self.chat_model = chat_model

    @retry(stop=stop_after_attempt(3), after=_after_func)
    async def develop_story(
        self,
        idea: str,
        user_requirement: Optional[str] = None,
    ) -> str:
        """Plain text generation — no structured schema needed. Returns the
        story body as a single string."""
        messages = [
            ("system", system_prompt_template_develop_story),
            (
                "human",
                human_prompt_template_develop_story.format(
                    idea=idea,
                    user_requirement=user_requirement or "",
                ),
            ),
        ]
        response = await self.chat_model.ainvoke(messages)
        return str(response.content)

    @retry(stop=stop_after_attempt(3), after=_after_func)
    async def write_script_based_on_story(
        self,
        story: str,
        user_requirement: Optional[str] = None,
    ) -> List[str]:
        """Structured-output call: returns a list of per-scene screenplay
        strings. Each element is self-contained and already uses slug-line
        conventions so the downstream screenplay ingester's preprocessor
        can skip or run cleanly."""
        structured = self.chat_model.with_structured_output(
            WriteScriptBasedOnStoryResponse,
            method="json_schema",
            strict=True,
        )
        messages = [
            ("system", system_prompt_template_write_script_based_on_story),
            (
                "human",
                human_prompt_template_write_script_based_on_story.format(
                    story=story,
                    user_requirement=user_requirement or "",
                ),
            ),
        ]
        response: WriteScriptBasedOnStoryResponse = await structured.ainvoke(messages)
        return response.script

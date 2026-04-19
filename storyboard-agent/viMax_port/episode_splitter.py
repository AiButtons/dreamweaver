"""Episode splitter — NEW agent (ViMax doesn't have one).

Takes a compressed novel narrative and returns a list of episode specs
suitable for feeding through `Screenwriter.write_script_based_on_story`.
Each spec has enough detail for the downstream screenwriter + screenplay
ingester to produce a standalone per-episode storyboard branch.

Uses GPT-5.4 structured output (json_schema, strict) so the List[EpisodeSpec]
comes back parse-error-free even on long narratives. No retries needed —
GPT-5.4's schema enforcement is deterministic.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt


def _after_func(retry_state) -> None:
    return None


system_prompt_template_split_episodes = """
[Role]
You are a seasoned showrunner and story editor. Your job is to break a novel
into a series of self-contained but narratively-linked episodes — the
backbone of a TV series, a limited series, or a set of short films.

[Task]
Given the provided novel narrative (which may itself already be a
compressed form of a longer work) and an optional target episode count,
produce a structured list of episodes. Each episode must:
- Advance the overarching plot with its own internal arc.
- Be visually filmable — you will describe it vividly enough that a
  screenwriter can break it into scenes.
- Have a clear title, a detailed 3-6 paragraph summary, and 4-8 key
  story beats that a screenwriter should hit when adapting the episode.

[Input]
- NARRATIVE: the compressed novel text within <NARRATIVE> tags.
- TARGET_EPISODE_COUNT (optional): the number of episodes the user wants.
  When present, produce exactly that many episodes; when absent, pick a
  natural count (typically 3-6) based on the narrative's structure and
  length. Do not produce more than 10 episodes under any circumstances.

[Output]
Return a JSON object matching the provided schema. The `episodes` field
must be an ordered list of episode specs, one entry per episode. Each
entry has `index` (0-based), `title`, `summary`, and `key_beats`.

[Guidelines]
- Language: keep the output language consistent with the input narrative.
- Episode boundaries: prefer natural narrative breakpoints — act breaks,
  major time jumps, POV shifts, climactic reveals.
- Summary: write 3-6 paragraphs of continuous prose. Include setting,
  character actions, dialogue beats, and emotional arc. The summary
  should read like a mini-story — detailed enough that a screenwriter
  can break it into 6-15 shots without consulting the original novel.
- Key beats: 4-8 bullet-style single-sentence beats that hit the major
  story moments. Each beat should be a concrete event, not an abstract
  theme ("Kai confronts Elena on the rooftop" not "Kai faces his past").
- Character continuity: recurring characters must use consistent names
  across episodes.
- Do not rewrite or expand the novel — compress and segment what's there.
- Safety: skip any non-narrative content (metadata, author notes,
  unsafe content). Substitute sensitive imagery per standard
  content-safety conventions.
"""

human_prompt_template_split_episodes = """
<NARRATIVE>
{narrative}
</NARRATIVE>

<TARGET_EPISODE_COUNT>
{target_count_str}
</TARGET_EPISODE_COUNT>
"""


class EpisodeSpec(BaseModel):
    """One episode of the series — the intermediate unit between a novel
    and a set of per-episode screenplays. Fed into
    `Screenwriter.write_script_based_on_story` to produce scene scripts,
    which then feed the standard M1 screenplay ingester."""

    index: int = Field(
        description="0-based position of this episode within the series. Must be contiguous and ordered.",
    )
    title: str = Field(
        description='Short episode title. Example: "The Archive" or "Episode 2 — The Fever".',
    )
    summary: str = Field(
        description=(
            "3-6 paragraphs of prose narrative covering the episode's setting, "
            "character actions, dialogue beats, and emotional arc. Should be "
            "detailed enough for a screenwriter to break into 6-15 shots."
        ),
    )
    key_beats: List[str] = Field(
        description="4-8 concrete story beats as single sentences. Bulleted in natural order.",
    )


class SplitEpisodesResponse(BaseModel):
    episodes: List[EpisodeSpec] = Field(
        ...,
        description="Ordered list of episode specs covering the whole narrative.",
    )


class EpisodeSplitter:
    def __init__(self, chat_model) -> None:
        self.chat_model = chat_model

    @retry(stop=stop_after_attempt(3), after=_after_func)
    async def split_into_episodes(
        self,
        narrative: str,
        target_episode_count: Optional[int] = None,
    ) -> List[EpisodeSpec]:
        structured = self.chat_model.with_structured_output(
            SplitEpisodesResponse,
            method="json_schema",
            strict=True,
        )
        target_str = (
            str(target_episode_count) if target_episode_count and target_episode_count > 0 else "auto"
        )
        messages = [
            ("system", system_prompt_template_split_episodes),
            (
                "human",
                human_prompt_template_split_episodes.format(
                    narrative=narrative.strip(),
                    target_count_str=target_str,
                ),
            ),
        ]
        response: SplitEpisodesResponse = await structured.ainvoke(messages)
        episodes = list(response.episodes)
        # Defensive: re-number indices in case the model diverged. Keeps
        # downstream code from having to second-guess the contract.
        for i, ep in enumerate(episodes):
            ep.index = i
        return episodes

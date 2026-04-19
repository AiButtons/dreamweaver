"""Ported from ViMax/agents/novel_compressor.py.

Changes from upstream:
- chat_model is injected by the caller (from `llm_factory.make_chat_model()`)
  rather than initialized inside the class — keeps the LLM config in one
  place and lets the tests swap in stubs.
- Imports `RecursiveCharacterTextSplitter` from `langchain_text_splitters`
  (the modern split-out package) instead of the legacy
  `langchain.text_splitter` path that vanished in langchain >=1.0.
- Default chunk size lowered to 40k chars (from 64k) to stay well under
  OpenAI 128k-context budgets after Pydantic response overhead, and to
  keep the per-chunk latency tolerable for the streaming UI.
- `compress_single_novel_chunk` renamed to the private helper
  `_compress_chunk` and returns the string directly (index is tracked by
  the caller via asyncio.gather order, not injected into the return
  value). Simplifies the downstream aggregate call.
"""

from __future__ import annotations

import asyncio
import logging
from typing import List

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_text_splitters import RecursiveCharacterTextSplitter


log = logging.getLogger(__name__)


system_prompt_template_compress_novel_chunk = """
You are an expert text compression assistant specialized in literary content. Your goal is to condense novels or story excerpts while preserving core narrative elements, key details, character development, and plot coherence.

**TASK**
Compress the provided input text to reduce its length significantly, eliminating redundancies, overly descriptive passages, and minor details—but without losing essential story arcs, dialogue, or emotional impact. Aim for clarity and readability in the compressed output.

**INPUT**
A segment of a novel (possibly truncated due to context length constraints). It is enclosed within <NOVEL_CHUNK_START> and <NOVEL_CHUNK_END> tags.

**OUTPUT**
A compressed version of the input text, retaining the core narrative, critical events, and character interactions.

**GUIDELINES**
1. Fidelity to the Plot: Absolutely preserve all major plot points, twists, revelations, and the sequence of key events. Do not omit crucial story elements.
2. Character Consistency: Maintain character actions, decisions, and development. Important dialogue that reveals plot or character can be condensed or paraphrased but its meaning must be kept intact.
3. Streamline Description: Reduce lengthy descriptions of settings, characters, or objects to their most essential and evocative elements.
4. Condense Internal Monologue: Paraphrase characters' extended internal thoughts and reflections, focusing on the key realizations.
5. Simplify Language: Use direct, concise language. Combine sentences; eliminate redundant adverbs and adjectives.
6. Cohesion and Flow: Produce a smooth, readable narrative that reads naturally paragraph-to-paragraph.
7. Discard any non-narrative text (e.g., "Please follow my account!", personal opinions, metadata).
8. Do not introduce chapter markers or section breaks.
9. The language of output should be consistent with the original text.
"""

human_prompt_template_compress_novel_chunk = """
<NOVEL_CHUNK_START>
{novel_chunk}
<NOVEL_CHUNK_END>
"""


system_prompt_template_aggregate = """
You are a professional text processing assistant specializing in the aggregation and refinement of segmented text chunks. Your expertise lies in seamlessly merging sequential text fragments while intelligently handling overlapping or duplicated content.

**TASK**
Aggregate the provided text chunks into a coherent and continuous narrative. Carefully identify and resolve overlaps where the end of one chunk and the beginning of the next contain semantically similar content. Remove redundant repetitions while preserving the original meaning, style, and flow of the text.

**INPUT**
A sequence of text chunks (ordered from first to last). Each chunk is enclosed within <CHUNK_N_START> and <CHUNK_N_END> tags, where N is the chunk index starting from 0.

**OUTPUT**
A single, consolidated narrative without unnatural repetitions. Preserve all non-overlapping content exactly; smooth out transitions where chunks join.

**GUIDELINES**
1. Analyze chunks sequentially. For each adjacent pair (N, N+1), compare the end of N and the beginning of N+1 to detect overlapping content.
2. If overlapping segments are semantically equivalent, merge by retaining the later chunk's phrasing.
3. If segments have additional details, integrate the meaningful information without duplication.
4. Preserve all unique content verbatim.
5. Never invent new content or alter plot beyond handling overlaps.
6. The language of output should be consistent with the original text.
"""

human_prompt_template_aggregate = """
{chunks}
"""


class NovelCompressor:
    def __init__(
        self,
        chat_model,
        chunk_size: int = 40_000,
        chunk_overlap: int = 4_000,
    ) -> None:
        self.chat_model = chat_model
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )

    def split(self, novel_text: str) -> List[str]:
        """Pure (deterministic) — safe to call without an LLM. Returns the
        novel broken into overlapping chunks sized for the compressor."""
        return self.splitter.split_text(novel_text)

    async def compress(
        self,
        novel_chunks: List[str],
        max_concurrent_tasks: int = 5,
    ) -> List[str]:
        """Compress every chunk in parallel, bounded by a semaphore so the
        LLM provider doesn't rate-limit us. Returns one compressed string
        per input chunk, in input order."""
        sem = asyncio.Semaphore(max_concurrent_tasks)
        tasks = [
            self._compress_chunk(sem, i, chunk) for i, chunk in enumerate(novel_chunks)
        ]
        return await asyncio.gather(*tasks)

    async def _compress_chunk(
        self,
        sem: asyncio.Semaphore,
        index: int,
        novel_chunk: str,
    ) -> str:
        async with sem:
            log.info("compressing chunk %d (%d chars)", index, len(novel_chunk))
            messages = [
                SystemMessage(content=system_prompt_template_compress_novel_chunk),
                HumanMessage(
                    content=human_prompt_template_compress_novel_chunk.format(
                        novel_chunk=novel_chunk,
                    ),
                ),
            ]
            response = await self.chat_model.ainvoke(messages)
            return str(response.content)

    async def aggregate(self, compressed_chunks: List[str]) -> str:
        """Merge N compressed chunks into one coherent narrative via a single
        LLM pass. Short-circuits for 0-1 chunks (no merge needed)."""
        if len(compressed_chunks) == 0:
            return ""
        if len(compressed_chunks) == 1:
            return compressed_chunks[0]
        chunks_str = "\n".join(
            [
                f"<CHUNK_{i}_START>\n{chunk}\n<CHUNK_{i}_END>"
                for i, chunk in enumerate(compressed_chunks)
            ]
        )
        messages = [
            SystemMessage(content=system_prompt_template_aggregate),
            HumanMessage(
                content=human_prompt_template_aggregate.format(chunks=chunks_str),
            ),
        ]
        response = await self.chat_model.ainvoke(messages)
        return str(response.content)

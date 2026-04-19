"""Live integration harness — exercises the REAL OpenAI API end-to-end.

Not run under `pytest` by default (filename doesn't match `test_*.py`).
Invoke explicitly:

    cd storyboard-agent
    uv run python -m viMax_port.tests.integration_live

Requirements:
- OPENAI_API_KEY set in env
- Network access to api.openai.com

What it does:
1. Builds a small screenplay fixture.
2. Stubs `MediaProxyImageGenerator` with a fake async generator that returns
   canned URLs (so we don't need the Next.js server running).
3. Runs `ingest_screenplay` end-to-end with GPT-5.4.
4. Prints the structured IngestionResult as pretty JSON.
5. Asserts basic invariants (≥1 character, ≥2 shots, 1 portrait per visible
   character, edges = N-1).

Exit code 0 on success, 1 on failure.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

# Load .env manually (no python-dotenv dep in this project).
def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_env_file(Path(__file__).resolve().parents[2] / ".env")


# Sample screenplay — short enough to run in <60s, rich enough to exercise
# character extraction + shot decomposition.
SAMPLE_SCREENPLAY = """
INT. ROOFTOP GARDEN - DUSK

The city glows amber below. KAI (late 20s, a hooded figure with a tablet
tucked under one arm) paces along the edge of the roof, phone pressed to
his ear. His free hand grips the rail.

KAI
(into phone)
She's not answering. If this falls through tonight, we start over.

A door behind him swings open. ELENA (30s, dark coat, clipboard) steps
out, her breath visible in the cold air.

ELENA
You don't "start over" from picture lock.
We deliver, or we don't get paid.

Kai pockets the phone. He turns to face her, jaw set.

KAI
Then we deliver.

He pushes past her, toward the door.

CUT TO:

INT. SERVER ROOM - CONTINUOUS

Banks of humming machines. Kai drops the tablet on a desk, fingers
flying across its glass. On screen: a progress bar creeps from 43% to 58%.
"""


class _FakeImageGenerator:
    """Drop-in for MediaProxyImageGenerator that returns canned URLs.

    Satisfies the structural protocol ViMax expects: an async
    `generate_single_image(prompt, reference_image_paths, **kwargs) -> ImageOutput`.
    """

    def __init__(self) -> None:
        self._counter = 0

    async def generate_single_image(self, prompt, reference_image_paths=None, **kwargs):
        from viMax_port.media_proxy import ImageOutput

        self._counter += 1
        return ImageOutput(
            sourceUrl=f"https://example.test/fake-portrait-{self._counter}.png",
            modelId="stub-image-gen",
        )


async def _main() -> int:
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY not set — refusing to run live integration.", file=sys.stderr)
        return 1

    from viMax_port import screenplay_ingester as ingester_module

    # Monkey-patch MediaProxyImageGenerator so the coordinator's factory call
    # returns our fake generator. Less invasive than threading a new arg in.
    ingester_module.MediaProxyImageGenerator = lambda **_: _FakeImageGenerator()

    print("=" * 72)
    print(f"ViMax M1 live integration — model={os.environ.get('VIMAX_PORT_LLM_MODEL', 'gpt-5.4')}")
    print("=" * 72)
    started = time.time()

    try:
        result = await ingester_module.ingest_screenplay(
            storyboard_id="sb_live_test",
            screenplay=SAMPLE_SCREENPLAY,
            style="Gritty realism, cool color grade",
            user_requirement="Keep it to 6 shots or fewer.",
            media_base_url="http://stub",  # unused — fake generator ignores
            auth_token="stub-token",
        )
    except Exception as exc:
        print(f"\nFAIL: ingestion raised {type(exc).__name__}: {exc}", file=sys.stderr)
        raise

    elapsed = time.time() - started

    print(f"\nIngestion complete in {elapsed:.1f}s. LLM calls: {result.llmCallCount}.")
    print(f"Preprocessed: {result.preprocessed}")
    print(f"Characters: {len(result.characters)}")
    for c in result.characters:
        visible = "visible" if c.isVisible else "off-screen"
        static = c.staticFeatures[:80].replace("\n", " ")
        print(f"  - [{visible}] {c.identifier}: {static}...")

    print(f"\nPortraits: {len(result.portraits)}")
    for p in result.portraits:
        print(f"  - {p.characterIdentifier} ({p.view}) → {p.sourceUrl}")

    print(f"\nNodes: {len(result.nodes)}  Edges: {len(result.edges)}")
    for n in result.nodes[:4]:
        sm = n.shotMeta
        meta = f"size={sm.size}, angle={sm.angle}, move={sm.move}, aspect={sm.aspect}, dur={sm.durationS}s" if sm else "—"
        segment = (n.segment or "")[:80].replace("\n", " ")
        print(f"  - {n.nodeId[:12]} [{meta}] {segment}...")
    if len(result.nodes) > 4:
        print(f"  ... ({len(result.nodes) - 4} more)")

    print("\nFirst-node full payload (formatted):")
    if result.nodes:
        print(json.dumps(result.nodes[0].model_dump(), indent=2))

    # Invariants
    assert len(result.characters) >= 1, "expected ≥1 character extracted"
    assert len(result.nodes) >= 2, "expected ≥2 shot nodes"
    visible_chars = [c for c in result.characters if c.isVisible]
    assert len(result.portraits) == len(visible_chars), (
        f"expected {len(visible_chars)} portraits (1 per visible char), "
        f"got {len(result.portraits)}"
    )
    if len(result.nodes) >= 2:
        assert len(result.edges) == len(result.nodes) - 1, (
            f"expected {len(result.nodes) - 1} serial edges, got {len(result.edges)}"
        )
        for i, e in enumerate(result.edges):
            assert e.isPrimary, f"edge {i} must be primary"
            assert e.edgeType == "serial", f"edge {i} must be serial"

    print("\nAll invariants pass.")
    return 0


if __name__ == "__main__":
    code = asyncio.run(_main())
    sys.exit(code)

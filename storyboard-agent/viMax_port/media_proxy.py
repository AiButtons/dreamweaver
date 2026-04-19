"""Adapter that satisfies ViMax's ImageGenerator structural protocol but
delegates to Dreamweaver's media-proxy endpoint (`POST /api/image/generate`).

ViMax's protocol is structural (duck-typed Protocol), so we do NOT import it.
We just match the method signature of `generate_single_image`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional

import httpx


@dataclass
class ImageOutput:
    """Minimal stand-in for ViMax's ImageOutput. The portrait generator only
    forwards this object outward; the coordinator reads `sourceUrl`."""

    sourceUrl: str
    localPath: Optional[str] = None
    modelId: Optional[str] = None


class MediaProxyImageGenerator:
    def __init__(
        self,
        base_url: str,
        auth_token: str,
        default_model_id: str = "zennah-image-gen",
        default_aspect: str = "9:16",
        timeout_s: float = 60.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._auth_token = auth_token
        self._default_model_id = default_model_id
        self._default_aspect = default_aspect
        self._timeout_s = timeout_s

    async def generate_single_image(
        self,
        prompt: str,
        reference_image_paths: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> ImageOutput:
        # M1: reference_image_paths ignored (media proxy doesn't accept them
        # yet — scheduled for M2 alongside side/back portraits).
        async with httpx.AsyncClient(timeout=self._timeout_s) as client:
            resp = await client.post(
                f"{self._base_url}/api/image/generate",
                headers={
                    "Authorization": f"Bearer {self._auth_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "prompt": prompt,
                    "model_id": kwargs.get("model_id") or self._default_model_id,
                    "aspect_ratio": kwargs.get("aspect_ratio") or self._default_aspect,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return ImageOutput(
                sourceUrl=data["sourceUrl"],
                modelId=data.get("modelId"),
            )

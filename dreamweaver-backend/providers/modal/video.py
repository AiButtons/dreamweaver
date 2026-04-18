
import asyncio
import base64
import json
from typing import Optional, Any, Dict, List
import httpx
from pydantic import BaseModel

from ..base import VideoProvider
from utils.video_utils import (
    get_dimensions,
    get_frames_from_duration,
    get_camera_prompt,
    get_ltx23_num_frames,
)
from utils.file_upload import upload_base64
from config.settings import settings
from .image import ModalImageProvider # Reuse JWT logic if possible or duplicate

# Reusing the provider structure.
# Since VideoProvider in base.py is very abstract, we define concrete methods here.

# Model IDs routed to this provider.
LTX2_MODEL_IDS = {"ltx2", "ltx-2"}
LTX2_3_MODEL_IDS = {"ltx-2.3", "ltx2.3", "ltx-23"}

LTX23_DEFAULT_NEGATIVE = (
    "static, frozen, blurry, distorted, low quality, artifacts, flickering"
)

LTX23_RETAKE_DEFAULT_NEGATIVE = "blurry, distorted, low quality, artifacts"


class ModalVideoProvider(VideoProvider):
    provider_name = "modal-video"
    supported_models = ["ltx2", "ltx-2", "ltx-2.3"]

    # Shared endpoint (LTX-2 and LTX-2.3 resolve to the same Modal deployment).
    LTX2_ENDPOINT = "https://zennah--zennah-3d-model-generate.modal.run"
    # LTX-2.3 video-to-video region regeneration.
    LTX23_RETAKE_ENDPOINT = "https://zennah--zennah-3d-model-retake.modal.run"
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.modal_api_key
        # We can reuse the image provider's token logic or reimplement/import it
        # To avoid circular imports or messy inheritance if not planned, I'll instantiate a helper or just duplicate the simple JWT logic.
        # Actually, let's inherit from ModalImageProvider to get client/auth logic if it makes sense, 
        # but ModalImageProvider inherits from ImageProvider. Multiple inheritance or Composition?
        # Composition is cleaner.
        self._image_provider = ModalImageProvider(api_key=self.api_key)

    @property
    def client(self) -> httpx.AsyncClient:
        return self._image_provider.client

    def _collect_image_urls(self, request: Dict[str, Any]) -> List[str]:
        """Resolve start/end image fields to a list of public URLs (upload if base64)."""
        image_urls: List[str] = []
        for img_key in ["start_image", "end_image"]:
            img_val = request.get(img_key)
            if not img_val:
                continue
            if img_val.startswith("data:"):
                try:
                    url = upload_base64(img_val, f"video_input_{img_key}.jpg")
                    image_urls.append(url)
                except Exception as e:
                    print(f"Failed to upload {img_key}: {e}")
                    raise ValueError(f"Failed to upload {img_key}")
            elif img_val.startswith("http"):
                image_urls.append(img_val)
        return image_urls

    def _build_full_prompt(self, request: Dict[str, Any]) -> str:
        """Apply camera-movement / slow-motion / audio augmentations to the base prompt."""
        full_prompt = request.get("prompt", "") or ""
        camera_movement = request.get("camera_movement", "static")
        camera_prompt = get_camera_prompt(camera_movement)
        if camera_prompt:
            full_prompt = f"{full_prompt}. {camera_prompt}"
        if request.get("slow_motion"):
            full_prompt = f"{full_prompt}, slow motion"
        if request.get("audio_enabled"):
            full_prompt = f"{full_prompt}, high quality audio"
        return full_prompt.strip(". ")

    async def generate(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate a video using LTX-2 or LTX-2.3 on Modal.

        request: {
            "model_id": str,               # "ltx-2" (legacy) or "ltx-2.3"
            "prompt": str,
            "negative_prompt": str,
            "start_image": str,            # base64 data URI or https URL
            "end_image": str,              # if set on LTX-2.3 → keyframe interpolation
            "aspect_ratio": str,
            "duration": str,
            "camera_movement": str,
            "seed": int,
            "audio_enabled": bool,
            "slow_motion": bool,
            "enhance_prompt": bool,        # LTX-2.3 only
            "num_inference_steps": int,    # LTX-2.3 override (default 30)
            "cfg_guidance_scale": float,   # LTX-2.3 override (default 3.0)
        }
        """
        model_id = (request.get("model_id") or "ltx-2").lower()
        is_ltx23 = model_id in LTX2_3_MODEL_IDS

        image_urls = self._collect_image_urls(request)
        full_prompt = self._build_full_prompt(request)

        if is_ltx23:
            payload = self._build_ltx23_payload(request, image_urls, full_prompt)
        else:
            payload = self._build_ltx2_payload(request, image_urls, full_prompt)

        token = self._image_provider._generate_jwt_token()
        print(f"Calling {model_id} endpoint with payload: {json.dumps(payload, indent=2)}")

        try:
            # LTX-2.3 keyframe interpolation with 257 frames can take longer.
            timeout = 1800.0 if is_ltx23 and payload.get("num_frames", 0) > 200 else 600.0
            response = await self.client.post(
                self.LTX2_ENDPOINT,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
                timeout=timeout,
                follow_redirects=True,
            )
            response.raise_for_status()
            
            # 6. Normalize Response
            # The API returns raw MP4 bytes (based on pipeline/error logs)
            content_type = response.headers.get("content-type", "")
            
            if "application/json" in content_type:
                 data = response.json()
                 if "url" in data:
                     return {"id": f"vid_{request.get('seed', 'rnd')}", "url": data["url"], "thumbnail": image_urls[0] if image_urls else None}
                 elif "video_url" in data:
                     return {"id": f"vid_{request.get('seed', 'rnd')}", "url": data["video_url"], "thumbnail": image_urls[0] if image_urls else None}
                 return data
            else:
                 # Assume binary video content
                 from utils.file_upload import upload_bytes

                 print("   Received binary video content. Uploading to storage...")
                 model_tag = "ltx23" if is_ltx23 else "ltx2"
                 filename = f"{model_tag}_{request.get('seed', 'rnd')}.mp4"

                 # Upload raw bytes
                 video_url = upload_bytes(response.content, filename)

                 print(f"   Video uploaded to: {video_url}")

                 return {
                    "id": f"vid_{request.get('seed', 'rnd')}",
                    "url": video_url,
                    "model": model_id,
                    "thumbnail": image_urls[0] if image_urls else None,
                    "status": "completed"
                }

        except httpx.HTTPError as e:
            print(f"LTX2 Request failed: {e}")
            if hasattr(e, 'response'):
                print(f"Response: {e.response.text}")
            raise

    def _build_ltx2_payload(
        self,
        request: Dict[str, Any],
        image_urls: List[str],
        full_prompt: str,
    ) -> Dict[str, Any]:
        """Legacy LTX-2 payload (32-multiple dims, guidance_scale naming)."""
        negative_prompt = request.get(
            "negative_prompt",
            "low quality, blurry, distorted, watermarks, text, bad composition",
        )
        width, height = get_dimensions(request.get("aspect_ratio", "16:9"))
        num_frames = get_frames_from_duration(request.get("duration", "5"))

        return {
            "image_urls": image_urls if image_urls else None,
            "prompt": full_prompt,
            "negative_prompt": negative_prompt,
            "num_frames": num_frames,
            "frame_rate": 24,
            "width": width,
            "height": height,
            "guidance_scale": 3.0,
            "seed": request.get("seed", 42),
        }

    def _build_ltx23_payload(
        self,
        request: Dict[str, Any],
        image_urls: List[str],
        full_prompt: str,
    ) -> Dict[str, Any]:
        """
        LTX-2.3 payload per docs:
        - dims divisible by 64
        - num_frames must satisfy 8k+1
        - 30 steps, cfg 3.0 recommended
        - 2+ image_urls triggers KeyframeInterpolationPipeline on the server
        """
        negative_prompt = request.get("negative_prompt") or LTX23_DEFAULT_NEGATIVE
        width, height = get_dimensions(request.get("aspect_ratio", "16:9"), strict_64=True)
        num_frames = get_ltx23_num_frames(request.get("duration", "5"))

        payload: Dict[str, Any] = {
            "image_urls": image_urls if image_urls else None,
            "prompt": full_prompt,
            "negative_prompt": negative_prompt,
            "num_frames": num_frames,
            "frame_rate": float(request.get("frame_rate", 24.0)),
            "width": width,
            "height": height,
            "num_inference_steps": int(request.get("num_inference_steps", 30)),
            "cfg_guidance_scale": float(request.get("cfg_guidance_scale", 3.0)),
            "seed": int(request.get("seed", 42)),
            "enhance_prompt": bool(request.get("enhance_prompt", False)),
        }
        return payload

    async def retake(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        LTX-2.3 video-to-video region regeneration. Regenerates [start_time, end_time]
        of a source video from a text prompt; content outside the window is preserved.

        request: {
            "video_url" | "video_data": str,   # one of
            "prompt": str,                      # required
            "start_time": float,                # required, seconds
            "end_time": float,                  # required, seconds
            "negative_prompt": str,
            "num_inference_steps": int,         # default 30
            "cfg_guidance_scale": float,        # default 3.0
            "seed": int,                        # default 42
            "regenerate_video": bool,           # default True
            "regenerate_audio": bool,           # default True
            "enhance_prompt": bool,             # default False
        }
        """
        prompt = request.get("prompt")
        if not prompt:
            raise ValueError("retake requires a prompt")
        if request.get("start_time") is None or request.get("end_time") is None:
            raise ValueError("retake requires start_time and end_time (seconds)")

        # Either a public URL or base64 source video is required.
        video_url = request.get("video_url")
        video_data = request.get("video_data")
        if not video_url and not video_data:
            raise ValueError("retake requires video_url or video_data")

        payload: Dict[str, Any] = {
            "prompt": prompt,
            "start_time": float(request["start_time"]),
            "end_time": float(request["end_time"]),
            "negative_prompt": request.get("negative_prompt") or LTX23_RETAKE_DEFAULT_NEGATIVE,
            "num_inference_steps": int(request.get("num_inference_steps", 30)),
            "cfg_guidance_scale": float(request.get("cfg_guidance_scale", 3.0)),
            "seed": int(request.get("seed", 42)),
            "regenerate_video": bool(request.get("regenerate_video", True)),
            "regenerate_audio": bool(request.get("regenerate_audio", True)),
            "enhance_prompt": bool(request.get("enhance_prompt", False)),
        }
        if video_url:
            payload["video_url"] = video_url
        if video_data:
            payload["video_data"] = video_data

        token = self._image_provider._generate_jwt_token()
        print(f"Calling LTX-2.3 retake endpoint (window {payload['start_time']}–{payload['end_time']}s)")

        try:
            response = await self.client.post(
                self.LTX23_RETAKE_ENDPOINT,
                json={k: v for k, v in payload.items() if k != "video_data"}
                | ({"video_data": video_data} if video_data else {}),
                headers={"Authorization": f"Bearer {token}"},
                timeout=1800.0,
                follow_redirects=True,
            )
            response.raise_for_status()

            content_type = response.headers.get("content-type", "")
            if "application/json" in content_type:
                data = response.json()
                return {
                    "id": f"retake_{request.get('seed', 'rnd')}",
                    "url": data.get("url") or data.get("video_url"),
                    "model": "ltx-2.3",
                    "status": "completed",
                }

            # Binary MP4 response — upload and return URL.
            from utils.file_upload import upload_bytes

            filename = f"ltx23_retake_{request.get('seed', 'rnd')}.mp4"
            uploaded_url = upload_bytes(response.content, filename)
            return {
                "id": f"retake_{request.get('seed', 'rnd')}",
                "url": uploaded_url,
                "model": "ltx-2.3",
                "status": "completed",
            }
        except httpx.HTTPError as e:
            print(f"LTX-2.3 retake failed: {e}")
            if hasattr(e, "response") and e.response is not None:
                print(f"Response: {e.response.text}")
            raise

    async def extend(self, request: Any) -> Any:
        raise NotImplementedError("Extend not supported yet")


import asyncio
import base64
import json
from typing import Optional, Any, Dict, List
import httpx
from pydantic import BaseModel

from ..base import VideoProvider
from utils.video_utils import get_dimensions, get_frames_from_duration, get_camera_prompt
from utils.file_upload import upload_base64
from config.settings import settings
from .image import ModalImageProvider # Reuse JWT logic if possible or duplicate

# Reusing the provider structure. 
# Since VideoProvider in base.py is very abstract, we define concrete methods here.

class ModalVideoProvider(VideoProvider):
    provider_name = "modal-video"
    supported_models = ["ltx2", "ltx-2"]
    
    # Endpoint from product_ad_pipeline.py
    LTX2_ENDPOINT = "https://zennah--zennah-3d-model-generate.modal.run"
    
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

    async def generate(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generates a video using LTX2.
        
        request: {
            "prompt": str,
            "negative_prompt": str, 
            "start_image": str (base64 or url),
            "end_image": str (base64 or url),
            "aspect_ratio": str,
            "duration": str,
            "camera_movement": str,
            "seed": int
        }
        """
        
        prompt = request.get("prompt", "")
        negative_prompt = request.get("negative_prompt", "low quality, blurry, distorted, watermarks, text, bad composition")
        
        # 1. Handle Images (Upload if Base64)
        image_urls = []
        
        for img_key in ["start_image", "end_image"]:
            img_val = request.get(img_key)
            if img_val:
                if img_val.startswith("data:"):
                    # Upload base64
                    try:
                        url = upload_base64(img_val, f"video_input_{img_key}.jpg")
                        image_urls.append(url)
                    except Exception as e:
                        print(f"Failed to upload {img_key}: {e}")
                        # If upload fails, we might just skip it or raise error. 
                        # For now, raise to be safe.
                        raise ValueError(f"Failed to upload {img_key}")
                elif img_val.startswith("http"):
                    image_urls.append(img_val)
        
        # 2. Dimensions & Frames
        width, height = get_dimensions(request.get("aspect_ratio", "16:9"))
        num_frames = get_frames_from_duration(request.get("duration", "5"))
        
        # 3. Prompt Engineering (Camera Movement, Audio, Slow Motion)
        camera_movement = request.get("camera_movement", "static")
        camera_prompt = get_camera_prompt(camera_movement)
        
        full_prompt = prompt
        
        # Inject Camera Movement
        if camera_prompt:
             # Reference pipeline use: prompt + " <sks> " + camera_prompt? 
             # Or just append. User said "camera movement is injected in input prompt"
            full_prompt = f"{full_prompt}. {camera_prompt}"
            
        # Inject Slow Motion
        if request.get("slow_motion"):
            full_prompt = f"{full_prompt}, slow motion"
            
        # Inject Audio (LTX-2 usually video-only, but per request logic)
        if request.get("audio_enabled"):
            full_prompt = f"{full_prompt}, high quality audio"
            
        # 4. Construct Payload (Strictly matching product_ad_pipeline.py structure)
        payload = {
            "image_urls": image_urls if image_urls else None,
            "prompt": full_prompt,
            "negative_prompt": negative_prompt,
            "num_frames": num_frames,
            "frame_rate": 24,
            "width": width,
            "height": height,
            "guidance_scale": 3.0, 
            "seed": request.get("seed", 42)
        }
        
        # 5. Call Endpoint
        token = self._image_provider._generate_jwt_token()
        
        print(f"Calling LTX2 Endpoint with payload: {json.dumps(payload, indent=2)}")
        
        try:
            response = await self.client.post(
                self.LTX2_ENDPOINT,
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
                timeout=300.0, # Video gen is slow
                follow_redirects=True
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
                 # Generate a filename
                 filename = f"ltx2_{request.get('seed', 'rnd')}.mp4"
                 
                 # Upload raw bytes
                 video_url = upload_bytes(response.content, filename)
                 
                 print(f"   Video uploaded to: {video_url}")
                 
                 return {
                    "id": f"vid_{request.get('seed', 'rnd')}",
                    "url": video_url,
                    "thumbnail": image_urls[0] if image_urls else None,
                    "status": "completed"
                }

        except httpx.HTTPError as e:
            print(f"LTX2 Request failed: {e}")
            if hasattr(e, 'response'):
                print(f"Response: {e.response.text}")
            raise

    async def extend(self, request: Any) -> Any:
        raise NotImplementedError("Extend not supported yet")

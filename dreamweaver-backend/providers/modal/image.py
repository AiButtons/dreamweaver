"""
Modal Image Provider - Zennah Image Generation and Multi-Angle Editing

Implements ImageProvider interface for Modal-deployed models with JWT authentication.
"""

import time
import jwt
import httpx
from typing import Optional
from datetime import datetime, timedelta

from ..base import (
    ImageProvider,
    ImageGenerationRequest,
    ImageEditRequest,
    ImageGenerationResponse,
    GeneratedImage,
    ImageSize,
    ProviderError,
)
from config.settings import settings


class ModalImageProvider(ImageProvider):
    """
    Modal image provider for Zennah models.
    
    Endpoints:
    - Image Generation: 1024x768 with steps and guidance control
    - Multi-Angle Edit: Qwen-based consistent angle generation
    """
    
    provider_name = "modal"
    supported_models = [
        "zennah-image-gen",
        "zennah-qwen-edit",
        "zennah-qwen-multiview",
    ]
    
    # Endpoint URLs
    IMAGE_GEN_ENDPOINT = "https://zennah--zennah-image-gen-model-image-inference.modal.run"
    QWEN_EDIT_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"
    MULTIVIEW_ENDPOINT = "https://zennah--zennah-image-edit-multi-angle-model-edit-inference.modal.run"  # Same endpoint as edit
    
    # Default parameters
    DEFAULT_WIDTH = 1024
    DEFAULT_HEIGHT = 768
    DEFAULT_STEPS = 35
    DEFAULT_GUIDANCE = 8.0
    EDIT_STEPS = 45
    EDIT_GUIDANCE = 6.0
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize Modal provider.
        
        Args:
            api_key: Modal API key for JWT generation
        """
        self.api_key = api_key or settings.modal_api_key
        if not self.api_key:
            print("Modal API key not configured - using mock responses")
        self._client: Optional[httpx.AsyncClient] = None
    
    @property
    def client(self) -> httpx.AsyncClient:
        """Lazy initialization of async HTTP client."""
        if self._client is None:
            # 5 minute timeout for image generation (Modal can take 30-90s)
            timeout = httpx.Timeout(300.0, connect=60.0)
            self._client = httpx.AsyncClient(timeout=timeout)
        return self._client
    
    def _generate_jwt_token(self) -> str:
        """Generate JWT token for Modal API authentication."""
        if not self.api_key:
            return "mock-token"
        
        payload = {
            'iat': datetime.utcnow(),
            'exp': datetime.utcnow() + timedelta(hours=24)
        }
        return jwt.encode(payload, self.api_key, algorithm='HS256')
    
    def _extract_steps(self, request: ImageGenerationRequest) -> int:
        """Extract inference steps from request."""
        # Check extra_params first
        if "n_steps" in request.extra_params:
            return int(request.extra_params["n_steps"])
        if "steps" in request.extra_params:
            return int(request.extra_params["steps"])
        return self.DEFAULT_STEPS
    
    def _extract_guidance(self, request: ImageGenerationRequest) -> float:
        """Extract guidance scale from request."""
        if "guidance_scale" in request.extra_params:
            return float(request.extra_params["guidance_scale"])
        if "guidance" in request.extra_params:
            return float(request.extra_params["guidance"])
        return self.DEFAULT_GUIDANCE
    
    async def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        """
        Generate images using Modal Zennah model.
        
        Args:
            request: Image generation request
            
        Returns:
            ImageGenerationResponse with generated images
        """
        self.validate_request(request)
        
        # Build prompt (include camera prompt if provided)
        full_prompt = request.prompt
        if request.camera_prompt:
            full_prompt = f"{request.prompt}. {request.camera_prompt}"
        
        # Extract parameters
        steps = self._extract_steps(request)
        guidance = self._extract_guidance(request)
        
        # If no API key, return mock
        if not self.api_key:
            return self._mock_response(request, full_prompt)
        
        try:
            # Generate JWT token
            token = self._generate_jwt_token()
            
            # Extract width/height from extra_params or use defaults
            width = request.extra_params.get("width") or self.DEFAULT_WIDTH
            height = request.extra_params.get("height") or self.DEFAULT_HEIGHT

            # Build payload
            payload = {
                "prompt": full_prompt,
                "width": width,
                "height": height,
                "n_steps": steps,
                "guidance_scale": guidance,
            }
            
            # Make API call - this will wait for Modal to finish generation
            print(f"Sending request to Modal (model: {request.model_id}, steps: {steps})")
            print("This may take 30-90 seconds depending on steps...")
            
            response = await self.client.post(
                self.IMAGE_GEN_ENDPOINT,
                json=payload,
                headers={"Authorization": f"Bearer {token}"}
            )
            
            print(f"Modal response received (status: {response.status_code})")
            
            if response.status_code != 200:
                raise ProviderError(
                    message=f"Modal API error: {response.text}",
                    provider=self.provider_name,
                    status_code=response.status_code,
                    error_code="API_ERROR",
                )
            
            # Modal returns raw image bytes, we need to upload to S3 or return base64
            # For now, return as base64
            import base64
            image_b64 = base64.b64encode(response.content).decode('utf-8')
            
            created = int(time.time())
            return ImageGenerationResponse(
                id=f"modal-{created}",
                model=request.model_id,
                prompt=full_prompt,
                images=[GeneratedImage(b64_json=image_b64)],
                created_at=created,
            )
            
        except httpx.RequestError as e:
            raise ProviderError(
                message=f"Request failed: {str(e)}",
                provider=self.provider_name,
                error_code="REQUEST_ERROR",
            ) from e
    
    async def edit(self, request: ImageEditRequest) -> ImageGenerationResponse:
        """
        Edit image using Qwen multi-angle model.
        
        Args:
            request: Image edit request (image must be uploaded to S3)
            
        Returns:
            ImageGenerationResponse with edited images
        """
        if not self.api_key:
            return self._mock_response_edit(request)
        
        try:
            # For Qwen edit/multi-view, the image should be a URL
            # If it's base64, we need to upload it first
            image_url = request.extra_params.get("image_url")
            
            if not image_url:
                # Upload base64 image using file upload API
                if request.image and request.image.startswith("data:image"):
                    from utils.file_upload import upload_base64
                    
                    # Upload and get public URL
                    try:
                        image_url = upload_base64(request.image, "input_image.jpg")
                    except Exception as e:
                        raise ProviderError(
                            message=f"Failed to upload image: {str(e)}",
                            provider=self.provider_name,
                            error_code="UPLOAD_FAILED",
                        )
                else:
                    raise ProviderError(
                        message="Multi-view requires image_url or base64 image",
                        provider=self.provider_name,
                        error_code="MISSING_IMAGE",
                    )
            
            token = self._generate_jwt_token()
            
            # Extract parameters
            steps = request.extra_params.get("n_steps", self.EDIT_STEPS)
            guidance = request.extra_params.get("guidance_scale", self.EDIT_GUIDANCE)
            seed = request.extra_params.get("seed", 42)
            
            # Helper to check if model is multi-view
            is_multiview = "multiview" in request.model_id
            
            if is_multiview:
                # Defaults for Multi-View (as per test script)
                lora_scale = request.extra_params.get("lora_scale", 0.9) 
                max_sequence_length = request.extra_params.get("max_sequence_length", 512)
            else:
                # Defaults for Standard Edit (as per pipeline) - Only include if explicitly provided
                lora_scale = request.extra_params.get("lora_scale")
                max_sequence_length = request.extra_params.get("max_sequence_length")
            
            # Construct Prompt
            final_prompt = request.prompt
            
            # Only apply camera/sks logic for Multi-View
            if is_multiview:
                # Check for camera params in extra_params
                azimuth = request.extra_params.get("azimuth")
                elevation = request.extra_params.get("elevation")
                
                if azimuth is not None:
                    # Convert primitive camera angles to Qwen keywords
                    azimuth = float(azimuth)
                    
                    # Normalize azimuth 0-360
                    azimuth = azimuth % 360
                    
                    view_keyword = "front view"
                    if 45 <= azimuth < 135:
                        view_keyword = "right side view" # 90
                    elif 135 <= azimuth < 225:
                        view_keyword = "back view"      # 180
                    elif 225 <= azimuth < 315:
                        view_keyword = "left side view" # 270
                        
                    # Elevation
                    elev_keyword = "eye-level shot"
                    if elevation is not None:
                        elev = float(elevation)
                        if elev > 15:
                            elev_keyword = "high-angle shot"
                        elif elev < -15:
                            elev_keyword = "low-angle shot"
                            
                    # Construct trigger string
                    trigger = f"<sks> {view_keyword} {elev_keyword}"
                    
                    # Prepend if not already present
                    if "<sks>" not in final_prompt:
                        final_prompt = f"{trigger} {final_prompt}"
                    elif view_keyword not in final_prompt:
                        # If user typed <sks> but didn't specify angle, inject it
                        final_prompt = final_prompt.replace("<sks>", f"<sks> {view_keyword} {elev_keyword}")

                # Ensure <sks> is present for this model/LoRA if not already
                if "<sks>" not in final_prompt and lora_scale > 0:
                    final_prompt = f"<sks> {final_prompt}"
            
            payload = {
                "image_url": image_url,
                "prompt": final_prompt,
                "n_steps": steps,
                "guidance_scale": guidance,
                "seed": seed,
            }
            
            # Add optional params if they exist
            if lora_scale is not None:
                payload["lora_scale"] = lora_scale
            if max_sequence_length is not None:
                payload["max_sequence_length"] = max_sequence_length
            
            print(f"Modal Edit Request: Prompt='{request.prompt}' Steps={steps} Guidance={guidance}")
            
            response = await self.client.post(
                self.QWEN_EDIT_ENDPOINT,
                json=payload,
                headers={"Authorization": f"Bearer {token}"}
            )
            
            if response.status_code != 200:
                print(f"   Error response: {response.text[:200]}")
                raise ProviderError(
                    message=f"Qwen edit error: {response.text}",
                    provider=self.provider_name,
                    status_code=response.status_code,
                    error_code="EDIT_ERROR",
                )
            
            # Return as base64
            import base64
            image_b64 = base64.b64encode(response.content).decode('utf-8')
            
            print(f"   Success! Image size: {len(response.content) / 1024:.2f} KB")
            
            created = int(time.time())
            return ImageGenerationResponse(
                id=f"modal-edit-{created}",
                model=request.model_id,
                prompt=request.prompt,
                images=[GeneratedImage(b64_json=image_b64)],
                created_at=created,
            )
            
        except httpx.RequestError as e:
            print(f"   httpx.RequestError: {str(e)}")
            import traceback
            traceback.print_exc()
            raise ProviderError(
                message=f"Request failed: {str(e)}",
                provider=self.provider_name,
                error_code="REQUEST_ERROR",
            ) from e
        except Exception as e:
            print(f"   Unexpected error: {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            raise
    
    def _mock_response(
        self, request: ImageGenerationRequest, full_prompt: str
    ) -> ImageGenerationResponse:
        """Generate mock response for testing."""
        created = int(time.time())
        images = [
            GeneratedImage(
                url=f"https://via.placeholder.com/1024x768?text=Modal+{request.model_id}",
            )
            for _ in range(request.n)
        ]
        return ImageGenerationResponse(
            id=f"mock-modal-{created}",
            model=request.model_id,
            prompt=full_prompt,
            images=images,
            created_at=created,
        )
    
    def _mock_response_edit(self, request: ImageEditRequest) -> ImageGenerationResponse:
        """Generate mock response for edit operations."""
        created = int(time.time())
        images = [
            GeneratedImage(url="https://via.placeholder.com/1024x768?text=Edited")
            for _ in range(request.n)
        ]
        return ImageGenerationResponse(
            id=f"mock-modal-edit-{created}",
            model=request.model_id,
            prompt=request.prompt,
            images=images,
            created_at=created,
        )

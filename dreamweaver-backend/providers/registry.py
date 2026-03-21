"""
Provider Registry - Central hub for managing AI providers.

The registry maps model IDs to their provider implementations,
enabling dynamic provider selection based on the requested model.
"""

from typing import Optional
from .base import ImageProvider, VideoProvider, ProviderError


class ProviderRegistry:
    """
    Central registry for AI providers.
    
    Supports registration of image and video providers,
    with lookup by model ID.
    """
    
    _image_providers: dict[str, ImageProvider] = {}
    _video_providers: dict[str, VideoProvider] = {}
    _model_to_provider: dict[str, str] = {}
    
    @classmethod
    def register_image_provider(cls, provider: ImageProvider) -> None:
        """
        Register an image provider.
        
        Args:
            provider: ImageProvider instance to register
        """
        cls._image_providers[provider.provider_name] = provider
        for model_id in provider.supported_models:
            cls._model_to_provider[model_id] = provider.provider_name
    
    @classmethod
    def register_video_provider(cls, provider: VideoProvider) -> None:
        """Register a video provider."""
        cls._video_providers[provider.provider_name] = provider
        for model_id in provider.supported_models:
            cls._model_to_provider[model_id] = provider.provider_name
    
    @classmethod
    def get_image_provider(cls, model_id: str) -> ImageProvider:
        """
        Get the image provider for a model.
        
        Args:
            model_id: Model identifier (e.g., 'gpt-image-1', 'dall-e-3')
            
        Returns:
            ImageProvider that supports the model
            
        Raises:
            ProviderError: If no provider supports the model
        """
        provider_name = cls._model_to_provider.get(model_id)
        if not provider_name:
            raise ProviderError(
                message=f"No provider registered for model '{model_id}'",
                provider="registry",
                error_code="MODEL_NOT_FOUND",
            )
        
        provider = cls._image_providers.get(provider_name)
        if not provider:
            raise ProviderError(
                message=f"Provider '{provider_name}' not found in registry",
                provider="registry",
                error_code="PROVIDER_NOT_FOUND",
            )
        
        return provider
    
    @classmethod
    def get_video_provider(cls, model_id: str) -> VideoProvider:
        """Get the video provider for a model."""
        provider_name = cls._model_to_provider.get(model_id)
        if not provider_name:
            raise ProviderError(
                message=f"No provider registered for model '{model_id}'",
                provider="registry",
                error_code="MODEL_NOT_FOUND",
            )
        
        provider = cls._video_providers.get(provider_name)
        if not provider:
            raise ProviderError(
                message=f"Provider '{provider_name}' not found in registry",
                provider="registry",
                error_code="PROVIDER_NOT_FOUND",
            )
        
        return provider
    
    @classmethod
    def list_models(cls) -> list[str]:
        """List all registered model IDs."""
        return list(cls._model_to_provider.keys())
    
    @classmethod
    def list_providers(cls) -> dict[str, list[str]]:
        """List all providers and their supported models."""
        result = {}
        for name, provider in cls._image_providers.items():
            result[name] = provider.supported_models
        for name, provider in cls._video_providers.items():
            if name in result:
                result[name].extend(provider.supported_models)
            else:
                result[name] = provider.supported_models
        return result


def get_provider(model_id: str) -> ImageProvider:
    """
    Convenience function to get an image provider for a model.
    
    Args:
        model_id: Model identifier
        
    Returns:
        ImageProvider for the model
    """
    return ProviderRegistry.get_image_provider(model_id)


def initialize_providers() -> None:
    """
    Initialize and register all available providers.
    
    Call this at application startup to ensure all providers
    are available for use.
    """
    # Import and register providers here
    from .openai import OpenAIImageProvider
    from .modal import ModalImageProvider
    
    # Register OpenAI provider
    openai_provider = OpenAIImageProvider()
    ProviderRegistry.register_image_provider(openai_provider)
    
    # Register Modal provider
    modal_provider = ModalImageProvider()
    ProviderRegistry.register_image_provider(modal_provider)
    
    print(f"Registered providers: {list(ProviderRegistry.list_providers().keys())}")
    print(f"Available models: {ProviderRegistry.list_models()}")


from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # API Keys
    openai_api_key: Optional[str] = None
    fal_api_key: Optional[str] = None
    replicate_api_key: Optional[str] = None
    modal_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    google_project_id: Optional[str] = None
    
    # Upload API settings
    upload_api_endpoint: Optional[str] = None
    upload_api_key: Optional[str] = None
    upload_api_key_id: Optional[str] = None
    
    # Application settings
    debug: bool = False
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

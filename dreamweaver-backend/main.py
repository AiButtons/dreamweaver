from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from api.routes import router as api_router
from config.settings import settings
from providers.registry import initialize_providers


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    print(f"🚀 Dreamweaver API starting...")
    print(f"📍 OpenAI API Key configured: {'Yes' if settings.openai_api_key else 'No'}")
    
    # Debug: Print allowed origins
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "https://dreamweaver-s6j9.vercel.app",
    ]
    print(f"🌍 Allowed Origins: {origins}")
    
    # Initialize providers
    initialize_providers()
    
    yield
    # Shutdown
    print("👋 Dreamweaver API shutting down...")


app = FastAPI(
    title="Dreamweaver API",
    description="Visual prompting API for AI image and video generation",
    version="0.1.1",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "https://dreamweaver-s6j9.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix="/api")


@app.get("/")
async def root():
    return {"message": "Dreamweaver API", "version": "0.1.1"}


@app.get("/health")
async def health():
    return {"status": "healthy"}

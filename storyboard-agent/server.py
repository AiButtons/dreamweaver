"""
Custom routes for storyboard-agent service.
"""

from pathlib import Path
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from script_ingest_routes import router as script_ingest_router

GENERATED_DIR = Path(__file__).parent / "generated"
GENERATED_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Storyboard Agent Routes")
app.mount("/generated", StaticFiles(directory=str(GENERATED_DIR)), name="generated")
app.include_router(script_ingest_router)


@app.get("/health")
async def healthcheck():
    return {
        "status": "ok",
        "agentMode": os.getenv("STORYBOARD_AGENT_MODE", "v2_deep"),
    }

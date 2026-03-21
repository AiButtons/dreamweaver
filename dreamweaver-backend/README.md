## Dreamweaver Backend (FastAPI)

Media execution backend used by Dreamweaver frontend and storyboard agent workflows.

### Core endpoints

- `POST /api/image/generate`
- `POST /api/image/edit`
- `POST /api/image/compose` (multi-reference composition)
- `POST /api/video/generate`
- `POST /api/consistency/evaluate` (identity/wardrobe continuity scoring)

### Run

```bash
uv sync
uv run uvicorn main:app --reload --port 8000
```

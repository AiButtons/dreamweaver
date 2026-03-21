---
name: storyboard-local-dev
description: Start, stop, and verify the Dreamweaver local storyboard stack (FastAPI backend in dreamweaver-backend, LangGraph agent service in storyboard-agent, and Next.js frontend in dreamweaver-frontend). Use when the user asks to run local servers, boot the full app stack, or troubleshoot local startup/logging for storyboard development.
---

# Storyboard Local Dev

## Overview

Start the local Dreamweaver storyboard stack with a single command and capture logs/PIDs for debugging.

## Workflow

1. Ensure required env files exist:
- `dreamweaver-backend/.env`
- `dreamweaver-frontend/.env.local`
- `storyboard-agent/.env`

2. Start all local services:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/start_storyboard_local.ps1
```

3. Optional flags:
```powershell
# Start frontend + LangGraph only
powershell -ExecutionPolicy Bypass -File scripts/start_storyboard_local.ps1 -SkipBackend

# Also start Convex local dev process
powershell -ExecutionPolicy Bypass -File scripts/start_storyboard_local.ps1 -IncludeConvex

# Override ports if defaults are occupied
powershell -ExecutionPolicy Bypass -File scripts/start_storyboard_local.ps1 -BackendPort 8010 -LangGraphPort 8124 -FrontendPort 3003
```

4. Stop services started by the launcher:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop_storyboard_local.ps1
```

## Logs And Process Metadata

- Logs are written to `.runlogs/`.
- Process metadata is stored in `.runlogs/storyboard-local-processes.json`.
- Use these files first when startup fails.

## Resources

### scripts/

- `scripts/start_local_stack.ps1`: skill-level wrapper that invokes repo launcher.

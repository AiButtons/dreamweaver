## Dreamweaver Frontend (Bun)

Next.js 16 frontend for Dreamweaver.

- Image/video generation calls FastAPI.
- Generations and storyboard graph state persist in Convex.
- Auth uses Better Auth + Convex.
- Storyboard copilot uses CopilotKit runtime + LangGraph agent service.

## Setup

1. Install deps:
```bash
bun install
```

2. Configure env in `.env`:
```bash
NEXT_PUBLIC_API_URL=http://localhost:8001
NEXT_PUBLIC_CONVEX_URL=<your-convex-url>
CONVEX_DEPLOYMENT=<your-deployment-name>
CONVEX_SITE_URL=<your-convex-site-url>
SITE_URL=http://localhost:3000
BETTER_AUTH_SECRET=<long-random-secret>
LANGGRAPH_STORYBOARD_DEPLOYMENT_URL=http://localhost:8123
LANGSMITH_API_KEY=<optional>
```

3. Generate Better Auth schema for Convex:
```bash
bun run auth:generate-schema
```

4. Run Convex dev backend:
```bash
bun run convex:dev
```

5. Run Next.js app:
```bash
bun run dev
```

## Key paths

- Convex schema/functions:
  - `convex/schema.ts`
  - `convex/storyboards.ts`
  - `convex/approvals.ts`
  - `convex/mediaAssets.ts`
  - `convex/entities.ts`
  - `convex/agentRuns.ts`
  - `convex/generations.ts`
- Better Auth + Convex wiring: `convex/auth.ts`, `convex/auth.config.ts`, `convex/betterAuth/*`
- Better Auth API route: `src/app/api/auth/[...all]/route.ts`
- Convex provider wiring (official): `src/components/ConvexClientProvider.tsx`, `src/app/layout.tsx`
- Copilot runtime route: `src/app/api/copilotkit/storyboard/route.ts`
- Storyboard copilot bridge: `src/components/storyboard/StoryboardCopilotBridge.tsx`
- Storyboard page (Convex-backed graph): `src/app/storyboard/page.tsx`

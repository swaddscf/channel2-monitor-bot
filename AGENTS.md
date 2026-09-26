# Base44 Development Notes

## Run
- `docker compose -f docker-compose.base44.yml up -d` — single `app` service on host port 3000.
- Dev runtime: `pnpm dev` (tsx watch on `server/_core/index.ts`) inside a `node:22-bookworm-slim` container with the repo bind-mounted at `/app`. `NODE_ENV=development` makes the server serve the client via Vite middleware (live reload, unhashed `/src/main.tsx`) — do NOT use the repo's own `docker-compose.yml`/`Dockerfile`; they run the prebuilt `dist/` bundle and freeze edits.
- `ffmpeg`, `python3`, and `yt-dlp` are apt/pip-installed at container start only if missing (needed for real downloads; without them the bot UI works but downloads fail with a clear message).
- Vite host/origin allowances already come from `server/_core/vite.ts` (`allowedHosts: true` in middleware mode) — no extra host config needed.

## Environment
- Secrets (BOT_TOKEN, OWNER_ID, JWT_SECRET) are delivered by the platform to `/run/base44/app.env`, wired as the last `env_file:` in the compose. Never copy values into the repo or compose `environment:`.
- `TELEGRAM_POLLING=1` (set in compose) runs the bot via `getUpdates` long polling — no public HTTPS needed. Only one instance per BOT_TOKEN may run at a time; remove it when deploying with a webhook.
- No database required: state is in-memory/`data/` unless `SUPABASE_DATABASE_URL` is set (Postgres path; `drizzle.config.ts` MySQL/DATABASE_URL is a leftover and unused by the bot).

## Verify
- `curl localhost:3000/healthz` → `{"ok":true,...}`
- `curl localhost:3000/api/telegram/status` → `tokenConfigured` and `ownerConfigured` should be `true`.
- Frontend (Arabic status page) renders at `/`; it only auto-activates the webhook in a production build, never in dev.

## Quirks
- `pnpm install` runs inside the container on first boot only (`node_modules` persists on the bind mount).
- The `[OAuth] OAUTH_SERVER_URL is not configured` warning at boot is expected (Manus-platform login path, unused here).
- `server/_core/*` is generated platform scaffolding; the real app logic lives in `server/telegram/*` and `client/src/pages/Home.tsx`.
- Tests: `pnpm test` (vitest); type check: `pnpm check`.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Backend API for a field-sales "coverage check" form. Salesmen submit a customer
address/location via a form (with photos); the API stores it in MySQL, logs it to
Google Sheets, and — for submissions covering the "FS" (Fiberstar) operator —
forwards it to an external coverage-checking bot service and polls that service
for results. Runtime is Bun; the web framework is Hono.

## Commands

```bash
bun install          # install dependencies
bun run dev           # start dev server with hot reload (src/main.ts)
bun run build          # bundle to dist/main.js (bun build --minify --target bun)
bun run start          # run the built dist/main.js
bun run migrate         # apply pending DB migrations (scripts/migrate.ts)
```

There is no lint script and no test suite/framework configured in this repo.

Configuration is via environment variables (see `.env.dist` for the full list:
`PORT`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `UPLOADS_DIR`, `API_KEY`,
`FS_CHECK_COVERAGE_SPREADSHEET`, `ALL_CHECK_COVERAGE_SPREADSHEET`,
`SERVICE_ACCOUNT_JSON_KEY_FILE`, `FS_CHECK_COVERAGE_BOT_URL`/`FS_CHECK_COVERAGE_BOT_HOST`,
`FS_CHECK_COVERAGE_BOT_API_KEY`, `API_URL`, `APP_ENV`). Only `src/config.ts` reads
env vars with fallback defaults; everything else (cron jobs, Google Sheets calls)
reads `process.env` directly.

## Architecture

The app is intentionally small and largely monolithic — most HTTP logic lives in
one file rather than being split into routers/controllers/services.

- **`src/main.ts`** — creates the MySQL pool (exported as `pool`), builds the Hono
  app, defines every `/api/*` route inline, and exports the Bun server (`{ port, fetch }`).
  It also imports the two cron modules below purely for their side effects
  (`import "../cron/checkCoverageBot"`), which is what actually schedules them.
- **`src/config.ts`** — the only place that reads env vars with defaults.
- **`src/migrations.ts`** — a hand-rolled migration runner (no external migration
  library). `migrate()` contains a **hardcoded, ordered array of migration names**
  that must be updated by hand whenever a migration is added or removed — the
  filesystem in `migrations/` is not scanned. Applied migrations are tracked in a
  `migrations` table by name, each run in its own transaction. `scripts/migrate.ts`
  is the CLI entrypoint (`bun run migrate`), separate from `src/main.ts` so it can
  run standalone without booting the HTTP server.
- **`migrations/*.sql`** — paired `NNN_description.sql` / `NNN_description_down.sql`
  files, executed by naively splitting on `;`. Referenced by name (without `.sql`)
  in the `migrations` array in `src/migrations.ts`.
- **`cron/checkCoverageBot.ts`** and **`cron/checkCoverageStatus.ts`** — `node-cron`
  jobs registered at import time. Both import `pool` back from `src/main.ts`, so
  there's a circular dependency between `main.ts` and `cron/*` by design (main
  creates the pool and imports the cron files for their side effects; the cron
  files import the pool back). `checkCoverageBot.ts` runs every 15 minutes and
  pushes newly-created FS-operator submissions (`checkCoverageBotId IS NULL`) to
  the external coverage bot. `checkCoverageStatus.ts` runs every 5 minutes,
  polls the bot for status on submissions still pending
  (`checkCoverageBotFinish = 0`), and writes results back into both MySQL and the
  FS Google Sheet (matching rows by submission ID in column A).
- **`scripts/fetch-postalcode.ts`** — standalone one-off script (not wired into
  `package.json`) that scrapes Indonesian postal code data from an external site
  and populates the `postal_codes` table, used by the `/api/villages/search` endpoint.
- **`openapi.yaml`** — OpenAPI 3.0 spec for every `/api/*` route, served raw at
  `GET /api/openapi.yaml` and rendered as interactive docs (Swagger UI, loaded
  from a CDN) at `GET /api/docs`. See the workflow rule below — this file must
  stay in sync with `src/main.ts`.

### Request flow for the core endpoint (`POST /api/submit-form`)

1. Validate required fields + coordinates format (`lat,lng` regex).
2. Save uploaded photos (whitelisted by extension) to `UPLOADS_DIR` and insert
   `submissions`/`building_photos` rows inside one MySQL transaction.
3. After commit, best-effort (errors are caught and logged, not surfaced to the
   client): append a row to the "all operators" Google Sheet, and — if `FS` is
   among the selected operators — also append to the FS-specific sheet and POST
   the submission to the external coverage bot (`FS_CHECK_COVERAGE_BOT_HOST`).
   Branch name for the sheet row is derived from the salesman's `branchId`
   (hardcoded id→name mapping in `src/main.ts`).

### Auth model

No user accounts — a single shared `X-API-Key` header (`apiKeyAuth` middleware)
gates admin-ish endpoints (list/get submissions, add/delete salesman, add
building type). Form submission and read-only lookup endpoints (salesman list/search,
building types, villages search) are public.

### Uploads

Photos are written to `UPLOADS_DIR` on local disk (not object storage) and served
back through `/uploads/*` and `/api/submissions/:id/photos/:filename`, both of
which check the extension whitelist and confirm the file is referenced in the DB
before serving it.

## Development Workflow

- **Keep the API docs in sync.** Any time an `/api/*` route in `src/main.ts` is
  added, removed, or its request/response shape changes, update `openapi.yaml`
  to match in the same change (new/changed paths, params, request bodies,
  response schemas). Treat an endpoint change without a matching `openapi.yaml`
  update as incomplete.
- **Every commit needs a Jira issue ID.** Prefix or include the issue key (e.g.
  `IS-10923`) in the commit message, matching the existing history
  (`git log`). Ask for the issue ID if it isn't provided.
- **Summarize and post to Jira.** After finishing a change, write a summary of
  what changed — for a bug fix, include the root cause and the solution — in
  plain Bahasa Indonesia (non-technical, for a non-tech audience) and post it as
  a comment on the relevant Jira issue.

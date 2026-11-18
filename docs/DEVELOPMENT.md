# BEAN Education — Development Guide

## Prerequisites

- Bun (runtime + package manager)
- The dev environment is Linux; the app runs on port 3000 only (platform gateway forwards other ports explicitly).

## Setup

```bash
bun install
cp .env.example .env        # then fill values (DATABASE_URL points at ./db/custom.db)
bun run db:push             # apply prisma schema (uses db push; see caveats)
bun run db:seed             # idempotent catalogue seed (safe to re-run)
bun run dev                 # start dev server (background: logs go to dev.log)
```

## Verification

```bash
bun run lint                # ESLint
```

There is no unit-test runner yet (see roadmap). Feature verification today uses the live dev server plus the E2E scripts in `scripts/e2e-*.ts` (they require the dev server on :3000). E2E fixture PDFs live in `upload/` (local-only, never committed).

## Environment variables

`.env` is git-ignored. Required today: `DATABASE_URL` only. AI credentials are injected by the platform into the server runtime (`z-ai-web-dev-sdk`) — never placed in `.env`, never in client code. `.env.example` documents variable names with placeholders.

## Repository conventions

- Remote: `https://github.com/mrjoker0471/bean-education.git`, branch `main`. Pushes use SSH configured in the dev sandbox (see DECISIONS ADR-008).
- Completed milestones are committed and pushed automatically (Conventional Commits style). Never force-push; never commit failing work without a clear WIP label.
- NEVER commit: `.env*` (except `.env.example`), `*.db`/`*.sqlite*`, `/db/` (database + user uploads), `/upload/`, `/download/`, `/tool-results/`, `/agent-ctx/`, logs, `node_modules`, build output.
- Commit granularity: one coherent verified milestone per push; separate pushes for independent milestones.

## Code conventions

- TypeScript strict typing; all API calls go through `src/lib/api.ts` (no raw fetch in components).
- `z-ai-web-dev-sdk` is server-only — never import it in client components.
- shadcn/ui components from `src/components/ui` are preferred over custom UI.
- Prisma schema lives in `prisma/schema.prisma`; the SQLite file lives under `db/`.
- Prisma primitive list columns are stored as JSON strings (`*Json` fields).

## Known caveats (pre-Phase 2)

- `next.config.ts` has `typescript.ignoreBuildErrors: true` and `reactStrictMode: false`; `tsconfig` has `noImplicitAny: false` — slated for tightening (roadmap Phase 2).
- `prisma db push` script passes `--accept-data-loss` — use deliberately.
- `src/lib/db.ts` logs every SQL query; expect verbose `dev.log` output.
- In-process job state resets on server restart; failed Riishe jobs offer explicit retry.

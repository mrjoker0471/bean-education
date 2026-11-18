# Phase 2A — Database Migrations

## State before Phase 2A

The schema was managed exclusively by `prisma db push` (no migration history, no `_prisma_migrations` table). The Phase 1 audit recorded this as a reproducibility/rollback risk.

## Migration history created in Phase 2A

| Migration | Kind | Contents |
|---|---|---|
| `20261118000000_baseline` | Baseline (marked applied) | Full schema as it existed at the start of Phase 2A (16 models). Generated with `prisma migrate diff --from-empty --to-schema-datamodel <pre-change schema>` and registered with `prisma migrate resolve --applied` — the live database was NEVER rebuilt; the baseline only anchors history. |
| `20261118010000_phase2a_foundation` | Incremental (applied) | `studentId` columns on Attempt/StudyDocument/RiisheTest/RiisheChatTurn (+indexes); Question PYQ provenance columns (`pyqHash`, `sourceRef`, `importedBatchId`, `reviewedBy/At/Note` + indexes); new tables `Student`, `Session`, `StudyGoal`, `PyqImportBatch`, `RiisheJob`, `JobQuota`. Purely additive (ADD COLUMN / CREATE TABLE / CREATE INDEX). |
| `20261118020000_job_payload` | Incremental (applied) | `RiisheJob.payloadJson` for durable run parameters (e.g. force re-analysis). |

Applied with `prisma migrate deploy`; `prisma migrate status` = "Database schema is up to date". The pre-existing database and all stored user documents/analyses were preserved (verified by row counts before/after).

## Safety rules adopted

1. **Backup prerequisite** — every migration session starts with `bun run db:backup` (timestamped copy into `db/backups/`, git-ignored). Phase 2A itself backed up to `db/backups/pre-phase2a-20261118-011709.db` before touching the schema.
2. **No destructive resets** — `prisma migrate reset` remains available but is NOT part of any normal workflow; this milestone ran zero destructive statements (verified: the generated SQL contains only ADD COLUMN / CREATE TABLE / CREATE INDEX).
3. **`--accept-data-loss` removed** — `db:push` no longer carries the flag; migrations (`db:migrate` dev / `db:deploy` deploy) are the standard workflow (`db:status` to verify).
4. **Deterministic + repeatable** — migrations are committed SQL files applied in lexical order; a fresh environment reproduces the schema exactly (`migrate deploy`), while the existing database continues from the baseline anchor.
5. **SQLite compatibility** — all statements are SQLite-supported ALTER/CREATE; no data type changes on existing columns.

## Developer workflow (from now on)

```bash
bun run db:backup          # 1. backup (mandatory prerequisite)
# edit prisma/schema.prisma
bun run db:migrate         # 2. create + apply a migration (dev)
bun run db:status          # 3. verify history is in sync
bun run db:generate        # 4. refresh the Prisma client when needed
```

Never edit an applied migration; create a new one. Never run `migrate reset` against the real database.

# OPS-2 — Backup & Disaster Recovery Foundation

Status: **implemented and proven locally (restic 0.18.0); remote destination, schedule and retention are pending owner approval.**

This document describes the complete backup/restore system delivered by the OPS-2
milestone. It distinguishes — deliberately — between three different states:

| State | Meaning | Status |
|---|---|---|
| **Tested local backup/restore capability** | The toolkit can create an encrypted, integrity-checked backup of an application-shaped data set and restore+verify it into an isolated environment. | ✅ proven (drill evidence below) |
| **Configured remote backup capability** | A real off-site Restic backend (S3/rest/rclone/B2…) has been chosen, credentialed and connected. | ❌ not configured — owner decision pending (no cloud account was created) |
| **Actual scheduled production backups** | A host scheduler runs the toolkit against the production database on a schedule, with notification and retention. | ❌ not scheduled — belongs to OPS-3 after the staging host is selected |

**No production database, no cloud provider and no staging host was touched by this
milestone.** Every run documented here used isolated fixtures or throwaway
repositories under `/tmp`.

---

## 1. Persistent-data inventory (what a backup must contain)

Verified by reading every filesystem read/write in `src/` and every storage-path
reference (OPS-2A). The application has exactly three persistent data roots:

| Root | Resolution | Database reference | Layout |
|---|---|---|---|
| **SQLite database** | `DATABASE_URL` (`file:` scheme). **Relative paths resolve against the Prisma schema directory (`<root>/prisma/`)** — empirically verified against the real Prisma Client runtime, not assumed. Absolute paths are used as-is (production packaged layout: `file:/app/db/custom.db`). | — | SQLite, default journal mode (`delete`) — no WAL is configured anywhere in the codebase |
| **`db/uploads/`** | `<process.cwd()>/db/uploads` | `StudyDocument.storedPath` — **absolute path** on the app host, plus `fileSize` and `contentHash` (sha256 of the exact bytes written at upload time) | `<uuid>.pdf`, mode 0600, immutable after upload |
| **`db/evidence/`** | `<process.cwd()>/db/evidence` | `ExpertCredentialEvidence.storagePath` — **relative filename**, plus `byteSize` and `sha256`; `retentionState` ACTIVE/PURGED | `ev_<hex>.<ext>`, mode 0600 |

Everything else that matters is inside the database: all relational state, DB-backed
sessions (`Session.tokenHash` — session tokens never live outside the DB), LiveKit
usage records, evaluation queues, expert-review audit trails.

**Exclusions (never backed up):**

- `.env` / secret files and provider credentials
- GitHub credentials, cookies (browser-side, not host state), session tokens outside the database
- `db/backups/` — an existing backup repository inside the source tree (recursive re-ingestion risk)
- Logs (`dev.log`, `server.log`, `*.log`), caches, `node_modules`, `.next/` build output, `coverage/`, `/tmp/`
- OCR scratch space (`os.tmpdir()/riishe-ocr-*` — ephemeral by design, always cleaned by the pipeline)
- Generated/rebuildable artifacts generally (the app builds them from Git + config)

**Consistency note discovered during the audit:** uploads are written file-first,
then the DB row (compensating cleanup on failure), and evidence rows flip to PURGED
even when byte deletion failed. The backup toolkit therefore audits the *snapshot
database* against the staged files and fails closed on any broken ACTIVE reference,
while conservatively including orphan bytes (uploads with no row) rather than
omitting data.

---

## 2. Architecture (OPS-2B)

### Coherence model

**Never a plain filesystem `cp` of an actively written SQLite database.** The
database snapshot uses SQLite's own online backup facility — `VACUUM INTO` —
executed on a read-only connection, producing a fresh, compacted,
transactionally consistent database file every time.

The documented primary workflow is an **explicitly offline snapshot**:

1. Gracefully stop the application and background workers (`next-service-dist/server.js`
   and any mini-services; confirm the OPS-1 `/api/healthz` workers are no longer registered).
2. Confirm writers have stopped.
3. Run the backup — the tool enforces the boundary mechanically:
   - the database file must exist;
   - **no `-journal` / `-wal` / `-shm` sidecar may exist** (a sidecar proves a live
     or crashed writer → refuse, fail closed);
   - the operator must pass `--confirm-offline` (the tool never claims zero-downtime safety).
4. Database snapshot (`VACUUM INTO`) + uploads/evidence copies (**triple-hashed**:
   source read → staged copy re-read → SOURCE re-read after staging; all three
   hashes must agree — a corrupted staged copy or the source file mutating
   during the staging window aborts the backup).
   The offline boundary remains the primary coherence guarantee; the triple
   hash substantiates the in-window concurrent-writer detection claim
   (proven by the P7 tests).
5. Manifest built and verified (sha256 sidecar).
6. Snapshot→database coherence audit (see below).
7. Encrypted Restic snapshot of the staging tree.
8. `restic check` (structure; `--verify-data` adds full byte-level verification).
9. Restart the application only when the host operator's workflow explicitly requests it.

**Why offline-first:** an online DB snapshot alone would NOT make concurrent file
uploads/deletions coherent — the file set and the DB could disagree. The offline
boundary plus the coherence audit below is the safe answer; the toolkit refuses to
produce anything less.

### Staging tree layout

```
<stage>/
  manifest.json                  # the verifiable backup manifest
  manifest.json.sha256           # sidecar; proves manifest integrity
  data/
    database/custom.db           # VACUUM INTO snapshot
    files/uploads/<uuid>.pdf     # all upload bytes (orphans included, marked)
    files/evidence/ev_<hex>.<ext># ACTIVE evidence bytes (PURGED leftovers included, marked)
```

### Manifest contract (`bean-backup-manifest/1`)

- `tool` (name/version), `createdAt`, `resticVersion` (exact engine version)
- `database`: file path (relative), `method: "sqlite-vacuum-into"`, source basename,
  sha256, bytes, observed journal mode
- `uploads` / `evidence`: source root (relative), per-file entries `{ name, sha256,
  bytes, dbReferenced }`, counts and total bytes
- `exclusions`: the applied exclusion policy (audit-visible)

The manifest contains **no secrets, no environment values and no absolute host
paths** — it is portable between hosts and safe to store next to the encrypted data.

### Database↔file coherence audit (backup-time, fail closed)

Run against the SNAPSHOT database before anything is sent to the repository:

- every `StudyDocument` row must resolve to a staged upload with **matching basename,
  byte size and content hash** (`contentHash` is the sha256 recorded at upload time);
- every `ACTIVE` `ExpertCredentialEvidence` row must resolve to its staged file with
  matching bytes and the DB-recorded sha256;
- `PURGED` rows may legitimately leave bytes behind (the app's unlink is best-effort);
  those bytes are backed up but not required to exist;
- uploads without a DB row (orphans) are included and marked `dbReferenced: false`.

A broken ACTIVE reference, a mutated file, or a mid-copy change **aborts the backup
with a nonzero exit code** — an incomplete or incoherent backup is never produced.

---

## 3. Commands (OPS-2C)

| package.json script | What it does |
|---|---|
| `bun run ops:backup:init-repo` | **Explicit one-time** Restic repository initialization. Refuses to reinitialize an existing repository. |
| `bun run ops:backup` | Create a verified backup: offline gate → stage → manifest → audit → encrypted snapshot → `restic check` → cleanup. |
| `bun run ops:restore-drill` | Full isolated restore drill (see §4), or `--fault <scenario>` to prove detection of corruption. |
| `bun run ops:retention` | Explicit forget/prune — **owner-approval gated** (see §5). Never called by backup. |
| `bun run db:backup` | Developer pre-migration snapshot (database-only, `VACUUM INTO`, integrity-checked, 0600, `db/backups/<name>-<ts>.db`). Replaced the old plain-`cp` implementation, which violated the OPS-2 consistency standard. This is NOT the disaster-recovery backup. |

### `ops:backup` inputs and flags

- **Repository**: `--repo <dir|rest:…>` or `BEAN_BACKUP_REPOSITORY`. Local directory
  today; `rest:`/`s3:`/`rclone:` backends work without redesign (restic handles them).
- **Password**: `RESTIC_PASSWORD_FILE` (chmod 600, stored **outside the backup source
  tree**) or `RESTIC_PASSWORD_COMMAND`. **Bare `RESTIC_PASSWORD` is refused outright.**
- **Sources**: `DATABASE_URL` (Prisma relative-path semantics documented above);
  `BEAN_BACKUP_UPLOADS_DIR` / `BEAN_BACKUP_EVIDENCE_DIR` overrides when the tool's cwd
  differs from the app's.
- **Flags**: `--confirm-offline` (required), `--verify-data` (full byte-level repo
  verification), `--keep-stage` (forensics), `--allow-in-tree` (strongly discouraged),
  `--restic-bin` / `RESTIC_BIN`, `--stage-parent`.
- **Exit codes**: `0` success · `1` any failed/incomplete stage · `2` usage error.

### Restic engine policy

- Official Restic CLI as an **external host dependency** — never downloaded at
  application runtime.
- **Tested version: restic 0.18.0** (official GitHub release; archive sha256
  `98f6dd8bf5b59058d04bfd8dab58e196cc2a680666ccee90275a3b722374438e` verified against
  the published `SHA256SUMS`).
- Documented minimum: **0.17.0**. The exact binary version is recorded in every
  manifest; versions below the floor are refused.
- Restic child processes receive a minimal environment (PATH/HOME/TMPDIR + restic
  variables only) — parent secrets never leak into restic; all invocations are
  time-bounded; URLs with embedded credentials are redacted from output.

---

## 4. Restore verification (OPS-2D) — the central acceptance requirement

`bun run ops:restore-drill` performs the complete isolated acceptance flow:

1. Builds a **disposable fixture**: a real SQLite database created by the
   repository's current `prisma migrate deploy` chain (all 30 migrations),
   representative relational rows (student → study document → practice test →
   DB-backed session; expert profile → ACTIVE credential evidence → audit event;
   one PURGED evidence row; one orphan upload), fixture PDF/PNG bytes with known
   hashes. **No real user data.**
2. Backs the fixture up through the standard flow into a **throwaway encrypted
   Restic repository** (temp password, written 0600 outside the source tree).
3. `restic check` + `restic check --read-data` (every byte verified).
4. **Mutates the original fixture** (appends bytes to an upload; creates a new
   student/document/upload) — proving step 10 of §6.
5. Restores into a **new, empty, isolated directory** (targets are validated:
   never overlapping live roots, never an existing non-empty directory).
6. Runs the verification battery:
   - manifest present, schema-valid, sha-sidecar-verified;
   - SQLite `PRAGMA integrity_check` = `ok`;
   - SQLite `PRAGMA foreign_key_check` = zero violations;
   - migration history: `_prisma_migrations` (finished, not rolled back) equals the
     `prisma/migrations` chain exactly — plus a `prisma migrate status` CLI gate
     (exit 0 = up to date);
   - every manifest file exists byte-exact; no unexpected extra files;
   - every DB→file reference resolves (basename + bytes + hash, uploads and ACTIVE
     evidence).
7. Reports every check individually; **any failed check fails the drill** (exit 1)
   — a corrupted, truncated, incomplete or interrupted backup is never reported as
   successful.
8. Proves **restore path portability** on clean runs (§4.5): the canonical
   materialization proof at the exact recorded absolute paths and the validated
   remap proof onto a different recovery root, each opening the recovered
   documents and evidence through the application's real file-reading logic in
   a read-only child probe (details in §4.5).
9. Cleans up all temporary data on success unless `--keep` is given.

### Proving failure detection (`--fault`)

| Scenario | Injection | Required outcome |
|---|---|---|
| `corrupt-file` | flip a byte in a restored upload | hash verification fails |
| `corrupt-manifest` | truncate restored `manifest.json` | manifest check fails closed |
| `missing-file` | delete a restored evidence file | presence verification fails |
| `repo-corruption` | corrupt a restic pack file | `restic check` fails; no false success |
| `incomplete-manifest` | snapshot a stage without its manifest (interrupted-staging shape) | restore verification refuses |

With `--fault`, the drill expects detection: exit 0 only when the fault is detected;
if a fault were NOT detected the drill exits 1.

### Recorded evidence (restic 0.18.0, real runs — amendment re-runs)

- Happy-path drill (snapshots `5d34ac62`, then `ea44f230` with the migrate-status
  gate): all steps PASS — fixture (real migration chain 30/30, two
  owners/documents), staging (VACUUM INTO, 1888256-byte DB snapshot + 3 uploads
  [incl. orphan] + 1 evidence), encrypted snapshot, `check --read-data`,
  post-backup mutation, restore, **integrity_check=ok, 0 FK violations, 30/30
  migrations, `prisma migrate status` up to date, 4 files byte-exact, DB
  references verified**, post-mutation isolation, **path-portability:canonical
  (2 documents + 1 evidence opened through the real route handler at the
  recorded root)**, **path-portability:remap (2 rows remapped onto a different
  recovery root, probed through the real route + evidenceFilePath)**, cleanup.
- All five fault scenarios: **detected**, drill exits 0 with
  "never reported as success" evidence (re-run after the amendment:
  corrupt-file / corrupt-manifest / missing-file / repo-corruption /
  incomplete-manifest — all detected, including `restic check` catching a
  damaged pack).
- Operator CLI flow: init-repo → reinit refusal → offline-gate refusal (no
  `--confirm-offline`) → journal-sidecar refusal → full backup with
  `--verify-data` → retention refusal without approval → retention run with the
  approval flag on a throwaway repo (1 snapshot kept, prune completed, post-check passed).
- Unit tests (`tests/unit/ops2-*.test.ts`, fake adapter, hermetic): B1–B16, R1–R13, P1–P8 (path portability).

### Restic restore layout note

Restic stores the original absolute source path inside the snapshot, so
`restore --target T` recreates `<T>/<original-absolute-path>/…`. The drill locates
the restored staging root uniquely (exactly one `manifest.json` + sidecar pair,
bounded-depth search) and falls back to the raw target so a manifest-less snapshot
is reported honestly rather than mis-verified.

---

## 4.5 Restore path portability (OPS-2 amendment)

An independent review found the gap this section closes: verification proved
basename + byte count + content-hash agreement, but not that the **restored
application can actually open the file through its stored path**.

### How the application consumes storage paths (verified by reading every route)

| Store | What is stored | How the app opens it |
|---|---|---|
| `StudyDocument.storedPath` | **absolute path**, baked in at upload time (`<cwd-at-write>/db/uploads/<uuid>.pdf`) | The download route (`/api/materials/[id]/file`) does `stat(doc.storedPath)` + a Range-capable byte read **through the stored string**; the analysis pipeline `readFile`s it and enforces `contentHash`; deletes unlink it; the materials-list orphan sweep compares DB storedPaths against `<runtime cwd>/db/uploads/*` — **a restored app at a different root would eventually sweep restored bytes as orphan debris** if the paths were left unmapped |
| `ExpertCredentialEvidence.storagePath` | **relative filename** (`ev_<hex>.<ext>`) | The app's own `evidenceFilePath()` resolves it against `<runtime cwd>/db/evidence` at every read/purge, with a restricted-store escape guard — inherently portable |

So the evidence store needs no mapping (place bytes at `<app-root>/db/evidence/`
and the app's real access logic works unchanged), while uploads require an
explicit, validated decision. The toolkit supports BOTH documented strategies —
never a silent rewrite of the original backup, the original data, or any live
database:

### Mode canonical — restore into the exact recorded absolute paths

`planCanonicalMaterialization` + `materializeCanonicalFiles` place the restored
upload bytes at precisely the absolute paths the restored database already
expects (the realistic case when a host is re-provisioned at the same layout).
Fail-closed validation: exactly one unambiguous original root across all rows,
absolute paths only, basename↔manifest agreement, **no destination may already
exist** (canonical mode never overwrites an existing byte — the operator must
first make the recorded root genuinely free), and the destination root must
never overlap the restored staging tree, repository, or other protected roots.

### Mode remap — explicit, validated path remapping on the isolated DB copy

`planUploadsRemap` + `applyUploadsRemap` rewrite `StudyDocument.storedPath`
inside the **isolated restored database copy** from the original root to a new
recovery root, row by row (`UPDATE … WHERE id = ? AND storedPath = ?` — exact
old-value guard, one transaction, any row not updating exactly once aborts and
rolls back). Fail-closed validation: single unambiguous root, containment
(prefix escapes and traversal refused), basename↔manifest agreement,
duplicate-destination refusal, recovery-root disjointness from every protected
root (live data, fixture, staging tree, repository, restore target), and a
guard refusing a remap aimed at a database inside the ORIGINAL uploads root.
After remapping, the copy is re-verified: `integrity_check`,
`foreign_key_check`, migration history and DB→file references must all still
pass.

### The portability probe — real application logic, in a child process

Both proofs are verified through a strict read-only child probe
(`scripts/ops/lib/portability-probe.ts`) that imports the application's REAL
code paths — never a re-implementation:

- **Documents**: the actual `/api/materials/[id]/file` route handler is invoked
  with real `NextRequest`s per restored row — ownership check, `stat(storedPath)`,
  full-body 200 + `Content-Length` + sha256 = `contentHash`, plus a
  `bytes=0-9` Range request returning 206 with the correct `Content-Range` and
  byte slice.
- **Evidence**: the app's actual `evidenceFilePath()` resolution (relative
  storagePath against the probe cwd's `db/evidence`, escape guard active) with
  sha256 and byteSize checked against the DB row.

The probe proves the negative cases too: a stored path that cannot be opened
must surface as the route's real 410, and a path that opens but holds different
bytes must be caught by the contentHash contract — a basename-only check cannot
distinguish those on a shared filesystem.

The drill runs both proofs on every clean run (steps `path-portability:canonical`
and `path-portability:remap`): the fixture is built with two owners/documents
(original paths), the canonical proof temporarily preserves the fixture uploads
directory byte-for-byte, materialises the recorded root, probes, then restores
the live bytes and **proves them byte-identical** before continuing; the remap
proof builds a fresh recovery app-data layout (`db/{custom.db,uploads,evidence}`)
at a deliberately different root and probes there. Fault runs exit at their
injected fault and never reach the proofs.

**Remaining boundary (unchanged):** the application itself is untouched — the
toolkit provides the recovery decision, and a production restore still requires
the operator to choose the mode (same-layout host → canonical; new layout →
validated remap against the isolated copy).

---

## 5. Encryption and credential safety

- Repository encryption is **restic's built-in AES256** (client-side; the repository
  is opaque without the password).
- Passwords never travel on command lines; only `RESTIC_PASSWORD_FILE` / `RESTIC_PASSWORD_COMMAND`.
  Bare `RESTIC_PASSWORD` is refused.
- Password files must not be group/other-readable; the toolkit enforces this.
- Automated tests/drills use **temporary random passwords** in private temp dirs,
  deleted after the run. No real credentials were created; **no cloud account was
  created or connected.**
- `.env` and secrets are never staged; the restic child environment is minimal.
- **Owner responsibility:** preserve the repository password **independently of the
  host** (e.g. a company password manager, printed and stored in a safe, or an
  encrypted off-host copy). A lost repository password means every backup inside
  that repository is **cryptographically unrecoverable** — this is recorded as a
  standing risk, not a solvable bug.
- Retention (`forget`/`prune`) is a separate explicit command, gated behind
  `BEAN_BACKUP_RETENTION_APPROVED=true` **and** a policy file. Backup never deletes
  snapshots; restore never deletes snapshots.

### Retention — OWNER APPROVAL REQUIRED

The following policy is **proposed only**. Nothing prunes automatically, and no
scheduler may enable retention without the owner's explicit approval recorded here.

```json
{
  "keepLast": 4,
  "keepDaily": 7,
  "keepWeekly": 4,
  "keepMonthly": 6,
  "keepYearly": 1,
  "rationale": "OWNER APPROVAL REQUIRED — proposed by OPS-2, not approved"
}
```

Implications the owner should weigh before approving:

- `forget` removes snapshot listings per policy; `prune` reclaims the storage.
  Both are irreversible for the removed snapshots.
- Repository credentials double as deletion credentials — anyone with the password
  and repository access can delete history. If that is unacceptable, the off-site
  backend (OPS-3) should provide server-side immutability/object-lock in addition.
- Restore is fully independent of retention: restoring a snapshot never requires
  or triggers pruning.

---

## 6. Off-site storage boundary

No cloud backup destination has been chosen. Therefore:

- **Proven:** backup and restore against temporary **local** Restic repositories.
- **Designed for, not configured:** the repository location is a restic location
  spec — pointing `BEAN_BACKUP_REPOSITORY` at `rest:`, `s3:`, `rclone:` or `b2:`
  backends later requires no application redesign.
- A future remote backend will additionally need: provider credentials (accessible
  to restic only), network egress from the host to the backend, and — recommended —
  server-side immutability/object-lock. These requirements are documented, not created.
- No provider is hard-coded; no personal data is sent to GitHub Actions artifacts
  (backup testing does not run in CI at all — CI gates are unchanged by OPS-2);
  no cloud account or paid service was created.

## 7. Scheduling preparation (OPS-2F) — host-independent, for OPS-3

No production scheduler was installed or configured. When the staging host is
selected (OPS-3), these are the prepared operational recipes:

1. **Daily backup** — a host timer/cron that (a) gracefully stops the app + workers,
   (b) runs `bun run ops:backup --confirm-offline --verify-data`, (c) restarts the app,
   (d) writes a structured log line per stage. The offline window is the recovery-point
   granularity; measure its duration on the chosen host.
2. **Failure notification** — the backup command exits nonzero on any failed stage
   and prints `stage=<name> ok=false`; the scheduler wrapper must (a) capture exit
   code + log, (b) deliver failure AND success-but-degraded notifications to the
   owner's chosen channel (email/IM — owner decision), (c) treat two consecutive
   failures as an incident.
3. **Repository integrity checks** — weekly `ops:backup` is verified by default;
   additionally schedule a periodic full-data verification (`--verify-data`) or a
   standalone `restic check --read-data` run.
4. **Retention execution** — only after the owner approves §5: enable the approval
   flag in the host's secret store, schedule `ops:retention --policy-file … --forget --prune`
   monthly, never more aggressively than the approved policy.
5. **Restore exercises** — schedule `bun run ops:restore-drill` monthly (it is fully
   self-contained) plus a quarterly manual drill into a real staging layout.
6. **Recovery password preservation** — the owner records the repository password
   off-host (§5); the schedule must include a quarterly check that the off-host copy
   still decrypts the repository.
7. **Recovery-point / recovery-time measurement** — record for each scheduled run:
   backup duration, bytes, snapshot id, and the offline window length (RPO); for
   each drill: full restore+verify duration and database size (RTO). OPS-3 should
   publish the measured numbers once the host exists.

---

## 8. Known limitations (honest)

- **Offline-window requirement:** consistent backups require the app + workers to be
  stopped. Online backups are not offered, because concurrent uploads/deletions
  cannot be made coherent with the file snapshot. RPO = backup interval + offline window.
- **Absolute `storedPath`:** `StudyDocument.storedPath` stores absolute paths from
  the app host. Restore verification covers basename + bytes + hash **and** (OPS-2
  amendment, §4.5) actual openability through the application's real file-reading
  logic via the two validated recovery modes (canonical same-layout materialization
  or explicit remap on the isolated copy). The application's storage architecture
  itself is unchanged; a production restore requires the operator to pick the mode.
- **Single-host SQLite:** the toolkit supports the SQLite deployment only and refuses
  non-`file:` DATABASE_URLs. A future PostgreSQL migration (out of scope) would need
  a different backup mechanism.
- **No production backups exist yet:** this milestone proves capability. The three
  states at the top of this document are the authoritative status.

## 9. Verification summary

| Gate | Result |
|---|---|
| New unit tests (`bun test tests/unit/ops2-backup.test.ts tests/unit/ops2-restore.test.ts tests/unit/ops2-path-portability.test.ts`) | 35 pass (B1–B16, R1–R13) + 15 pass (P1–P8 path-portability matrix) |
| Real restore drill (restic 0.18.0, `--read-data`, migrate-status gate) | PASS end-to-end |
| Real fault scenarios ×5 | all detected |
| Path-portability proofs (canonical + validated remap, real route-handler probes) | PASS on every clean drill; probe negatives (route 410 + contentHash mismatch) detected |
| Operator CLI flow (init/gate refusals/backup/retention) | PASS |
| Full existing regression suite | see PR description (unchanged gates; no test weakened) |

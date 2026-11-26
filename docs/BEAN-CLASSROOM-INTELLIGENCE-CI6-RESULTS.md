# BEAN Classroom Intelligence — CI-6 Results: Real Expert Network & Knowledge Activation

> Branch `feat/bean-classroom-intelligence-ci6`, opened from **verified
> `origin/main` = `643d56889c33d8036d3455f6f045efbbf749e28d`** (the PR #48 merge that
> recorded CI-5 COMPLETE). Every claim below was verified in this working session at the
> recorded SHAs; nothing is assumed from memory, and nothing here claims a real expert,
> a real credential, a real verification, a real approval or a real measurement.

## 1. Honest classification up front

**Software readiness: implemented, tested, and published unit-by-unit.**
**Real-world activation: ZERO.** No real expert has applied, no real credential has been
verified, no real reviewer has been activated, no real domain pack has been approved by a
real expert, no real language capability has been measured or approved. The verified
expert count is **0** and the real completed review count is **0** in any production
sense. Every number in `docs/screenshots/ci6-verify/` and in the walkthrough database
comes from clearly-labelled synthetic fixtures in a **disposable** SQLite file — the
production ledgers start genuinely empty, and the reporting surface displays zero where
the real count is zero.

## 2. Baseline and remote verification

- `origin/main` fetched and verified via `git ls-remote`: **`643d56889c33d8…`**
  (exactly the charter's verified starting SHA; `git log` confirms it is the PR #48 merge
  of `chore/ci5-completion-ledger`, so the CI-5 completion record is intact).
- Branch `feat/bean-classroom-intelligence-ci6` created from that SHA; the working tree
  was clean before the first commit.
- The sandbox was reset between sessions: the previously registered deploy key's private
  half was lost. A fresh ed25519 keypair was generated locally and the public key was
  delivered to the owner for registration; all unit commits are made locally in order
  and will be pushed with normal fast-forward pushes the moment push auth is available.
  This is recorded honestly in the ledger (`remoteVerifiedSha: "pending-push"` until
  `git ls-remote` verifies each unit).
- Baseline suite re-run at the base: 1677/0 across 118 files (CI-5 record).

## 3. Unit status CI-6A → CI-6H

| Unit | Scope | Commit | Key evidence |
|---|---|---|---|
| CI-6A | Architecture audit + activation design | `180c377` | `docs/BEAN-CLASSROOM-INTELLIGENCE-CI6-ARCHITECTURE.md` (source-level CI-5 inventory, gap analysis, hard invariants, unit checklist) |
| CI-6B | Real expert application + protected evidence + consent + info requests + withdrawal | `bd5564e` | Migration `20261125180000`; `src/lib/ci/fleet/applications.ts`; routes under `/api/ci5/reviewers/me/{application,evidence,withdraw,info-requests}` + `/api/ci6/domains`; `#/expert-apply` UI; `tests/unit/ci6-expert-applications.test.ts` (20 tests) |
| CI-6C | Independent credential verification workbench | `e53bc8e` | Migration `20261125190000`; `src/lib/ci/fleet/verification.ts`; `/api/admin/ci6/*` routes; Verification tab in the admin panel; `tests/unit/ci6-credential-verification.test.ts` (14 tests) |
| CI-6D | Expert profiles + five distinct capability states | `8481e31` | Migration `20261125200000`; `src/lib/ci/fleet/expert-profiles.ts`; `/api/ci6/experts` + disclosure route; `#/experts`; `tests/unit/ci6-expert-profiles.test.ts` (8 tests) |
| CI-6E | Invitations + recruitment operations | `0f6ca4d` | Migration `20261125210000`; `src/lib/ci/fleet/invitations.ts`; invitation + claim routes; `docs/BEAN-EXPERT-ONBOARDING-OPERATIONS.md`; `tests/unit/ci6-invitations.test.ts` (10 tests) |
| CI-6F | Availability/workload control + workspace completion | `4c421ec` | Migration `20261125220000`; availability gate in `createAssignment`; `/api/ci5/reviewer/availability`; workspace toggle; `tests/unit/ci6-assignment-workspace.test.ts` (6 tests) |
| CI-6G | Honest activation reporting | `5a8fd25` | `src/lib/ci/fleet/reporting.ts`; `/api/admin/ci6/reporting`; reporting grid in the workbench; `tests/unit/ci6-reporting.test.ts` (5 tests) |
| CI-6H | Production readiness + acceptance battery | (this commit) | Full suite 1740/0; migrations green on a fresh DB; production build exit 0 (local, after freeing memory); browser walkthrough with genuine screenshots; CI6-RESULTS.md |

(Ledger commit `4426875` opened the CI-6 ledger entry between CI-6A and CI-6B.)

## 4. Architecture and files changed (delta vs main)

- **Migrations (all additive; word-boundary scanned for DROP/DELETE/UPDATE/RENAME — zero
  matches; all applied clean on a fresh database)**:
  `20261125180000_ci6_expert_applications` (3 columns + 2 tables),
  `20261125190000_ci6_credential_verification` (1 append-only table),
  `20261125200000_ci6_expert_profiles` (6 disclosure columns),
  `20261125210000_ci6_expert_invitations` (1 table, hash-only tokens),
  `20261125220000_ci6_assignment_availability` (1 column).
- **New services** (all behind the narrow structural-DB-view + `*DbFromPrisma` seam):
  `applications.ts`, `verification.ts`, `expert-profiles.ts`, `invitations.ts`,
  `reporting.ts`.
- **Additive widenings**: `REVIEWER_STATUS` (+`WITHDRAWN`), `REVIEWER_EVENT_TYPES`
  (+6 CI-6B types, +`CREDENTIAL_VERIFICATION_RECORDED`, +`INVITATION_CLAIMED`,
  +`AVAILABILITY_CHANGED`), `REVIEWER_TRANSITIONS` (withdrawal only from open
  application states), `applicationInputSchema` (optional detail/consent/invitationId),
  `createAssignment` (availability gate), reviewer routes (availability field).
- **New routes** (13): `ci5/reviewers/me/{application,evidence,evidence/[id],
  withdraw,info-requests/[id]/answer,disclosure}`, `ci5/reviewer/availability`,
  `ci6/domains`, `ci6/experts`, `ci6/invitations/claim`,
  `admin/ci6/{applications,applications/[id],applications/[id]/verification,
  applications/[id]/info-request,evidence/[id],invitations,invitations/[id]/revoke,
  reporting}`; plus the existing apply route's invitation-linkage validation.
- **UI**: `ExpertApplyView` (`#/expert-apply`, 3-step application + status + evidence +
  info requests + withdrawal + disclosure editor), `ExpertDirectoryView` (`#/experts`),
  `Ci6VerificationWorkbench` (Verification tab: invitations + queue + workbench +
  reporting), availability toggle in `Ci5ReviewerWorkspace`. Routes registered in the
  three standard store.ts locations + page.tsx render.
- **No pre-existing file was rewritten**; CI-1→CI-5 behaviour, ledgers and gates are
  intact (regression suites re-run every unit).

## 5. Security and privacy tests (all negative cases covered)

- **No client-supplied privilege anywhere**: forged `verified`, `approved`,
  `humanApproved`, `status`, `verificationStatus`, `approvedDomains` fields are refused
  400 by strict schemas in every new route (tested in ci6-expert-applications,
  ci6-credential-verification, ci6-expert-profiles, ci6-assignment-workspace suites).
- **No self-dealing**: verification by the applicant's own account → 403 (tested);
  CI-5B selfReviewGuard untouched.
- **Pending applicants cannot claim assignments** (409; tested).
- **Invitation security**: raw tokens returned exactly once, sha256-only storage,
  single-use claims (replay 409), lazy expiry, revocation with required reason,
  404 on wrong tokens, 10-per-5-min claim rate limiting (tested).
- **Evidence hygiene**: session-authenticated uploads, magic-byte sniffing (client MIME
  never trusted), 10 MiB cap, 413/415/429 negatives, sha256 recorded, files written
  `0600` under the gitignored restricted store, never on public URLs, metadata-only
  audit payloads, cross-account GET 404 / DELETE 403, purged documents cannot back new
  verification decisions (409), admin streaming requires requireAdmin (401/403/404/410).
- **Public projection privacy**: the directory response is asserted to contain no
  account emails, no `studentId`, no COI text, no verification reasons, no
  `storagePath`, no cwd paths (tested); PRIVATE profiles never listed; unlisting
  removes profiles; expiry/suspension automatically remove eligibility.
- **Verification ≠ qualification ≠ content approval**: verification records never touch
  profile status/scope/verificationStatus (tested); pack approval still requires
  server-computed `qualifiedApproverIds`; language VERIFIED still requires the CI-5E
  reviewer path; TRANSCRIPTION remains structurally refused (regression-tested).
- **Checksum freshness**: the walkthrough itself tripped the guard (assignment created
  without checksum → pack-review refused "never review a version you have not actually
  inspected"), and was completed only after binding the assignment to the exact current
  `packVersion` + `packChecksum` — the guard is proven live.
- Secrets scan across all new files: clean (no credentials, no tokens, no keys).
- `.env`, `db/` remain gitignored; the restricted evidence store lives under `db/`.

## 6. Automated test results (actual)

- Targeted per unit (commands: `bun test --isolate tests/unit/ci6-*.test.ts` + the CI-5
  regression files per unit) — all green before every commit.
- **Full suite at CI-6H: `bun test --isolate` → 1740 pass / 0 fail across 124 files**
  (baseline 1677 + 63 new CI-6 tests; 10,7+ K expect() calls).
- `bunx tsc --noEmit` → exit 0. `bun run lint` (eslint) → exit 0.
- `bunx prisma validate` → valid; `bunx prisma generate` clean.
- **Fresh-database migrations**: `DATABASE_URL=file:/tmp/ci6h-migrate.db bunx prisma
  migrate deploy` → ALL 20 migrations applied successfully (output verified).
- **Production build**: `bun run build` → exit 0 (`.next/standalone/server.js`
  produced). Sandbox note: builds were OOM-killed (exit 137) while the 1.4 GB dev
  server of the other checkout held memory; after stopping it the build completed in
  the foreground. The GitHub Actions `quality` job re-runs the same build per push/PR.

## 7. Browser walkthrough (genuine captures)

Real authenticated browser session (agent-browser driving the production standalone
server on the isolated fixture DB). Sessions were DB-backed; walkthrough sessions were
minted directly in the disposable DB. Captures in `docs/screenshots/ci6-verify/`:

- `wt-expert-status-1440.png` — application status view (ACTIVE reviewer card,
  append-only history, disclosure editor).
- `wt-expert-directory-empty-1440.png` — the public directory showing the HONEST empty
  state ("No listed experts yet … the verified-expert count is genuinely zero today").
- `wt-admin-verification-queue-1440.png` — admin Verification tab (invitations section +
  workbench) on the fixture DB.
- `wt-admin-invitation-reveal-1440.png` — the one-time claim-link reveal
  ("Shown exactly once — copy now").
- `wt-admin-reporting-1440.png` — the activation reporting grid (zero-honouring counts).
- `wt-admin-reviewers-registry-1440.png` — the registry showing the fixture reviewer
  ACTIVE with availability state.
- `wt-admin-language-1440.png` — durable language grid (TRANSCRIPTION unsupported).
- `wt-reviewer-workspace-1440.png` / `wt-reviewer-completed-1440.png` — reviewer
  workspace with availability controls and the completed review history.
- `wt-expert-apply-390.png` / `wt-expert-apply-320.png` / `wt-admin-verification-768.png`
  — responsive captures.
- Responsive overflow checks at 768/390/320: `false` (no horizontal overflow) at all
  three widths. Console error audit performed during bursts; no page errors surfaced.
- The golden path itself was executed end-to-end through the REAL routes (invitation
  created → claimed → application with consent → evidence uploaded (magic-byte
  validated, sha256 recorded) → VERIFIED examination bound to the examined document →
  qualification APPROVED with explicit scope → ACTIVATED → checksum-bound assignment →
  A–F rubric pack review submitted → assignment COMPLETED with `outcomeRef` → pack
  derived VERIFIED **in the disposable fixture DB only**) — with the checksum-freshness
  guard provably refusing an unbound attempt along the way.

## 8. Commit list (branch tip after CI-6H)

```
<CI-6H commit>  feat(ci6h): production readiness — acceptance battery + walkthrough evidence + results doc
5a8fd25  feat(ci6g): genuine expert evidence and honest activation reporting …
4c421ec  feat(ci6f): reviewer availability/workload control + workspace completion …
0f6ca4d  feat(ci6e): expert invitations and recruitment operations …
8481e31  feat(ci6d): expert profiles and capability activation …
e53bc8e  feat(ci6c): independent credential verification workbench …
bd5564e  feat(ci6b): real expert application and onboarding …
4426875  docs(ci6): milestone ledger — bean-classroom-intelligence-ci6 opened …
180c377  docs(ci6a): architecture audit + activation design …
643d568  (base) Merge pull request #48 …
```

The exact final remote SHA is recorded in the ledger after the first successful
`git ls-remote` verification of the push (deploy-key registration pending at the time
of writing — see §2).

## 9. CI workflow status

The repository CI (`.github/workflows/ci.yml`) runs `lint`, `tsc`, `bun test
--isolate`, and the production build on `push` to `feat/**` and on PRs to `main`. The
run for the pushed branch will be verified via the GitHub API and recorded in the
ledger; no CI result is claimed before that verification (owner-visible on GitHub).

## 10. Real verified expert count and real completed review count

**0 and 0.** The only reviewer record in the walkthrough is a clearly-labelled fixture
in a disposable database. Production remains genuinely empty until real experts are
recruited through the documented operational flow (`docs/BEAN-EXPERT-ONBOARDING-OPERATIONS.md`)
and independently verified by authorised administrators.

## 11. Capabilities still IN_REVIEW / LIMITED / UNSUPPORTED

- All production **domain packs remain `IN_REVIEW`** (CI-5 state; nothing changed).
- All **language capabilities remain unmeasured/`LIMITED`** (CI-5 state; nothing changed).
- **`TRANSCRIPTION` remains structurally `UNSUPPORTED`** at every layer (re-verified by
  regression tests in this branch).
- Expert benchmark metrics remain unpublished (honest zero-measurement state).

## 12. Known issues and remaining operational actions

1. **Deploy-key re-registration** (sandbox reset): the new ed25519 public key must be
   registered by the owner; pushes follow immediately after, in commit order, as
   normal fast-forwards, each verified by `git ls-remote`.
2. **PR + merge are owner-controlled** as usual; the branch carries exactly the CI-6
   commits over `643d568`.
3. **Sandbox build memory**: `next build` was OOM-killed while the other checkout's dev
   server held memory; it completes after stopping that server (or in CI). Recorded
   here for reproducibility.
4. **Real-world activation remains outstanding**: recruit genuine experts (ops guide
   §2), verify credentials independently (§4), let qualified experts produce genuine
   pack/language/benchmark evidence — the reporting surface will display the real
   counts as they genuinely become non-zero.
5. Invitation delivery is deliberately manual (no email infrastructure); administrators
   copy the one-time secure link and share it through their own channel.

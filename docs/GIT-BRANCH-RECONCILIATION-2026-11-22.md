# One-Time Global Branch Reconciliation — 2026-11-22

Record of the coordinated repository-maintenance operation that resolved the
repository-wide behind/diverged branch problem. Policy going forward lives in
[docs/GIT-BRANCH-HYGIENE.md](./GIT-BRANCH-HYGIENE.md); this document is the
evidence of what was done and why it was safe.

## Constraints honored

- `main` was never modified by this operation (start and end SHA identical).
- No force-push, `reset --hard`, history rewrite, branch deletion, or PR
  merge/close. Every push was a normal fast-forward.
- The protected local-only commit `f127b79` (sandbox working environment) was
  untouched — it lives only in the local sandbox checkout, never on GitHub.
- All reconciliation work ran in an isolated worktree with an isolated SQLite
  database; the main checkout and its DB were never touched.

## Before / after

`origin/main` at start and end: `f80b6869941db40e0d85bd7d779617505e79746e`.

| Branch | Before (ahead/behind) | Before SHA | After SHA | After (ahead/behind) | Action |
|---|---|---|---|---|---|
| feat/bean-institution-career-phase-7 | 7 / 36 | e695c66 | ba0f75a | 8 / 0 | merged origin/main in (merge commit ba0f75a) |
| feat/bean-riishe-phase3f-learning-continuity | 1 / 2 | a9e8694 | 65d3286 | 2 / 0 | merged origin/main in (merge commit 65d3286) |
| feat/bean-learn-phase-2a | 0 / 73 | 753f6d5 | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-learn-phase-2b | 0 / 17 | 78688f5 | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-live-classroom-phase-5 | 0 / 53 | 8ef7ef9 | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-personal-learning-intelligence | 0 / 13 | c37b452 | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-phase7-ui-completion | 0 / 21 | b010f9b | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-riishe-phase3a-deep-research | 0 / 13 | 0e48a1c | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-riishe-phase3c-advanced-tutor | 0 / 6 | ede34a4 | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-riishe-phase3d-conversation-continuity | 0 / 3 | ead9c22 | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-riishe-phase3e-interactive-learning-studio | 0 / 2 | 2ae966c | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-teach-marketplace | 0 / 58 | f3be4ee | f80b686 | 0 / 0 | fast-forwarded to main |
| feat/bean-trust-quality-phase-6 | 0 / 46 | 0a3f9f2 | f80b686 | 0 / 0 | fast-forwarded to main |
| fix/bean-education-phase3b-hardening | 0 / 8 | c33d80f | f80b686 | 0 / 0 | fast-forwarded to main |

Final verification was done against the actual GitHub refs via
`git ls-remote` (not stale local tracking refs), and re-confirmed by
`scripts/branch-health.mjs`: 12 branches IN SYNC, 2 AHEAD-ONLY (the two
merge commits above), zero behind.

## PR inventory

All 18 PRs (#1–#18) are merged — each has a "Merge pull request #N" commit in
`main`'s history (f573b54/1b57633/#1 … f80b686/#18). Branch-head ↔ PR-head
association was proven from `refs/pull/N/head` SHAs captured via `ls-remote`
(the GitHub REST API was rate-limited for this IP, so open/closed labels come
from merge-commit evidence). No PR was merged or closed by this operation.
Fast-forwarding a merged branch's ref does not change the PR's merged state.

## The 7 institution/career commits — proof they were unique and are preserved

`feat/bean-institution-career-phase-7` (7 ahead / 36 behind, merge base
`24d4ffa` = its merged PR #6 head) carried 7 commits authored 2026-11-19
after PR #6 merged and before PR #7 merged:

`adc3641` (fix api: admin career list paths, invitation revoke, assignment/group lifecycle, credential issue/revoke routes), `d638fd5` (institution workspace workflows), `8a1c478` (student career portfolio), `88f2408` (opportunity and employer workflows), `91be1fb` (institution and career admin centers), `0a74947` (phase 7 ui route tests), `e695c66` (docs).

Uniqueness proof: `git cherry origin/main <branch>` reported all 7 as not
patch-equivalent (`+`), and main lacked files they add entirely
(`docs/PHASE7_UI_COMPLETION.md`, `tests/unit/phase7-ui-admin-routes.test.ts`,
`tests/unit/phase7-ui-institution-routes.test.ts`,
`src/app/api/organizations/[id]/invitations/[invitationId]/revoke/route.ts`,
`src/app/api/career/credentials/[credentialId]/revoke/route.ts`). Main even
documented one of these gaps in code ("There is no revoke endpoint yet" in
`institution-org-view.tsx`). Therefore the branch was merged with
`origin/main` (merge commit `ba0f75a`, parents `e695c66` + `f80b686`), not
fast-forwarded.

Conflict resolution (per current intended implementation — main's phase-7 UI
completion via PR #7 supersedes the branch's parallel attempt of the same
milestone, and phases 3A–3E build on it):

- 5 diverged API route files and 10 diverged UI views: took main's versions
  (later refinements of the same endpoints/workflows — stricter status
  validation, ISO-mapped DTOs, transactional lifecycle with recovery verbs).
- `src/lib/api.ts`: main's version plus re-added the 3 client helpers whose
  routes survive the merge (`revokeInvitation`, `issueCredential`,
  `revokeCredential`).
- `worklog.md`: union merge, both milestone sections kept.
- `src/lib/institution-schema.ts`: removed one of two byte-identical
  auto-merged `groupUpdateSchema` declarations.
- Branch-only additions kept: the 2 revoke routes, `credentialRevokeSchema`,
  the 2 test suites, the docs file.
- The preserved test suites were aligned to main's route contracts
  (NextRequest helpers, bare filter = unfiltered queue, 400 for illegal
  assignment transitions, `_count` include in the group fake, DRAFT→ARCHIVED
  now legal with the ACTIVE recovery verb). Route behavior was not changed.

The 3F branch merge (`65d3286`, parents `a9e8694` + `f80b686`) was
content-clean: main's two extra commits are merge commits whose trees equal
branch tips already in 3F's ancestry, so the merged tree is byte-identical to
`a9e8694`'s tree (verified by `git rev-parse <commit>^{tree}`).

## Verification

On the merged institution/career tree (isolated SQLite DB, main checkout
untouched): `bunx tsc --noEmit` clean; `bun run lint` clean; `bun test`
1063 pass / 0 fail (73 files). On the 3F merge tree: `bun test` 1065 pass /
0 fail (74 files, includes the 3F migration test which deploys the full
migration chain to a throwaway DB). GitHub Actions status could not be
queried during this window (the REST API was rate-limited for this IP); the
pushes may have triggered CI on the affected branches — check the Actions
tab for the actual run status (the workflow is the `.github/workflows/ci.yml`
introduced with the Phase 3B.1 hardening, merged via PR #15).

## Prevention

The drift problem is prevented by the policy in
[docs/GIT-BRANCH-HYGIENE.md](./GIT-BRANCH-HYGIENE.md) and made checkable with
the read-only `scripts/branch-health.mjs` helper (fetch → ls-remote →
classify → report; never mutates refs).

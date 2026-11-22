# Milestone Ledger — permanent commit accounting

This ledger is the repository's permanent record of every approved milestone and
where its commits live. It exists because milestones were previously left
behind on local or feature branches between sessions; that must never happen
again.

**The two rules this ledger enforces:**

1. **A local commit is not a published commit.** A milestone is not done until
   its commits are verified on a remote feature branch (`git ls-remote`).
2. **A published commit is not an integrated commit.** The tooling must always
   distinguish a commit being present on a remote feature branch from it being
   an ancestor of `main`. Only ancestry (or a MERGED PR with a verified merge
   commit) counts as integration.

## Machine-readable record

`docs/milestone-ledger.json` is the source of truth. One entry per milestone.
Every commit is accounted for exactly once. Fields:

| Field | Meaning |
|---|---|
| `id` | Stable milestone identifier (also used by the gate) |
| `branch` | Dedicated feature branch (null for audit-only milestones) |
| `baseMainSha` | `origin/main` SHA the branch was cut from |
| `commits` | Feature-branch commit SHAs carrying the approved work (not merge commits) |
| `remoteFeatureSha` | Branch tip verified via `git ls-remote` after push |
| `pushVerifiedAt` | Timestamp of that independent verification |
| `pr` | PR number/state (`NONE` \| `OPEN` \| `MERGED`) and URL |
| `mergeCommitSha` | The merge commit that integrated the milestone |
| `ci` | Actions run IDs + conclusions for the milestone commits |
| `finalMainSha` | `origin/main` SHA after the merge |
| `syncStatus` | Feature branch vs main after the merge (`PENDING` \| `SYNCHRONIZED`) |
| `status` | `IN_PROGRESS` \| `PUSHED` \| `PR_OPEN` \| `MERGED` \| `COMPLETE` |

Unknown historical values (pre-ledger milestones) are recorded as `null` with
an explanatory `ciNote`/`evidence` — never guessed. The Phase 3F-through-PR-#22
entries carry run IDs and SHAs verified during the 2026-11-22 close-out.

## Milestone completion gate

`scripts/branch-health.mjs --gate <milestone-id>` refuses to let a milestone be
reported COMPLETE when any of the following is true:

- Approved changes remain uncommitted (dirty working tree).
- Commits exist only locally (HEAD not pushed — remote tip ≠ local tip).
- A push has not been independently verified (`git ls-remote` evidence).
- A required PR is still open/unresolved (checked via `gh` when available;
  otherwise reported as an explicit manual verification step — never assumed).
- Required CI is pending or failing (same availability rule).
- A commit is missing from the published integration history (not an ancestor
  of `origin/main` after the merge).
- Required synchronization checks have not completed (any branch behind main,
  divergent, unprovable, or unmerged ahead-only work outstanding).

The gate exits non-zero and prints the exact outstanding items. It is
read-only: it never pushes, merges, deletes, rewrites or updates anything.

## Current ledger (summary)

| Milestone | Branch | PR | Merge commit | Status |
|---|---|---|---|---|
| Phase 1 — audit | — | — | — | COMPLETE (read-only) |
| Phase 2A | feat/bean-learn-phase-2a | #1 | `1b57633` | COMPLETE |
| Phase 2B | feat/bean-learn-phase-2b | #2 | `f573b54` | COMPLETE |
| Phase 4A — teach | feat/bean-teach-marketplace | #3 | `4dbc4d0` | COMPLETE |
| Phase 5 — live classroom | feat/bean-live-classroom-phase-5 | #4 | `aefd4d9` | COMPLETE |
| Phase 6 — trust | feat/bean-trust-quality-phase-6 | #5 | `f162ff4` | COMPLETE |
| Phase 7 — institution/career | feat/bean-institution-career-phase-7 | #6 | `129ab09` | COMPLETE |
| Phase 7 — UI completion | feat/bean-phase7-ui-completion | #7 | `26dd3b8` | COMPLETE |
| Phase 3A — deep research | feat/bean-riishe-phase3a-deep-research | #8 | `716d55f` | COMPLETE |
| Phase 3B (+3B.1) | feat/bean-personal-learning-intelligence | #14 | `ec1f8a8` | COMPLETE |
| Phase 3C — advanced tutor | feat/bean-riishe-phase3c-advanced-tutor | #16 | `65f30bd` | COMPLETE |
| Phase 3D (+3D.1) | feat/bean-riishe-phase3d-conversation-continuity | #17 | `ba144c0` | COMPLETE |
| Phase 3E — studio | feat/bean-riishe-phase3e-interactive-learning-studio | #18 | `f80b686` | COMPLETE |
| Phase 3F — continuity | feat/bean-riishe-phase3f-learning-continuity | #19 | `e5d4165` | COMPLETE |
| Branch hygiene | chore/git-branch-hygiene | #21 | `d3b39f6` | COMPLETE |
| Branch-health fix | fix/branch-health-runtime-compat | #22 | `e93cdef` | COMPLETE |
| Phase 3G — graded recall | feat/bean-riishe-phase3g-next-milestone | #23 | `806c835` | MERGED (ledger-sync commits preserved on the branch behind PR #24; branch synchronized to main) |
| Phase 3H — history & retention | feat/bean-riishe-phase3h-history-retention | — (pending owner PR) | — | PUSHED (tip `80a9565`, CI 44999716363 SUCCESS) |

Pre-ledger entries (`commits: []`, `ci: []` + notes) document only what is
verified from main's merge history; nothing is inferred.

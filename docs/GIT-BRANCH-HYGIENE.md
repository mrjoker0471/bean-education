# Git Branch Hygiene Policy

This policy exists because the repository repeatedly accumulated feature
branches that drifted behind `main` (one audit found 13 branches behind by
2–73 commits, one of them 7 commits diverged). Drifted branches make PRs
unreviewable, break CI baselines, and risk losing unique work. Follow this
document for every milestone.

## The rules

1. **Start every new milestone from the latest `origin/main`.**
   Cut feature branches with `git fetch origin && git switch -c
   feat/<milestone> origin/main`. Never start from another historical feature
   branch — historical branches must not be used as the starting point for
   unrelated future milestones.

2. **Verify the base before coding.** Record both the feature branch's base
   SHA and the current `origin/main` SHA (e.g. `git rev-parse origin/main`,
   `git ls-remote origin refs/heads/main`) before the first commit. If they
   differ from what you expected, stop and investigate before writing code.

3. **Check whether `main` advanced before every push.** Run
   `git fetch origin` and compare: `git rev-list --count
   origin/main..<your-branch>` (ahead) and `git rev-list --count
   <your-branch>..origin/main` (behind).

4. **If `main` advanced, synchronize before final verification.** Merge
   `origin/main` into the feature branch (a normal merge commit), resolve
   conflicts in favor of the current intended implementation, and re-run the
   full verification suite (typecheck, lint, tests) before pushing. Never
   push a branch that is behind `main`.

5. **Never overwrite unique commits.** No `git push --force`,
   `--force-with-lease`, `git reset --hard`, or history rewriting. If a
   branch carries commits that are not in `main` (check with
   `git log --oneline origin/main..<branch>` and
   `git cherry origin/main <branch>`), they are preserved — merge, don't
   discard. If a branch cannot be reconciled safely, stop and report the
   blocker instead of sacrificing commits.

6. **Every milestone ends with a remote SHA verification.** After pushing,
   confirm with `git ls-remote origin refs/heads/<branch>` that the remote
   SHA equals your local HEAD, and run an ahead/behind comparison. A branch
   must not be described as fully synchronized until its remote comparison
   proves `behind = 0`.

7. **Push with normal fast-forward operations only.** `git push origin
   HEAD:refs/heads/<branch>` where the remote tip is the first parent (or an
   ancestor) of the new commit. If a push would require a force flag, the
   situation is out of policy — stop and review.

8. **Merged branches stay, but they must not drift.** After a PR merges,
   fast-forward the branch to `main` (safe when `ahead = 0`: the tip is an
   ancestor of `main` and a normal `git push origin <main-sha>:refs/heads/<branch>`
   updates it without force). Do not delete branches or close PRs without
   explicit authorization.

## The read-only helper

`scripts/branch-health.mjs` proves the current state of every remote branch
in one command. It fetches, reads the actual refs GitHub serves
(`git ls-remote`), compares each branch against `origin/main`, and
classifies it — it never pushes, merges, deletes, or rewrites anything:

```sh
bun scripts/branch-health.mjs            # fetch + report
bun scripts/branch-health.mjs --no-fetch # report from the last fetch
bun scripts/branch-health.mjs --json     # machine-readable output
```

Classifications and the required action:

| Classification | Meaning | Action |
|---|---|---|
| `IN SYNC` | branch == origin/main | none |
| `AHEAD-ONLY` | normal in-flight feature branch (behind = 0) | finish the milestone, open the PR |
| `FAST-FORWARD CANDIDATE` | ahead = 0, behind > 0, ancestry proven | advance with a normal push of the main SHA (no force) |
| `DIVERGENT` | ahead > 0 and behind > 0 | merge `origin/main` into the branch, verify, push normally |
| `UNPROVABLE` | objects missing locally / ancestry unproven | run a fetch; if it persists, review manually |

Run it before starting a milestone, before every push, and at the end of
every milestone. The hygiene condition is met only when the report shows
zero branches behind `origin/main`.

## The permanent milestone publication lifecycle (mandatory)

A milestone is not finished when the code works locally. It is finished when
GitHub is in a verified state. **A local commit is not a published commit; a
successful local test is not a successful GitHub CI run.** Every milestone —
this one and every future one — MUST walk this lifecycle in order:

1. Freshly fetch origin and verify the exact `origin/main` SHA
   (`git ls-remote origin refs/heads/main`).
2. Create a dedicated feature branch from that verified SHA.
3. Implement the approved scope (audit first, minimal targeted changes).
4. Run all required checks (typecheck, lint, full test suite, build).
5. Commit all approved milestone changes — nothing approved stays uncommitted.
6. Push the branch with a normal push (no force, ever).
7. Verify the remote branch tip independently: `git ls-remote origin
   refs/heads/<branch>` must equal the local HEAD.
8. Record the milestone in `docs/milestone-ledger.json` (commit SHAs, remote
   SHA, push verification timestamp).
9. Open exactly one PR to `main` (unless an equivalent PR already exists).
10. Wait for the PR's real CI result — verify run IDs and conclusions.
11. Merge through the authorized normal GitHub workflow when required checks
    pass and permissions permit. If no authorized PR operation is available,
    STOP at that gate and report the precise manual action required — never
    fabricate a PR, a merge or a CI result.
12. Verify the merge commit AND every feature commit are ancestors of the new
    `origin/main`.
13. Re-run the branch report; fast-forward eligible behind-only branches per
    rule 8 (small batches, independently verified).
14. Update the ledger (PR state, merge commit, CI runs, final main SHA,
    sync status) and the milestone documentation.
15. Run `bun scripts/branch-health.mjs --gate <milestone-id>` — it must PASS
    before the milestone may be declared COMPLETE anywhere.

## The commit ledger

`docs/milestone-ledger.json` is the permanent, machine-readable record (see
`docs/MILESTONE-LEDGER.md` for the field reference and summary). Every
approved commit is accounted for exactly once. The ledger distinguishes
three states for every commit:

- **local only** — exists on a local branch; not published (never acceptable
  at a milestone boundary);
- **published on a feature branch** — verified on the remote branch via
  `ls-remote`, but NOT yet integrated;
- **integrated** — an ancestor of `origin/main` (verified with
  `git merge-base --is-ancestor`).

## The milestone completion gate

```sh
bun scripts/branch-health.mjs --gate <milestone-id> [--json]
```

The gate refuses COMPLETE (exit 1, with the exact outstanding items) when any
of these hold:

- the working tree has uncommitted changes;
- the local HEAD is not pushed (remote tip ≠ local tip, or the branch is
  missing on the remote);
- a remote feature branch carries commits missing from main (ahead-only
  work), is behind main (synchronization debt), or is divergent/unprovable;
- the ledger's claimed commits / merge commit are not ancestors of the live
  `origin/main`, or its `finalMainSha` no longer matches;
- the milestone's PR is open/unresolved;
- required CI is pending or failing — verified through `gh` when available;
  otherwise reported as an explicit MANUAL item that keeps the gate open.

The gate is read-only. It never pushes, merges, deletes, rewrites, or force-
updates anything; it only proves state and refuses to bless an unfinished
milestone.

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

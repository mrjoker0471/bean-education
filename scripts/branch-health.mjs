// branch-health.mjs — read-only branch hygiene reporter + milestone gate.
//
// Purpose: prove, at any moment, how every remote feature branch compares to
// origin/main so the divergence problem documented in docs/GIT-BRANCH-HYGIENE.md
// cannot silently return. See that document for the policy this script enforces.
//
// What it does (READ-ONLY — never pushes, merges, deletes, or rewrites refs):
//   1. `git fetch origin --prune` (skipped with --no-fetch) — updates LOCAL
//      remote-tracking refs only; it never modifies GitHub branches
//   2. Reads the ACTUAL refs from GitHub via `git ls-remote` (not stale
//      remote-tracking refs, so the report cannot lie after a manual push)
//   3. For every remote branch except main: computes ahead/behind vs the
//      fetched origin/main, verifies ancestry, and classifies the branch
//   4. Prints a table + summary; exits 0 normally, 2 on internal errors
//
// Milestone completion gate (--gate <milestone-id>): refuses to let a
// milestone be reported COMPLETE when approved changes are uncommitted,
// commits exist only locally, pushes/PR/CI claims are unverified, commits are
// missing from the published integration history, or synchronization checks
// have not completed. Read-only; see docs/MILESTONE-LEDGER.md.
//
// Usage:
//   bun scripts/branch-health.mjs            # fetch + report
//   bun scripts/branch-health.mjs --no-fetch # report from last fetch
//   bun scripts/branch-health.mjs --json     # machine-readable output
//   bun scripts/branch-health.mjs --gate <milestone-id> [--json]
//
// Classification:
//   IN SYNC                 branch == origin/main (behind=0, ahead=0)
//   AHEAD-ONLY              behind=0, ahead>0  (normal feature branch; ready for PR)
//   FAST-FORWARD CANDIDATE  ahead=0, behind>0 AND branch tip proven an ancestor
//                           of main (safe to advance with a normal push of main)
//   DIVERGENT               ahead>0 AND behind>0 (needs origin/main merged into
//                           the branch; unique commits must be preserved)
//   UNPROVABLE              ahead=0, behind>0 but ancestry could not be proven
//                           locally (objects missing) — treat as manual review

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const args = process.argv.slice(2)
const doFetch = !args.includes('--no-fetch')
const asJson = args.includes('--json')
const gateIdx = args.indexOf('--gate')
const gateMode = gateIdx >= 0
const gateId = gateMode ? args[gateIdx + 1] : null
const REMOTE = 'origin'
const MAIN = 'main'

function git(repoArgs, opts = {}) {
  return execFileSync('git', repoArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  }).trim()
}

function fail(msg) {
  if (asJson) console.log(JSON.stringify({ error: msg }, null, 2))
  else console.error(`branch-health: ${msg}`)
  process.exit(2)
}

if (doFetch) {
  try {
    git(['fetch', REMOTE, '--prune'])
  } catch (err) {
    fail(`git fetch failed: ${err.message.split('\n')[0]}`)
  }
}

// Source of truth: the refs GitHub actually serves right now.
let remoteHeads
try {
  const out = git(['ls-remote', '--heads', REMOTE])
  remoteHeads = out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha, ref] = line.split('\t')
      return { sha, branch: ref.replace('refs/heads/', '') }
    })
} catch (err) {
  fail(`git ls-remote failed: ${err.message.split('\n')[0]}`)
}

const mainEntry = remoteHeads.find(h => h.branch === MAIN)
if (!mainEntry) fail(`remote ${REMOTE} has no ${MAIN} branch`)
const mainSha = mainEntry.sha

// Make sure the fetched pack actually contains both tips (needed for
// rev-list/merge-base). After a successful fetch this always holds.
try {
  git(['cat-file', '-e', `${mainSha}^{commit}`])
} catch {
  fail(`fetched main ${mainSha} is not present locally — run without --no-fetch`)
}

const rows = []
for (const head of remoteHeads) {
  if (head.branch === MAIN) continue
  const row = { branch: head.branch, sha: head.sha, main: mainSha, ahead: null, behind: null, classification: null }
  try {
    git(['cat-file', '-e', `${head.sha}^{commit}`])
  } catch {
    row.classification = 'UNPROVABLE (tip not fetched locally — run a fetch)'
    rows.push(row)
    continue
  }
  row.behind = Number(git(['rev-list', '--count', `${head.sha}..${mainSha}`]))
  row.ahead = Number(git(['rev-list', '--count', `${mainSha}..${head.sha}`]))

  if (row.behind === 0 && row.ahead === 0) row.classification = 'IN SYNC'
  else if (row.behind === 0) row.classification = 'AHEAD-ONLY'
  else if (row.ahead === 0) {
    // ahead=0 + behind>0 ⇒ tip must be an ancestor of main; prove it explicitly.
    // stdio: [stdin, stdout, stderr] — stdout MUST be piped for execFileSync to
    // return output; `merge-base --is-ancestor` exits 0 (ancestor, empty stdout)
    // or 1 (not an ancestor), which execFileSync surfaces as a throw.
    let isAncestor = false
    try {
      git(['merge-base', '--is-ancestor', head.sha, mainSha], { stdio: ['ignore', 'pipe', 'ignore'] })
      isAncestor = true
    } catch {
      isAncestor = false
    }
    row.classification = isAncestor ? 'FAST-FORWARD CANDIDATE' : 'UNPROVABLE (ancestry check failed)'
  } else row.classification = 'DIVERGENT'
  rows.push(row)
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Prove ancestry with the documented merge-base pattern (exit 1 = not ancestor). */
function isAncestorOf(sha, of) {
  try {
    git(['merge-base', '--is-ancestor', sha, of], { stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
}

// ─── Milestone completion gate (read-only) ────────────────────────────────────
// Refuses COMPLETE unless every publication and verification step is proven.
// Only what git can prove locally/via ls-remote is machine-checked; PR/CI
// state is checked through the `gh` CLI when it is available AND
// authenticated — otherwise it becomes an explicit manual verification item,
// never an assumption.

function ghAvailable() {
  try {
    execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return true
  } catch {
    return false
  }
}

function ghJson(ghArgs) {
  return JSON.parse(
    execFileSync('gh', ghArgs, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }),
  )
}

function runGate() {
  if (!gateId) {
    fail('--gate requires a milestone id from docs/milestone-ledger.json')
  }
  const ledgerPath = 'docs/milestone-ledger.json'
  if (!existsSync(ledgerPath)) {
    fail(`milestone ledger not found at ${ledgerPath}`)
  }
  let ledger
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  } catch (err) {
    fail(`milestone ledger is not valid JSON: ${err.message.split('\n')[0]}`)
  }
  const entry = (ledger.milestones ?? []).find(m => m.id === gateId)
  if (!entry) fail(`milestone "${gateId}" is not in the ledger`)

  const blocks = []
  const manual = []
  const notes = []

  // 1. Approved changes must be committed.
  let dirty
  try {
    dirty = git(['status', '--porcelain']).split('\n').filter(Boolean)
  } catch (err) {
    fail(`git status failed: ${err.message.split('\n')[0]}`)
  }
  if (dirty.length > 0) {
    blocks.push(`working tree has ${dirty.length} uncommitted change(s) — approved milestone changes must be committed first`)
  }

  // 2. Commits must not exist only locally.
  let headSha = null
  let currentBranch = null
  try {
    headSha = git(['rev-parse', 'HEAD'])
    currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch (err) {
    fail(`git rev-parse failed: ${err.message.split('\n')[0]}`)
  }
  const remoteTip = remoteHeads.find(h => h.branch === currentBranch)
  if (!remoteTip) {
    blocks.push(`current branch "${currentBranch}" does not exist on ${REMOTE} — its commits are unpublished`)
  } else if (remoteTip.sha !== headSha) {
    const unpushed = Number(git(['rev-list', '--count', `${remoteTip.sha}..${headSha}`]))
    blocks.push(
      unpushed > 0
        ? `${unpushed} local commit(s) not published: ${REMOTE}/${currentBranch} is at ${remoteTip.sha.slice(0, 9)} but HEAD is ${headSha.slice(0, 9)}`
        : `local HEAD ${headSha.slice(0, 9)} does not match ${REMOTE}/${currentBranch} ${remoteTip.sha.slice(0, 9)} — divergence must be resolved manually`,
    )
  }

  // 3. Synchronization + unmerged-work identification (from the branch table).
  const notInSync = rows.filter(r => r.classification !== 'IN SYNC')
  for (const r of notInSync) {
    if (r.classification === 'AHEAD-ONLY') {
      blocks.push(`branch "${r.branch}" has ${r.ahead} remote commit(s) missing from main — unmerged milestone work`)
    } else if (r.classification === 'FAST-FORWARD CANDIDATE') {
      blocks.push(`branch "${r.branch}" is ${r.behind} commit(s) behind main — required synchronization not completed`)
    } else {
      blocks.push(`branch "${r.branch}" is ${r.classification} — must be reconciled manually before COMPLETE`)
    }
  }

  // 4. Ledger claims must be proven.
  const isAuditOnly = entry.status === 'COMPLETE' && !entry.branch && (entry.commits?.length ?? 0) === 0
  if (isAuditOnly) {
    notes.push('audit-only milestone (no feature commits) — publication checks skipped by design')
  } else {
    const commits = entry.commits ?? []
    if (commits.length === 0) {
      blocks.push('ledger entry has no commit SHAs — every approved commit must be accounted for exactly once')
    }
    const integrated = entry.status === 'MERGED' || entry.status === 'COMPLETE'
    if (!integrated) {
      blocks.push(`ledger status is ${entry.status} — the milestone is not yet integrated into main`)
    } else {
      for (const c of commits) {
        let present = false
        try {
          git(['cat-file', '-e', `${c}^{commit}`])
          present = isAncestorOf(c, mainSha)
        } catch {
          present = false
        }
        if (!present) {
          blocks.push(`milestone commit ${c.slice(0, 9)} is NOT an ancestor of origin/main ${mainSha.slice(0, 9)} — missing from the published integration history`)
        }
      }
      if (entry.mergeCommitSha) {
        let mergeOk = false
        try {
          git(['cat-file', '-e', `${entry.mergeCommitSha}^{commit}`])
          mergeOk = isAncestorOf(entry.mergeCommitSha, mainSha)
        } catch {
          mergeOk = false
        }
        if (!mergeOk) blocks.push(`claimed merge commit ${entry.mergeCommitSha.slice(0, 9)} is not an ancestor of origin/main`)
      }
      if (entry.finalMainSha && entry.finalMainSha !== mainSha) {
        blocks.push(`ledger finalMainSha ${entry.finalMainSha.slice(0, 9)} ≠ live origin/main ${mainSha.slice(0, 9)} — main has moved; re-verify and update the ledger`)
      }
    }

    // Remote feature SHA still verifiable on GitHub (or the branch is now main).
    if (entry.branch) {
      const feature = remoteHeads.find(h => h.branch === entry.branch)
      if (!feature) {
        const integratedNow = entry.status === 'MERGED' || entry.status === 'COMPLETE'
        blocks.push(
          integratedNow
            ? `feature branch "${entry.branch}" no longer exists on ${REMOTE} — branches are never deleted; investigate`
            : `feature branch "${entry.branch}" does not exist on ${REMOTE} — its commits are unpublished`,
        )
      } else if (integrated && entry.remoteFeatureSha && feature.sha !== entry.remoteFeatureSha && feature.sha !== mainSha) {
        blocks.push(`feature branch "${entry.branch}" moved past the verified push SHA without being synchronized (remote ${feature.sha.slice(0, 9)}, ledger ${entry.remoteFeatureSha.slice(0, 9)})`)
      }
    }
  }

  // 5. PR/CI verification — via gh when available, otherwise an explicit
  //    manual step (never assumed).
  const ghOk = ghAvailable()
  if (entry.pr?.state === 'OPEN') {
    blocks.push(`PR #${entry.pr.number} is still open — required PR is unresolved`)
  } else if (entry.pr?.state === 'MERGED' && !isAuditOnly) {
    if (ghOk) {
      try {
        const pr = ghJson(['pr', 'view', String(entry.pr.number), '--repo', repoSlug(), '--json', 'state,mergeCommit'])
        if (pr.state !== 'MERGED') {
          blocks.push(`PR #${entry.pr.number} reports state "${pr.state}" on GitHub, not MERGED`)
        }
      } catch (err) {
        manual.push(`PR #${entry.pr.number} state could not be verified with gh (${err.message.split('\n')[0]}) — verify manually on GitHub`)
      }
    } else {
      manual.push(`PR #${entry.pr.number} state requires manual GitHub verification (gh CLI unavailable)`)
    }
  }
  const ciRuns = entry.ci ?? []
  if (ciRuns.length > 0) {
    if (ghOk) {
      for (const run of ciRuns) {
        try {
          const r = ghJson(['run', 'view', String(run.runId), '--repo', repoSlug(), '--json', 'status,conclusion'])
          if (r.status !== 'completed' || r.conclusion !== 'success') {
            blocks.push(`CI run ${run.runId} is status=${r.status} conclusion=${r.conclusion} — required CI is pending or failing`)
          }
        } catch (err) {
          manual.push(`CI run ${run.runId} could not be verified with gh (${err.message.split('\n')[0]}) — verify manually on GitHub`)
        }
      }
    } else {
      manual.push(`${ciRuns.length} CI run(s) require manual GitHub verification (gh CLI unavailable)`)
    }
  }
  // Open PRs anywhere are unmerged milestone work — report them when gh works.
  let openPrs = null
  if (ghOk) {
    try {
      openPrs = ghJson(['pr', 'list', '--repo', repoSlug(), '--state', 'open', '--json', 'number,title,headRefName'])
    } catch {
      openPrs = null
    }
  }

  const verdict = blocks.length === 0 ? 'PASS' : 'FAIL'
  const report = {
    gate: gateId,
    milestone: entry.title,
    ledgerStatus: entry.status,
    verdict,
    main: mainSha,
    head: headSha,
    branch: currentBranch,
    blocks,
    manual,
    notes,
    openPrs,
  }
  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`\nMILESTONE GATE — ${gateId} ("${entry.title}")`)
    console.log(`origin/main = ${mainSha}`)
    console.log(`ledger status: ${entry.status} · local HEAD: ${headSha.slice(0, 9)} (${currentBranch})`)
    if (verdict === 'PASS') {
      console.log('VERDICT: PASS — every machine-checkable publication requirement is satisfied.')
    } else {
      console.log(`VERDICT: FAIL — ${blocks.length} outstanding publication requirement(s):`)
      for (const b of blocks) console.log(`  ✗ ${b}`)
    }
    for (const m of manual) console.log(`  ? MANUAL: ${m}`)
    for (const n of notes) console.log(`  · ${n}`)
    if (openPrs && openPrs.length > 0) {
      console.log(`  Open PRs on GitHub (unmerged work): ${openPrs.map(p => `#${p.number}`).join(', ')}`)
    }
  }
  process.exit(verdict === 'PASS' ? 0 : 1)
}

/** owner/repo slug from the origin URL (for gh commands). */
function repoSlug() {
  const url = git(['remote', 'get-url', REMOTE])
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/)
  if (!m) fail(`cannot parse the GitHub slug from ${REMOTE} URL`)
  return m[1]
}

if (gateMode) {
  runGate()
}

if (asJson) {
  console.log(JSON.stringify({ main: mainSha, generatedAt: new Date().toISOString(), branches: rows }, null, 2))
} else {
  console.log(`origin/main = ${mainSha}\n`)
  const width = Math.max(...rows.map(r => r.branch.length), 20)
  console.log(`${'BRANCH'.padEnd(width)}  SHA       AHEAD  BEHIND  CLASSIFICATION`)
  for (const r of rows) {
    console.log(
      `${r.branch.padEnd(width)}  ${r.sha.slice(0, 9)}  ${String(r.ahead).padEnd(5)}  ${String(r.behind).padEnd(6)}  ${r.classification}`,
    )
  }
  const behindCount = rows.filter(r => r.behind > 0).length
  console.log(
    `\n${rows.length} feature branches: ${rows.filter(r => r.classification === 'IN SYNC').length} in sync, ` +
      `${rows.filter(r => r.classification === 'AHEAD-ONLY').length} ahead-only, ` +
      `${rows.filter(r => r.classification === 'FAST-FORWARD CANDIDATE').length} fast-forward candidates, ` +
      `${rows.filter(r => r.classification === 'DIVERGENT').length} divergent, ` +
      `${rows.filter(r => r.classification.startsWith('UNPROVABLE')).length} unprovable.`,
  )
  if (behindCount > 0) {
    console.log(`\nACTION REQUIRED (manual, per docs/GIT-BRANCH-HYGIENE.md): ${behindCount} branch(es) are behind origin/main.`)
    console.log('This script never updates refs — reconcile manually: fast-forward the zero-unique branches; merge origin/main into divergent ones.')
  } else {
    console.log('\nNo branch is behind origin/main. Hygiene condition met.')
  }
}

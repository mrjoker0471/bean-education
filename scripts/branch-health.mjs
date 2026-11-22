// branch-health.mjs — read-only branch hygiene reporter.
//
// Purpose: prove, at any moment, how every remote feature branch compares to
// origin/main so the divergence problem documented in docs/GIT-BRANCH-HYGIENE.md
// cannot silently return. See that document for the policy this script enforces.
//
// What it does (READ-ONLY — never pushes, merges, deletes, or rewrites refs):
//   1. `git fetch origin --prune` (skipped with --no-fetch)
//   2. Reads the ACTUAL refs from GitHub via `git ls-remote` (not stale
//      remote-tracking refs, so the report cannot lie after a manual push)
//   3. For every remote branch except main: computes ahead/behind vs the
//      fetched origin/main, verifies ancestry, and classifies the branch
//   4. Prints a table + summary; exits 0 normally, 2 on internal errors
//
// Usage:
//   bun scripts/branch-health.mjs            # fetch + report
//   bun scripts/branch-health.mjs --no-fetch # report from last fetch
//   bun scripts/branch-health.mjs --json     # machine-readable output
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

const args = process.argv.slice(2)
const doFetch = !args.includes('--no-fetch')
const asJson = args.includes('--json')
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

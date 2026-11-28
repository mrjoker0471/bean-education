// ─── OPS-2 amendment: restore PATH PORTABILITY — validated mapping strategies ──
//
// Why this exists (independent review finding):
//   The application stores `StudyDocument.storedPath` as an ABSOLUTE path,
//   baked in at upload time (`<cwd-at-write>/db/uploads/<uuid>.pdf`), and the
//   download route, the analysis pipeline and every delete path open the file
//   through that stored string directly. The evidence store, by contrast, is
//   portable: `ExpertCredentialEvidence.storagePath` is a RELATIVE filename
//   resolved at runtime against `<cwd>/db/evidence` by the app's own
//   `evidenceFilePath()` containment guard.
//
//   A restore that places bytes under a DIFFERENT root therefore leaves every
//   StudyDocument row pointing at a path the restored application cannot open
//   (the file route returns 410, the pipeline fails the document, and the
//   materials-list orphan sweep would eventually DELETE restored bytes whose
//   storedPath does not match the runtime-derived upload root).
//
// This module provides the two explicit, validated recovery strategies. Both
// operate ONLY on isolated restored copies; neither ever rewrites the original
// backup snapshot, the original fixture, or any live database:
//
//   MODE canonical — "restore into the exact recorded paths"
//       Materialise the restored upload bytes at the absolute paths the
//       restored database already expects. Validated: exactly one unambiguous
//       original root, absolute paths, basename↔manifest agreement, no
//       destination may already exist, destination root must never overlap the
//       restored staging tree / repository / other protected roots.
//
//   MODE remap — "explicit path remapping on the isolated DB copy"
//       Rewrite `StudyDocument.storedPath` inside the ISOLATED restored
//       database copy from the original root to a new recovery root, row by
//       row, with exact-prefix matching and per-row applied-count checks.
//       Validated: single unambiguous root, containment, manifest basename
//       agreement, duplicate-destination refusal, traversal refusal, and the
//       new root must not overlap any forbidden (live/fixture/stage/repo) root.
//
// Both modes are fail-closed: any ambiguity, escape, duplicate or unsafe
// overlap refuses the whole operation with a named reason.

import { createHash } from 'node:crypto'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'

function sha256Bytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// ─── Shared root-safety primitives ─────────────────────────────────────────────

/** True when `candidate` is `root` itself or anywhere inside it. */
function isInside(candidate: string, root: string): boolean {
  const c = path.resolve(candidate)
  const r = path.resolve(root)
  return c === r || c.startsWith(r + path.sep)
}

export type RootSafety = { ok: true } | { ok: false; error: string }

/**
 * A recovery destination root must be disjoint from every forbidden root:
 * neither may contain the other. This is what makes a recovery layout unable
 * to clobber live data roots, the restored staging tree, or the repository.
 */
export function assertDisjointRoots(candidate: string, forbiddenRoots: string[], what: string): RootSafety {
  const resolved = path.resolve(candidate)
  if (!path.isAbsolute(resolved)) {
    return { ok: false, error: `${what} must be an absolute path (got ${candidate})` }
  }
  for (const f of forbiddenRoots) {
    if (isInside(resolved, f)) {
      return { ok: false, error: `${what} (${resolved}) must never overlap the protected root ${path.resolve(f)}` }
    }
    if (isInside(f, resolved)) {
      return { ok: false, error: `${what} (${resolved}) must not contain the protected root ${path.resolve(f)}` }
    }
  }
  return { ok: true }
}

// ─── storedPath analysis ───────────────────────────────────────────────────────

export interface StoredPathRow {
  id: string
  storedPath: string
  fileSize: number
  contentHash: string
}

export interface StoredPathAnalysis {
  rows: StoredPathRow[]
  /** Distinct resolved parent directories across all rows. */
  distinctRoots: string[]
  problems: string[]
}

/** Read every StudyDocument row and analyse where its storedPath points. */
export function analyzeStoredPaths(dbPath: string): StoredPathAnalysis {
  const db = new Database(dbPath, { readonly: true, create: false })
  try {
    const rows = db
      .query('SELECT id, storedPath, fileSize, contentHash FROM StudyDocument ORDER BY id')
      .all() as Array<{ id: string; storedPath: string; fileSize: number; contentHash: string }>
    const problems: string[] = []
    const roots = new Set<string>()
    for (const row of rows) {
      if (!path.isAbsolute(row.storedPath)) {
        problems.push(`StudyDocument ${row.id}: storedPath is not absolute ("${row.storedPath}") — the app writes absolute paths; refusing to guess`)
        continue
      }
      roots.add(path.dirname(path.resolve(row.storedPath)))
    }
    return { rows, distinctRoots: [...roots].sort(), problems }
  } finally {
    db.close()
  }
}

/**
 * The one unambiguous original uploads root across all rows — or a named
 * refusal. Mixed roots (e.g. rows written by different historical app roots)
 * cannot be remapped safely by a single prefix rule and are rejected.
 */
export function singleUploadRoot(analysis: StoredPathAnalysis): { ok: true; root: string } | { ok: false; error: string } {
  if (analysis.problems.length > 0) {
    return { ok: false, error: `storedPath analysis found problems: ${analysis.problems.join(' | ')}` }
  }
  if (analysis.rows.length === 0) {
    return { ok: false, error: 'no StudyDocument rows exist — nothing to map' }
  }
  if (analysis.distinctRoots.length !== 1) {
    return {
      ok: false,
      error:
        `ambiguous original roots: StudyDocument rows point at ${analysis.distinctRoots.length} distinct ` +
        `directories (${analysis.distinctRoots.join(', ')}) — a single-root mapping would silently guess; refusing`,
    }
  }
  return { ok: true, root: analysis.distinctRoots[0] }
}

// ─── MODE remap: plan + apply on the isolated DB copy ──────────────────────────

export interface RemapPlanRow {
  id: string
  from: string
  to: string
}

export interface UploadsRemapPlan {
  originalRoot: string
  newRoot: string
  rows: RemapPlanRow[]
}

export interface RemapPlanInput {
  /** The ISOLATED restored database copy (never a live or original DB). */
  dbPath: string
  /** Upload basenames recorded in the backup manifest (the authoritative file set). */
  manifestUploadNames: string[]
  /** New absolute uploads root inside the isolated recovery layout. */
  newRoot: string
  /** Roots the recovery layout must never overlap (live data, fixture, stage, repo, target). */
  forbiddenRoots: string[]
}

export type RemapPlan = { ok: true; plan: UploadsRemapPlan } | { ok: false; error: string }

/**
 * Build a validated per-row storedPath remap plan. Fail-closed on: non-absolute
 * paths, ambiguous original roots, prefix escapes, basenames absent from the
 * manifest, duplicate destinations, unsafe recovery-root overlap, or a target
 * database that itself sits inside a protected root.
 */
export function planUploadsRemap(input: RemapPlanInput): RemapPlan {
  const newRoot = path.resolve(input.newRoot)
  if (!path.isAbsolute(newRoot)) return { ok: false, error: 'recovery uploads root must be an absolute path' }

  const dbGuard = assertDisjointRoots(path.dirname(input.dbPath), input.forbiddenRoots, 'restored database location')
  if (!dbGuard.ok) return { ok: false, error: dbGuard.error }
  const rootGuard = assertDisjointRoots(newRoot, input.forbiddenRoots, 'recovery uploads root')
  if (!rootGuard.ok) return { ok: false, error: rootGuard.error }

  const analysis = analyzeStoredPaths(input.dbPath)
  const root = singleUploadRoot(analysis)
  if (!root.ok) return { ok: false, error: root.error }

  // Defence in depth: the database being remapped must never live inside the
  // original uploads root it is being remapped FROM (that would be the live
  // or original data location, not an isolated restored copy).
  const originalGuard = assertDisjointRoots(path.dirname(input.dbPath), [root.root], 'remap target database')
  if (!originalGuard.ok) return { ok: false, error: originalGuard.error }

  const manifestNames = new Set(input.manifestUploadNames)
  if (manifestNames.size !== input.manifestUploadNames.length) {
    return { ok: false, error: 'manifest upload names contain duplicates — refusing to map against an ambiguous file set' }
  }

  const destinations = new Map<string, string>()
  const rows: RemapPlanRow[] = []
  for (const row of analysis.rows) {
    const resolved = path.resolve(row.storedPath)
    if (!resolved.startsWith(root.root + path.sep)) {
      return {
        ok: false,
        error: `StudyDocument ${row.id}: storedPath "${row.storedPath}" escapes the original uploads root ${root.root} — refusing to map`,
      }
    }
    const base = path.basename(resolved)
    if (!base || base === '.' || base === '..' || base.includes(path.sep)) {
      return { ok: false, error: `StudyDocument ${row.id}: unusable basename in storedPath "${row.storedPath}"` }
    }
    if (!manifestNames.has(base)) {
      return {
        ok: false,
        error: `StudyDocument ${row.id}: basename "${base}" is not a manifest upload entry — remapping would invent a mapping the backup cannot verify; refusing`,
      }
    }
    const to = path.join(newRoot, base)
    const existing = destinations.get(base)
    if (existing !== undefined) {
      return {
        ok: false,
        error: `duplicate destination: rows ${existing} and ${row.id} would both map to "${to}" — refusing ambiguous remap`,
      }
    }
    if (!to.startsWith(newRoot + path.sep)) {
      return { ok: false, error: `StudyDocument ${row.id}: destination "${to}" escapes the recovery uploads root — refusing` }
    }
    destinations.set(base, row.id)
    rows.push({ id: row.id, from: resolved, to })
  }

  return { ok: true, plan: { originalRoot: root.root, newRoot, rows } }
}

export type RemapApply = { ok: true; applied: number } | { ok: false; error: string }

/**
 * Apply a remap plan to the ISOLATED restored database copy. Each row is
 * updated with an exact old-value guard inside one transaction; any row that
 * does not change exactly once aborts the whole remap (rolled back). The
 * database is then re-checked with PRAGMA integrity_check / foreign_key_check
 * and every resulting storedPath is re-verified for containment in newRoot.
 */
export function applyUploadsRemap(dbPath: string, plan: UploadsRemapPlan): RemapApply {
  // Hard guard: refuse to write to any database sitting inside the ORIGINAL
  // uploads root (i.e. never the live/original data location). The recovery
  // uploads root is deliberately a SIBLING of the remapped DB copy inside the
  // recovery layout and must not be part of this guard. The caller-level
  // planUploadsRemap validation already rejects overlap with every forbidden
  // (live/fixture/stage/repo) root; this is defence in depth against a
  // miswired caller pointing the remap at the original database.
  const liveGuard = assertDisjointRoots(path.dirname(dbPath), [plan.originalRoot], 'remap target database')
  if (!liveGuard.ok) return { ok: false, error: liveGuard.error }

  // bun 1.3.x quirk: a WRITABLE open must not pass an options object
  // (`{ readonly: false, … }` is rejected with "bad parameter or other API
  // misuse"). The file must already exist (the isolated restored copy) — the
  // explicit existence guard below preserves the never-create semantics.
  if (!existsSync(dbPath)) return { ok: false, error: `remap target database does not exist: ${dbPath}` }
  const db = new Database(dbPath)
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of plan.rows) {
        const changes = db
          .query('UPDATE StudyDocument SET storedPath = ? WHERE id = ? AND storedPath = ?')
          .run(row.to, row.id, row.from)
        if (changes.changes !== 1) {
          throw new Error(
            `StudyDocument ${row.id} did not update exactly once (changed ${changes.changes}) — ` +
              'the restored copy changed underneath the plan; remap rolled back',
          )
        }
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    const integrity = db.query('PRAGMA integrity_check').get() as { integrity_check?: string } | null
    if (integrity?.integrity_check !== 'ok') {
      return { ok: false, error: `post-remap integrity_check reported ${integrity?.integrity_check ?? 'unknown'}` }
    }
    const fk = db.query('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>
    if (fk.length > 0) {
      return { ok: false, error: `post-remap foreign_key_check reported ${fk.length} violation(s)` }
    }
    const after = db.query('SELECT id, storedPath FROM StudyDocument').all() as Array<{ id: string; storedPath: string }>
    for (const row of after) {
      if (!path.resolve(row.storedPath).startsWith(plan.newRoot + path.sep)) {
        return { ok: false, error: `post-remap StudyDocument ${row.id} still points outside the recovery root: ${row.storedPath}` }
      }
    }
    return { ok: true, applied: plan.rows.length }
  } finally {
    db.close()
  }
}

// ─── MODE canonical: materialise bytes at the recorded absolute paths ──────────

export interface CanonicalMaterializationPlan {
  /** The single unambiguous original uploads root (destinations live inside it). */
  root: string
  /** Exact absolute destination per manifest basename. */
  destinations: Array<{ absolutePath: string; basename: string }>
}

export type CanonicalPlan =
  | { ok: true; plan: CanonicalMaterializationPlan }
  | { ok: false; error: string }

export interface CanonicalPlanInput {
  dbPath: string
  manifestUploadNames: string[]
  /** Roots the canonical destination root must never overlap (stage, repo, target, preserved live data). */
  forbiddenRoots: string[]
}

/**
 * Plan a canonical restore: every StudyDocument row's recorded absolute path
 * becomes a materialisation destination. Fail-closed on the same ambiguities
 * as the remap planner, plus: any destination that already exists (canonical
 * mode never overwrites an existing byte — the operator must first make the
 * recorded root genuinely free, e.g. after the original layout is gone), and
 * any overlap between the destination root and a protected root.
 */
export function planCanonicalMaterialization(input: CanonicalPlanInput): CanonicalPlan {
  const analysis = analyzeStoredPaths(input.dbPath)
  const root = singleUploadRoot(analysis)
  if (!root.ok) return { ok: false, error: root.error }

  const overlap = assertDisjointRoots(root.root, input.forbiddenRoots, 'canonical uploads root')
  if (!overlap.ok) return { ok: false, error: overlap.error }

  const manifestNames = new Set(input.manifestUploadNames)
  if (manifestNames.size !== input.manifestUploadNames.length) {
    return { ok: false, error: 'manifest upload names contain duplicates — refusing an ambiguous canonical materialization' }
  }

  const destinations: CanonicalMaterializationPlan['destinations'] = []
  const seen = new Set<string>()
  for (const row of analysis.rows) {
    const resolved = path.resolve(row.storedPath)
    if (!resolved.startsWith(root.root + path.sep)) {
      return { ok: false, error: `StudyDocument ${row.id}: storedPath "${row.storedPath}" escapes the canonical root ${root.root}` }
    }
    const base = path.basename(resolved)
    if (!manifestNames.has(base)) {
      return { ok: false, error: `StudyDocument ${row.id}: basename "${base}" is not a manifest upload entry — refusing` }
    }
    if (seen.has(base)) {
      return { ok: false, error: `duplicate destination basename "${base}" — refusing ambiguous canonical materialization` }
    }
    if (existsSync(resolved)) {
      return {
        ok: false,
        error: `canonical destination already exists: ${resolved} — canonical restore never overwrites existing bytes`,
      }
    }
    seen.add(base)
    destinations.push({ absolutePath: resolved, basename: base })
  }
  return { ok: true, plan: { root: root.root, destinations } }
}

/**
 * Materialise the restored upload bytes at their exact recorded absolute
 * paths (mode 0600, byte-identical to the restored staging tree). Refuses if
 * a destination appeared between planning and writing.
 */
export async function materializeCanonicalFiles(
  plan: CanonicalMaterializationPlan,
  restoredUploadsDir: string,
): Promise<{ ok: true; written: number } | { ok: false; error: string }> {
  const { chmod } = await import('node:fs/promises')
  await mkdir(plan.root, { recursive: true })
  let written = 0
  for (const dest of plan.destinations) {
    if (existsSync(dest.absolutePath)) {
      return { ok: false, error: `canonical destination appeared during materialization: ${dest.absolutePath} — refusing` }
    }
    const source = path.join(restoredUploadsDir, dest.basename)
    const sourceStat = await stat(source).catch(() => null)
    if (!sourceStat || !sourceStat.isFile()) {
      return { ok: false, error: `restored staging tree has no upload "${dest.basename}" for canonical materialization` }
    }
    await copyFile(source, dest.absolutePath)
    await chmod(dest.absolutePath, 0o600) // restricted-store discipline regardless of source mode
    written += 1
  }
  return { ok: true, written }
}

// ─── Recovery-layout file placement (uploads + evidence + remapped DB) ────────

/**
 * Populate a fresh recovery app-data layout (`db/uploads`, `db/evidence`,
 * `db/<basename>` for the remapped database copy) from the restored staging
 * tree. Evidence bytes are copied under their RELATIVE storagePath names —
 * exactly the layout the app's runtime `evidenceFilePath()` resolution expects
 * when the restored application runs from the recovery root.
 */
export async function populateRecoveryLayout(input: {
  recoveryAppRoot: string
  dbBasename: string
  dbSourcePath: string
  restoredUploadsDir: string
  restoredEvidenceDir: string
}): Promise<{ ok: true; uploadsDir: string; evidenceDir: string; dbPath: string } | { ok: false; error: string }> {
  const uploadsDir = path.join(input.recoveryAppRoot, 'db', 'uploads')
  const evidenceDir = path.join(input.recoveryAppRoot, 'db', 'evidence')
  const dbPath = path.join(input.recoveryAppRoot, 'db', input.dbBasename)
  for (const dir of [uploadsDir, evidenceDir, path.dirname(dbPath)]) {
    if (existsSync(dir)) {
      return { ok: false, error: `recovery layout destination already exists: ${dir} — recovery layouts are always fresh` }
    }
  }
  const { readdir } = await import('node:fs/promises')
  await mkdir(uploadsDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })
  try {
    for (const name of await readdir(input.restoredUploadsDir)) {
      await copyFile(path.join(input.restoredUploadsDir, name), path.join(uploadsDir, name))
    }
    for (const name of await readdir(input.restoredEvidenceDir)) {
      await copyFile(path.join(input.restoredEvidenceDir, name), path.join(evidenceDir, name))
    }
    await copyFile(input.dbSourcePath, dbPath)
  } catch (err) {
    return { ok: false, error: `recovery layout population failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { ok: true, uploadsDir, evidenceDir, dbPath }
}

// ─── Portability probe (child process execution) ───────────────────────────────

export interface ProbeOutcome {
  ok: boolean
  result: {
    mode: string
    documentsChecked: number
    evidenceChecked: number
    rangeChecks: number
    problems: string[]
    documents: Array<{ id: string; storedPath: string; problems: string[] }>
    evidence: Array<{ id: string; storagePath: string; resolvedPath: string; problems: string[] }>
  }
}

/**
 * Execute the portability probe as a CHILD process with a minimal environment
 * and the caller-chosen cwd/DATABASE_URL. The probe must run in a separate
 * process (its imports bind DATABASE_URL and Next runtime pieces that must not
 * leak into the drill process). The child is strictly read-only.
 */
export async function runPortabilityProbe(input: {
  projectRoot: string
  appRoot: string
  dbPath: string
  mode: 'canonical' | 'remap'
  timeoutMs?: number
}): Promise<{ ok: true; outcome: ProbeOutcome } | { ok: false; error: string }> {
  const { execFile } = await import('node:child_process')
  const script = path.join(input.projectRoot, 'scripts', 'ops', 'lib', 'portability-probe.ts')
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    DATABASE_URL: `file:${input.dbPath}`,
    BEAN_PROBE_MODE: input.mode,
  }
  let exitError: Error | null = null
  const stdout = await new Promise<string>((resolve) => {
    execFile(
      process.execPath, // bun
      [script],
      { cwd: input.appRoot, env, timeout: input.timeoutMs ?? 120_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, out, stderr) => {
        // A non-zero exit is EXPECTED whenever the probe detects a problem —
        // its JSON result line (on stdout) is still the authoritative report,
        // so stdout is resolved even on failure and parsed below.
        if (err) exitError = new Error(`probe exited non-zero (${String(stderr).slice(-200) || err.message.slice(0, 160)})`)
        resolve(out)
      },
    )
  })
  const marker = 'BEAN_PROBE_RESULT: '
  const line = stdout.split('\n').reverse().find((l) => l.startsWith(marker))
  if (!line) {
    return {
      ok: false,
      error: exitError
        ? `${exitError.message} and produced no result line`
        : 'probe produced no result line (stdout was empty or malformed)',
    }
  }
  let parsed: ProbeOutcome['result']
  try {
    parsed = JSON.parse(line.slice(marker.length)) as ProbeOutcome['result']
  } catch {
    return { ok: false, error: `probe result line was not valid JSON: ${line.slice(0, 200)}` }
  }
  if (!parsed.ok || parsed.problems.length > 0) {
    return {
      ok: false,
      error:
        `probe (mode=${parsed.mode}) failed: ${parsed.problems.join(' | ') || 'ok=false without problems'} ` +
        `${exitError ? `(${exitError.message}) ` : ''}` +
        `[documents ${parsed.documentsChecked}, evidence ${parsed.evidenceChecked}]`,
    }
  }
  if (exitError) {
    return { ok: false, error: `probe reported ok but exited non-zero — refusing (${exitError.message})` }
  }
  return { ok: true, outcome: { ok: true, result: parsed } }
}

/** sha256 of one file (used by the drill to prove the fixture is untouched). */
export async function sha256File(p: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return sha256Bytes(await readFile(p))
}

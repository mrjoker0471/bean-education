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
import { chmod, copyFile, mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { existsSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { assertRealDisjointRoots, assertRealFileLocation, scanPath } from './fs-boundary'

function sha256Bytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// ─── Shared root-safety primitives ─────────────────────────────────────────────

/**
 * OPS-2.1: this guard is FILESYSTEM-REAL, not merely lexical. It delegates to
 * the shared fs-boundary mechanism (scripts/ops/lib/fs-boundary.ts): every
 * existing component of the candidate destination is lstat-checked (any
 * symbolic link — leaf or ancestor — refuses the operation) and containment is
 * compared on ACTUAL filesystem locations (longest existing prefix
 * realpath-resolved, nonexistent tail appended lexically). A destination root
 * that is a symlink pointing into a protected root — or anywhere outside the
 * intended recovery layout — can no longer pass a lexical comparison.
 */
export type RootSafety = { ok: true } | { ok: false; error: string }

export function assertDisjointRoots(candidate: string, forbiddenRoots: string[], what: string): RootSafety {
  const r = assertRealDisjointRoots(candidate, forbiddenRoots, what)
  return r.ok ? { ok: true } : { ok: false, error: r.error }
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

  // OPS-2.1: the database being remapped must be a REAL regular file reached
  // through real directories — a symlink alias could point the writable remap
  // at another database (e.g. the live one) while every lexical check passes.
  // Its ACTUAL location must be disjoint from every protected root AND from
  // the original uploads root, on the real filesystem.
  const dbFileGuard = assertRealFileLocation(input.dbPath, [...input.forbiddenRoots, root.root], 'remap target database file')
  if (!dbFileGuard.ok) return { ok: false, error: dbFileGuard.error }

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

  // OPS-2.1: the writable open below must never be able to land on an alias.
  // The database must lstat as a real regular file, reached through real
  // directories, whose ACTUAL location is disjoint from the original root on
  // the real filesystem — a symlink alias to the live/original database is
  // refused even though every lexical comparison would have passed.
  const fileGuard = assertRealFileLocation(dbPath, [plan.originalRoot], 'remap target database file')
  if (!fileGuard.ok) return { ok: false, error: fileGuard.error }

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
    // OPS-2.1: existence is checked with lstat (existsSync FOLLOWS symlinks —
    // a dangling symlink would have passed as "nonexistent" and a symlink to
    // an existing file only sometimes). Any existing entry — file, symlink,
    // even dangling — refuses: canonical restore never overwrites and never
    // replaces an existing directory entry of any kind.
    const destStat = lstatSync(resolved, { throwIfNoEntry: false })
    if (destStat) {
      return {
        ok: false,
        error:
          `canonical destination already exists: ${resolved}` +
          (destStat.isSymbolicLink() ? ' (and is a symbolic link — never followed, fail-closed)' : '') +
          ' — canonical restore never overwrites existing bytes',
      }
    }
    // OPS-2.1: an existing symbolic-link component anywhere on the destination
    // path (e.g. a subdirectory of the canonical root symlinked elsewhere)
    // refuses the plan — materialization would otherwise follow it.
    const destScan = scanPath(resolved)
    if (destScan.symlinks.length > 0) {
      return {
        ok: false,
        error: `canonical destination ${resolved} traverses symbolic link component(s) (${destScan.symlinks.join(' → ')}) — refusing (fail-closed)`,
      }
    }
    seen.add(base)
    destinations.push({ absolutePath: resolved, basename: base })
  }
  return { ok: true, plan: { root: root.root, destinations } }
}

/**
 * Materialise the restored upload bytes at their exact recorded absolute
 * paths (mode 0600, byte-identical to the restored staging tree).
 *
 * OPS-2.1 filesystem-boundary discipline:
 *   • the canonical root is RE-SCANNED at write time — a root (or any of its
 *     existing ancestors) swapped into a symbolic link between planning and
 *     materialization refuses the whole operation;
 *   • every intermediate directory between the root and each leaf is lstat
 *     real-directory checked (existing symlinks refuse; missing ones are
 *     created and recorded);
 *   • leaves are written with O_CREAT|O_EXCL (writeFile flag 'wx'): the
 *     kernel guarantees an existing file is never overwritten and a symlink
 *     at the leaf — even a dangling one — is never followed (race-free);
 *   • after each write the leaf is re-verified as a regular file with no
 *     symlinked components (narrowing the documented TOCTOU window);
 *   • on any failure, ONLY the files this call wrote are removed (a written
 *     leaf that has become a symlink is left untouched and reported);
 *     pre-existing files and directories are never deleted.
 */
export async function materializeCanonicalFiles(
  plan: CanonicalMaterializationPlan,
  restoredUploadsDir: string,
): Promise<{ ok: true; written: number } | { ok: false; error: string }> {
  // Write-time re-validation (planning may be arbitrarily older than writing).
  const rootScan = scanPath(plan.root)
  if (rootScan.symlinks.length > 0) {
    return {
      ok: false,
      error:
        `canonical root ${plan.root} traverses symbolic link component(s) (${rootScan.symlinks.join(' → ')}) ` +
        'between planning and materialization — refusing (fail-closed)',
    }
  }
  const rootStat = lstatSync(plan.root, { throwIfNoEntry: false })
  if (rootStat && !rootStat.isDirectory()) {
    return { ok: false, error: `canonical root ${plan.root} exists and is not a directory — refusing` }
  }
  await mkdir(plan.root, { recursive: true })

  const writtenFiles: string[] = []
  const createdDirs: string[] = []
  const cleanupPartialFailure = async (reason: string): Promise<{ ok: false; error: string }> => {
    // Remove ONLY bytes this call wrote. A written leaf that has itself become
    // a symbolic link is no longer ours to delete — it is left untouched and
    // reported. Pre-existing files/directories are never deleted; created
    // directories are removed only if still empty (rmdir never recurses).
    const removed: string[] = []
    const leftAlone: string[] = []
    for (const f of [...writtenFiles].reverse()) {
      const st = lstatSync(f, { throwIfNoEntry: false })
      if (!st) continue
      if (st.isSymbolicLink() || !st.isFile()) {
        leftAlone.push(f)
        continue
      }
      try {
        await rm(f, { force: false })
        removed.push(f)
      } catch {
        leftAlone.push(f)
      }
    }
    // Deepest-first: a parent rmdir only succeeds once its children are gone.
    for (const d of [...createdDirs].sort(
      (a, b) => b.split(path.sep).length - a.split(path.sep).length || b.length - a.length,
    )) {
      await rmdir(d).catch(() => undefined) // succeeds only when empty
    }
    const note =
      leftAlone.length > 0
        ? `; ${leftAlone.length} written path(s) were no longer regular files and were left untouched`
        : ''
    return {
      ok: false,
      error: `${reason} (partial failure: ${removed.length} file(s) written by this call were removed; pre-existing files and directories were never deleted${note})`,
    }
  }

  let written = 0
  for (const dest of plan.destinations) {
    const st = lstatSync(dest.absolutePath, { throwIfNoEntry: false })
    if (st) {
      return cleanupPartialFailure(
        `canonical destination appeared during materialization: ${dest.absolutePath}` +
          (st.isSymbolicLink() ? ' (and is now a symbolic link)' : '') +
          ' — refusing (never overwrites)',
      )
    }
    // Intermediate components between the canonical root and the leaf.
    const rel = path.relative(plan.root, dest.absolutePath)
    const parts = rel.split(path.sep).filter((s) => s.length > 0)
    let acc = plan.root
    for (const part of parts.slice(0, -1)) {
      acc = path.join(acc, part)
      const ist = lstatSync(acc, { throwIfNoEntry: false })
      if (!ist) {
        await mkdir(acc) // parents are processed in order, so non-recursive is exact
        createdDirs.push(acc)
      } else if (ist.isSymbolicLink()) {
        return cleanupPartialFailure(
          `canonical destination ${dest.absolutePath} traverses symbolic link component ${acc} between planning and materialization — refusing (fail-closed)`,
        )
      } else if (!ist.isDirectory()) {
        return cleanupPartialFailure(`canonical destination ${dest.absolutePath} traverses non-directory component ${acc} — refusing`)
      }
    }
    const source = path.join(restoredUploadsDir, dest.basename)
    const sourceStat = lstatSync(source, { throwIfNoEntry: false })
    if (!sourceStat || sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      return cleanupPartialFailure(
        `restored staging tree has no usable regular-file upload "${dest.basename}" for canonical materialization (missing, symbolic link, or non-file)`,
      )
    }
    const bytes = await readFile(source)
    try {
      // flag 'wx' → O_CREAT|O_EXCL: race-free refusal of an existing leaf and
      // of any symlink at the leaf (even dangling). Never overwrites.
      await writeFile(dest.absolutePath, bytes, { mode: 0o600, flag: 'wx' })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        return cleanupPartialFailure(`canonical destination appeared during materialization: ${dest.absolutePath} — refusing (never overwrites)`)
      }
      return cleanupPartialFailure(`canonical write failed for ${dest.absolutePath}: ${err instanceof Error ? err.message : String(err)}`)
    }
    writtenFiles.push(dest.absolutePath)
    // Post-write re-verification (narrows the documented TOCTOU window).
    const post = lstatSync(dest.absolutePath, { throwIfNoEntry: false })
    const postScan = scanPath(dest.absolutePath)
    if (!post || post.isSymbolicLink() || !post.isFile() || postScan.symlinks.length > 0) {
      return cleanupPartialFailure(
        `canonical destination ${dest.absolutePath} is no longer the regular file this call wrote (suspected symlink swap between write and verification) — refusing`,
      )
    }
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
 *
 * OPS-2.1 filesystem-boundary discipline:
 *   • the recovery app root must be a REAL (nonexistent) location — any
 *     symbolic-link component on its path refuses the layout; when the caller
 *     supplies forbiddenRoots the ACTUAL location must also be disjoint from
 *     every protected root on the real filesystem;
 *   • the restored database basename must be a plain filename (a hostile
 *     manifest value can never place the copy outside the layout);
 *   • restored source roots must be real directories reached through real
 *     components, and every entry inside them must be a REAL regular file —
 *     a symbolic-link entry in restored upload/evidence storage is an
 *     explicit failure and is never followed (enumeration uses
 *     readdir(withFileTypes), which reports the link itself);
 *   • every leaf is lstat-checked immediately before its copy and re-verified
 *     as a regular file after it (the documented residual TOCTOU window);
 *   • on failure, only files this call wrote are removed (a written leaf that
 *     has become a symlink is left untouched and reported); directories are
 *     removed only if still empty; nothing pre-existing is ever deleted.
 */
export async function populateRecoveryLayout(input: {
  recoveryAppRoot: string
  dbBasename: string
  dbSourcePath: string
  restoredUploadsDir: string
  restoredEvidenceDir: string
  /** OPS-2.1: roots the recovery layout must never overlap on the REAL filesystem. */
  forbiddenRoots?: string[]
}): Promise<{ ok: true; uploadsDir: string; evidenceDir: string; dbPath: string } | { ok: false; error: string }> {
  const uploadsDir = path.join(input.recoveryAppRoot, 'db', 'uploads')
  const evidenceDir = path.join(input.recoveryAppRoot, 'db', 'evidence')
  const dbPath = path.join(input.recoveryAppRoot, 'db', input.dbBasename)

  // Fresh-layout + real-location validation of the recovery app root. The
  // symlink scan runs FIRST so a symlinked recovery root is named as exactly
  // that (an existing regular directory is the separate "always fresh" case).
  const appRootScan = scanPath(input.recoveryAppRoot)
  if (appRootScan.symlinks.length > 0) {
    return {
      ok: false,
      error: `recovery app root (${input.recoveryAppRoot}) traverses symbolic link component(s) (${appRootScan.symlinks.join(' → ')}) — refusing (fail-closed)`,
    }
  }
  if (input.forbiddenRoots !== undefined) {
    const guard = assertRealDisjointRoots(input.recoveryAppRoot, input.forbiddenRoots, 'recovery app root')
    if (!guard.ok) return { ok: false, error: guard.error }
  }
  if (lstatSync(input.recoveryAppRoot, { throwIfNoEntry: false })) {
    return { ok: false, error: `recovery app root already exists: ${input.recoveryAppRoot} — recovery layouts are always fresh` }
  }

  // The database basename comes from manifest data — it must be a plain
  // filename or the copy could be placed outside the layout (lexical escape).
  if (
    input.dbBasename.length === 0 ||
    input.dbBasename !== path.basename(input.dbBasename) ||
    input.dbBasename === '.' ||
    input.dbBasename === '..' ||
    input.dbBasename.includes('/') ||
    input.dbBasename.includes('\\')
  ) {
    return { ok: false, error: `database basename is not a plain filename: "${input.dbBasename}" — refusing` }
  }

  // Restored source roots: real directories, real components.
  for (const [label, dir] of [
    ['uploads', input.restoredUploadsDir],
    ['evidence', input.restoredEvidenceDir],
  ] as const) {
    const st = lstatSync(dir, { throwIfNoEntry: false })
    if (!st || st.isSymbolicLink() || !st.isDirectory()) {
      return { ok: false, error: `restored ${label} storage root is not a real directory: ${dir}` }
    }
    const scan = scanPath(dir)
    if (scan.symlinks.length > 0) {
      return {
        ok: false,
        error: `restored ${label} storage root (${dir}) is reached through symbolic link component(s) (${scan.symlinks.join(' → ')}) — refusing (fail-closed)`,
      }
    }
  }
  const dbSourceStat = lstatSync(input.dbSourcePath, { throwIfNoEntry: false })
  if (!dbSourceStat || dbSourceStat.isSymbolicLink() || !dbSourceStat.isFile()) {
    return { ok: false, error: `restored database source is not a real regular file: ${input.dbSourcePath}` }
  }
  const dbSourceScan = scanPath(input.dbSourcePath)
  if (dbSourceScan.symlinks.length > 0) {
    return {
      ok: false,
      error: `restored database source (${input.dbSourcePath}) is reached through symbolic link component(s) (${dbSourceScan.symlinks.join(' → ')}) — refusing (fail-closed)`,
    }
  }

  for (const dir of [uploadsDir, evidenceDir, path.dirname(dbPath)]) {
    if (existsSync(dir)) {
      return { ok: false, error: `recovery layout destination already exists: ${dir} — recovery layouts are always fresh` }
    }
  }

  const writtenFiles: string[] = []
  const createdDirs: string[] = []
  const cleanup = async (reason: string): Promise<{ ok: false; error: string }> => {
    const removed: string[] = []
    const leftAlone: string[] = []
    for (const f of [...writtenFiles].reverse()) {
      const st = lstatSync(f, { throwIfNoEntry: false })
      if (!st) continue
      if (st.isSymbolicLink() || !st.isFile()) {
        leftAlone.push(f)
        continue
      }
      try {
        await rm(f, { force: false })
        removed.push(f)
      } catch {
        leftAlone.push(f)
      }
    }
    // Deepest-first: a parent rmdir only succeeds once its children are gone.
    for (const d of [...createdDirs].sort(
      (a, b) => b.split(path.sep).length - a.split(path.sep).length || b.length - a.length,
    )) {
      await rmdir(d).catch(() => undefined) // succeeds only when empty
    }
    const note =
      leftAlone.length > 0
        ? `; ${leftAlone.length} written path(s) were no longer regular files and were left untouched`
        : ''
    return {
      ok: false,
      error: `${reason} (partial failure: ${removed.length} file(s) written by this call were removed; pre-existing files and directories were never deleted${note})`,
    }
  }

  await mkdir(uploadsDir, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })
  createdDirs.push(uploadsDir, evidenceDir, path.dirname(dbPath), input.recoveryAppRoot)
  try {
    for (const [label, srcDir, targetDir] of [
      ['uploads', input.restoredUploadsDir, uploadsDir],
      ['evidence', input.restoredEvidenceDir, evidenceDir],
    ] as const) {
      const entries = await readdir(srcDir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isSymbolicLink()) {
          return cleanup(
            `unexpected symbolic link in restored ${label} storage: ${e.name} — restored upload/evidence storage must contain real files only; symlinks are never followed (fail-closed)`,
          )
        }
        if (!e.isFile()) {
          return cleanup(
            `unexpected non-regular-file entry in restored ${label} storage: ${e.name} (${e.isDirectory() ? 'subdirectory' : 'special file'}) — the backup manifest models flat storage roots; refusing`,
          )
        }
        const target = path.join(targetDir, e.name)
        const pre = lstatSync(target, { throwIfNoEntry: false })
        if (pre) {
          return cleanup(`recovery destination appeared during layout population: ${target} — refusing (never overwrites)`)
        }
        await copyFile(path.join(srcDir, e.name), target)
        const post = lstatSync(target, { throwIfNoEntry: false })
        if (!post || post.isSymbolicLink() || !post.isFile()) {
          return cleanup(`recovery destination ${target} is no longer the regular file this call wrote (suspected symlink swap) — refusing`)
        }
        writtenFiles.push(target)
      }
    }
    const dbPre = lstatSync(dbPath, { throwIfNoEntry: false })
    if (dbPre) return cleanup(`recovery destination appeared during layout population: ${dbPath} — refusing (never overwrites)`)
    await copyFile(input.dbSourcePath, dbPath)
    const dbPost = lstatSync(dbPath, { throwIfNoEntry: false })
    if (!dbPost || dbPost.isSymbolicLink() || !dbPost.isFile()) {
      return cleanup(`recovery database destination ${dbPath} is no longer the regular file this call wrote (suspected symlink swap) — refusing`)
    }
    writtenFiles.push(dbPath)
  } catch (err) {
    return cleanup(`recovery layout population failed: ${err instanceof Error ? err.message : String(err)}`)
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

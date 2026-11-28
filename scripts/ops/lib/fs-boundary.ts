// ─── OPS-2.1: shared FILESYSTEM-BOUNDARY validation (symlink-safe) ────────────
//
// Independent review finding: `assertDisjointRoots()` relied on lexical
// `path.resolve()` comparisons. A lexical resolve never consults the
// filesystem, so when an existing path component is a SYMBOLIC LINK the
// "resolved" destination is not the location the bytes would actually land
// in. A destination root (or any ancestor of it) that is a symlink pointing
// into a protected root — or into any location outside the intended recovery
// layout — therefore passed every lexical check while recovery writes would
// have followed the link onto foreign ground.
//
// This module is the single shared mechanism every restore/backup boundary
// check now uses. Core rules:
//
//   1. ACTUAL location: for a path whose components may not all exist, the
//      longest EXISTING prefix is resolved with realpath(3) and the remaining
//      (nonexistent) tail is appended lexically — nonexistent components
//      cannot be symlinks yet, so lexical resolution of the tail is exact.
//      `realpath()` alone cannot resolve such paths; `path.resolve()` alone
//      resolves nothing at all. This is the only honest combination.
//   2. SYMLINK REFUSAL for destinations: every EXISTING component of a
//      destination path is lstat(2)-checked; any symbolic link — in the leaf
//      or in any ancestor — refuses the operation with a named reason.
//      Policy: recovery writes must land on real filesystem locations, never
//      THROUGH symlinks. (Documented fail-closed policy; no opt-out exists
//      because no verified safe design for symlinked recovery destinations
//      has been demonstrated.)
//   3. REAL-FILE refusal for opened files: a database or file the toolkit
//      opens must lstat as a regular file (never a symlink alias — a symlink
//      could alias the ISOLATED copy to the LIVE database) and must be
//      reached without symlinked ancestors.
//   4. Containment is compared on ACTUAL locations, both directions (the
//      destination must not be inside a protected root AND must not contain
//      one).
//
// Residual race limitation (documented honestly, not hidden):
//   POSIX offers no portable way to atomically validate every ancestor of a
//   path AND perform the subsequent write as one operation. A local attacker
//   with write access to a destination's parent directories can swap a
//   validated component into a symlink between validation and use (TOCTOU).
//   The toolkit narrows this window to the practical minimum:
//     • validation is repeated at the point of write (materialization
//       re-scans immediately before each write and re-verifies after it);
//     • the final path component is created with O_CREAT|O_EXCL ("wx"), a
//       race-free kernel guarantee: the open fails if the leaf exists —
//       including when the leaf is a symlink (even a dangling one) — so a
//       swapped leaf can never be followed and an existing file can never be
//       overwritten;
//     • after every write the leaf is lstat-re-verified as a regular file.
//   Complete TOCTOU elimination on ancestor components is NOT claimed.

import { lstatSync, readdirSync, realpathSync, type Dirent } from 'node:fs'
import path from 'node:path'

export interface PathScan {
  /**
   * The ACTUAL filesystem location: realpath of the longest existing prefix,
   * with the lexical nonexistent tail appended.
   */
  actual: string
  /** Existing components that are symbolic links (absolute paths), in order. */
  symlinks: string[]
  /** Longest existing prefix (absolute; may be the filesystem root). */
  existingPrefix: string
}

function filesystemRoot(): string {
  return path.parse(path.resolve('/')).root // '/' on POSIX, 'C:\' on Windows
}

/** Every absolute component path of `p`, e.g. /a → ['/a'], /a/b → ['/a', '/a/b']. */
function walkComponents(p: string): string[] {
  const norm = path.resolve(p)
  const parts = norm.split(path.sep).filter((s) => s.length > 0)
  const out: string[] = []
  let acc = ''
  for (const part of parts) {
    acc = acc + path.sep + part
    out.push(acc)
  }
  return out
}

/**
 * Resolve `p`'s ACTUAL filesystem location without assuming every component
 * exists. Walks the components with lstat: existing ones are accumulated (and
 * any symlink recorded); the longest existing prefix is realpath-resolved; the
 * nonexistent tail is appended lexically (exact, because a component that does
 * not exist cannot be a symlink yet).
 */
export function scanPath(candidate: string): PathScan {
  const norm = path.resolve(candidate)
  const root = filesystemRoot()
  const comps = walkComponents(norm)
  let existingPrefix = root
  const symlinks: string[] = []
  for (const c of comps) {
    const st = lstatSync(c, { throwIfNoEntry: false })
    if (!st) break // c and everything below it does not exist
    existingPrefix = c
    if (st.isSymbolicLink()) symlinks.push(c)
  }
  let actual: string
  try {
    actual = realpathSync(existingPrefix)
  } catch {
    // existingPrefix existed at lstat time but vanished between the lstat walk
    // and realpath (race). Fall back to the lexical prefix — the callers'
    // own existence checks own the decision.
    actual = existingPrefix
  }
  const idx = comps.indexOf(existingPrefix)
  const tail = idx >= 0 ? comps.slice(idx + 1) : comps
  if (tail.length > 0) actual = path.join(actual, ...tail)
  return { actual, symlinks, existingPrefix }
}

export type BoundaryResult = { ok: true; actual: string } | { ok: false; error: string }

function isInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep)
}

/** Either location inside the other. */
function overlaps(a: string, b: string): boolean {
  return isInside(a, b) || isInside(b, a)
}

/**
 * Filesystem-real destination-root validation (the replacement for relying on
 * lexical `path.resolve()`):
 *   • the candidate must be an absolute path;
 *   • NO existing component of the destination may be a symbolic link
 *     (leaf or ancestor — see the module header for the documented policy);
 *   • the candidate's ACTUAL filesystem location must be disjoint from every
 *     protected root's ACTUAL location (neither may contain the other).
 *
 * Returns the validated actual location so callers can use it for subsequent
 * operations.
 */
export function assertRealDisjointRoots(
  candidate: string,
  forbiddenRoots: string[],
  what: string,
): BoundaryResult {
  const resolved = path.resolve(candidate)
  if (!path.isAbsolute(resolved)) {
    return { ok: false, error: `${what} must be an absolute path (got ${candidate})` }
  }
  const scan = scanPath(resolved)
  if (scan.symlinks.length > 0) {
    return {
      ok: false,
      error:
        `${what} (${resolved}) traverses ${scan.symlinks.length} symbolic link component(s) ` +
        `(${scan.symlinks.join(' → ')}) — recovery destinations must be real filesystem locations, ` +
        'never reached through symlinks; refusing (fail-closed)',
    }
  }
  for (const f of forbiddenRoots) {
    const fActual = scanPath(path.resolve(f)).actual
    // Directional messages are part of the tested contract: the destination
    // must never overlap (sit inside) a protected root, and must never
    // contain one. Both directions are compared on ACTUAL locations.
    if (isInside(scan.actual, fActual)) {
      return {
        ok: false,
        error: `${what} (${scan.actual}) must never overlap the protected root ${fActual} (real-filesystem comparison; lexical path resolution alone cannot detect symlinked destinations)`,
      }
    }
    if (isInside(fActual, scan.actual)) {
      return {
        ok: false,
        error: `${what} (${scan.actual}) must not contain the protected root ${fActual} (real-filesystem comparison; lexical path resolution alone cannot detect symlinked destinations)`,
      }
    }
  }
  return { ok: true, actual: scan.actual }
}

/**
 * A file the toolkit will OPEN — read-only or writable — must be a real
 * regular file at a real location:
 *   • it must exist and lstat as a regular file (a symbolic link is refused
 *     explicitly: an isolated restored database could be aliased to the LIVE
 *     database through a symlink, and a writable open would then modify live
 *     data);
 *   • no component of its path may be a symbolic link;
 *   • its ACTUAL filesystem location must be disjoint from every protected
 *     root's ACTUAL location.
 */
export function assertRealFileLocation(
  p: string,
  forbiddenRoots: string[],
  what: string,
): BoundaryResult {
  const resolved = path.resolve(p)
  if (!path.isAbsolute(resolved)) {
    return { ok: false, error: `${what} must be an absolute path (got ${p})` }
  }
  const st = lstatSync(resolved, { throwIfNoEntry: false })
  if (!st) {
    return { ok: false, error: `${what} does not exist: ${resolved}` }
  }
  if (st.isSymbolicLink()) {
    return {
      ok: false,
      error:
        `${what} (${resolved}) is a symbolic link — it could be an alias to another database or file ` +
        '(e.g. the live database); refusing (fail-closed)',
    }
  }
  if (!st.isFile()) {
    return { ok: false, error: `${what} (${resolved}) is not a regular file` }
  }
  const scan = scanPath(resolved)
  if (scan.symlinks.length > 0) {
    return {
      ok: false,
      error:
        `${what} (${resolved}) is reached through symbolic link component(s) ` +
        `(${scan.symlinks.join(' → ')}) — refusing (fail-closed)`,
    }
  }
  for (const f of forbiddenRoots) {
    const fActual = scanPath(path.resolve(f)).actual
    if (overlaps(scan.actual, fActual)) {
      return {
        ok: false,
        error: `${what} (${scan.actual}) must never overlap the protected root ${fActual} on the REAL filesystem (lexical path resolution alone cannot detect symlink aliases)`,
      }
    }
  }
  return { ok: true, actual: scan.actual }
}

/**
 * Enumerate one flat storage directory WITHOUT following symlinks.
 * `readdir(withFileTypes)` reports the link itself (never its target), so any
 * symbolic-link entry — file, directory, or dangling — is returned to the
 * caller as an explicit refusal candidate. Only true regular files are
 * returned; subdirectories and other node types are reported by name so the
 * caller can fail closed with a precise reason.
 */
export function listFlatStorageEntries(
  root: string,
): { ok: true; files: string[]; symlinks: string[]; others: string[] } | { ok: false; error: string } {
  const st = lstatSync(root, { throwIfNoEntry: false })
  if (st?.isSymbolicLink()) {
    return {
      ok: false,
      error: `storage root (${root}) is a symbolic link — enumeration never follows symlinks into unknown locations; refusing (fail-closed)`,
    }
  }
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { ok: true, files: [], symlinks: [], others: [] } // missing root = empty state
    return { ok: false, error: `could not read storage root (${root}): ${err instanceof Error ? err.message : String(err)}` }
  }
  const files: string[] = []
  const symlinks: string[] = []
  const others: string[] = []
  for (const e of entries) {
    if (e.isSymbolicLink()) symlinks.push(e.name)
    else if (e.isFile()) files.push(e.name)
    else others.push(e.name)
  }
  return { ok: true, files, symlinks, others }
}

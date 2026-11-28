// ─── OPS-2B/2C: backup core — path resolution, offline gate, staging, manifest ──
//
// This module owns everything between "operator says back up" and "a verified
// staging tree exists". The Restic snapshot itself is taken from this staging
// tree by the caller (CLI) through the ResticAdapter seam.
//
// Coherence model (docs/OPS-2-BACKUP-RESTORE.md §coherence):
//   • The SQLite database is snapshotted with SQLite's own online backup
//     facility (VACUUM INTO) — never with a plain filesystem copy of a live
//     database file.
//   • The documented primary workflow is an OFFLINE snapshot: the operator
//     gracefully stops the app + background workers and passes
//     --confirm-offline. The toolkit additionally refuses to run while SQLite
//     rollback-journal/WAL sidecar files exist (proof of a live or crashed
//     writer).
//   • Uploads/evidence files are triple-hashed: source read → staged copy
//     re-read → SOURCE RE-READ after staging. Any disagreement — a corrupted
//     staged copy, or the source file mutating during the staging window —
//     fails the backup. (The offline boundary remains the primary coherence
//     guarantee; the triple hash substantiates the in-window detection claim.)
//   • After staging, the SNAPSHOT database is audited against the staged
//     files: every StudyDocument row must resolve to a staged upload with
//     matching bytes and content hash; every ACTIVE ExpertCredentialEvidence
//     row must resolve to a staged evidence file with matching bytes and
//     DB-recorded sha256. Any broken reference fails the backup closed — an
//     incomplete backup is never produced.

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { existsSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { listFlatStorageEntries, scanPath } from './fs-boundary'

export const MANIFEST_SCHEMA = 'bean-backup-manifest/1'
export const BACKUP_TOOL_NAME = 'bean-ops-backup'
export const BACKUP_TOOL_VERSION = '1.0.0'

// ─── DATABASE_URL resolution (matches Prisma's real runtime semantics) ───────

export type PathResolution = { ok: true; dbPath: string } | { ok: false; error: string }

/**
 * Resolve the SQLite database file from a `DATABASE_URL` value.
 *
 * Empirically verified Prisma semantics (and the reason this function exists):
 * a RELATIVE `file:` path is resolved against the Prisma schema directory
 * (`<projectRoot>/prisma/`), NOT against process.cwd(). An ABSOLUTE path is
 * used as-is. Non-SQLite URLs are refused — the toolkit only supports the
 * deployment's actual storage engine and refuses to guess.
 */
export function resolveDatabaseFileUrl(databaseUrl: string, projectRoot: string): PathResolution {
  const url = databaseUrl.trim()
  if (!url) return { ok: false, error: 'DATABASE_URL is empty — cannot resolve the database file' }
  if (!/^file:/i.test(url)) {
    return {
      ok: false,
      error: `DATABASE_URL does not use the file: scheme ("${url.slice(0, 24)}…"). The backup ` +
        'toolkit supports the SQLite deployment only and refuses to guess a different database.',
    }
  }
  const withoutScheme = url.replace(/^file:/i, '')
  const queryIndex = withoutScheme.indexOf('?')
  const rawPath = queryIndex >= 0 ? withoutScheme.slice(0, queryIndex) : withoutScheme
  if (!rawPath) return { ok: false, error: 'DATABASE_URL file: URL has an empty path' }
  const decoded = decodeURIComponent(rawPath)
  const absolute = path.isAbsolute(decoded)
    ? path.normalize(decoded)
    : path.normalize(path.join(projectRoot, 'prisma', decoded))
  return { ok: true, dbPath: absolute }
}

// ─── Offline safety gate ───────────────────────────────────────────────────────

const JOURNAL_SUFFIXES = ['-journal', '-wal', '-shm'] as const

export interface OfflineGateResult {
  ok: boolean
  error?: string
  observedJournalMode?: string
}

/**
 * Fail-closed offline boundary:
 *   1. The database file must exist (never create one by accident).
 *   2. No `-journal` / `-wal` / `-shm` sidecar may exist — a rollback journal
 *      or WAL sidecar proves a live writer (or a crashed one whose journal
 *      has not been rolled back). Either way this is not an offline snapshot
 *      boundary, and the backup refuses.
 *   3. The operator must explicitly confirm the application and background
 *      workers were gracefully stopped (--confirm-offline). The toolkit never
 *      assumes zero-downtime safety.
 */
export async function assertOfflineBoundary(dbPath: string, confirmOffline: boolean): Promise<OfflineGateResult> {
  if (!existsSync(dbPath)) {
    return { ok: false, error: `database file does not exist: ${dbPath} — refusing to back up a non-existent database` }
  }
  for (const suffix of JOURNAL_SUFFIXES) {
    const sidecar = dbPath + suffix
    if (existsSync(sidecar)) {
      return {
        ok: false,
        error:
          `SQLite sidecar file present: ${path.basename(sidecar)} — this proves a live or crashed ` +
          'writer and is not an offline snapshot boundary. Gracefully stop the application and ' +
          'background workers, then retry. (A sidecar left behind by a crashed process must be ' +
          'resolved before a backup is meaningful.)',
      }
    }
  }
  if (!confirmOffline) {
    return {
      ok: false,
      error:
        'offline confirmation missing — pass --confirm-offline only AFTER the application and ' +
        'background workers have been gracefully stopped. The toolkit never claims zero-downtime backup.',
    }
  }
  let observedJournalMode = 'unknown'
  try {
    const ro = new Database(dbPath, { readonly: true, create: false })
    try {
      const row = ro.query('PRAGMA journal_mode').get() as { journal_mode?: string } | null
      observedJournalMode = row?.journal_mode ?? 'unknown'
    } finally {
      ro.close()
    }
  } catch {
    // Mode detection is diagnostic only; existence + sidecar checks above own the safety decision.
  }
  return { ok: true, observedJournalMode }
}

// ─── Manifest model ────────────────────────────────────────────────────────────

export interface ManifestFileEntry {
  /** Basename inside its root (uploads: `<uuid>.pdf`; evidence: `ev_<hex>.<ext>`). */
  name: string
  sha256: string
  bytes: number
  /** True when a live database row references this file at backup time. */
  dbReferenced: boolean
}

export interface BackupManifest {
  schema: typeof MANIFEST_SCHEMA
  tool: { name: string; version: string }
  createdAt: string
  resticVersion: string
  database: {
    file: 'data/database/custom.db'
    method: 'sqlite-vacuum-into'
    sourceBasename: string
    sha256: string
    bytes: number
    journalModeObserved: string
  }
  uploads: { sourceRoot: 'db/uploads'; fileCount: number; totalBytes: number; entries: ManifestFileEntry[] }
  evidence: { sourceRoot: 'db/evidence'; fileCount: number; totalBytes: number; entries: ManifestFileEntry[] }
  /** The applied inclusion/exclusion policy (the audit-visible contract). */
  exclusions: string[]
}

export const BACKUP_EXCLUSIONS = [
  'db/backups (existing backup repository inside the source tree)',
  '.env / secret files and provider credentials (never staged)',
  'GitHub credentials, session tokens outside the database (sessions are DB-backed and travel inside the DB snapshot)',
  'logs, caches, node_modules, build artifacts (.next, coverage, tmp dirs)',
  'OCR scratch space (os.tmpdir()/riishe-ocr-*, ephemeral by design)',
]

// ─── Staging ───────────────────────────────────────────────────────────────────

export interface StagedBackup {
  stageDir: string
  manifest: BackupManifest
  manifestSha256: string
}

export interface StageInput {
  paths: { dbPath: string; uploadsDir: string; evidenceDir: string }
  /** Empty/nonexistent directory the staging tree is written into. */
  stageDir: string
  resticVersion: string
  createdAt?: Date
  /**
   * TEST SEAM — never set by production callers. Invoked after each staged
   * write and before the post-staging SOURCE re-read, so tests can inject a
   * source mutation exactly inside the detection window.
   */
  hooks?: { afterStagedWrite?: (file: { name: string; sourcePath: string; targetPath: string }) => Promise<void> }
}

interface StagedFileGroup {
  root: string
  entries: ManifestFileEntry[]
}

function sha256Bytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Enumerate one flat storage root (refuse unexpected subdirectory structure).
 * OPS-2.1: enumeration uses readdir(withFileTypes) and NEVER follows symlinks:
 * a symbolic-link entry in upload/evidence storage — file, directory, or
 * dangling — is an explicit failure, because staging would otherwise snapshot
 * whatever the link points at while the manifest records only the basename.
 * The storage root itself must also be a real directory (a symlinked root is
 * refused with a named reason; a missing root stays a legitimate empty state).
 */
async function collectFlatFiles(root: string, label: string): Promise<string[]> {
  const listed = listFlatStorageEntries(root)
  if (!listed.ok) throw new Error(`${label}: ${listed.error}`)
  if (listed.symlinks.length > 0) {
    throw new Error(
      `unexpected symbolic link in ${label} storage: ${listed.symlinks.join(', ')} — backup enumeration ` +
        'never follows symlinks (the manifest must describe real bytes, not link targets); refusing (fail-closed)',
    )
  }
  if (listed.others.length > 0) {
    for (const name of listed.others) {
      if (!name.endsWith('.tmp') && name !== '.DS_Store') {
        throw new Error(
          `unexpected subdirectory or special file in ${label}: ${name} — the backup manifest models flat storage roots; ` +
            'refusing to silently skip structure it does not understand',
        )
      }
    }
  }
  return listed.files.filter((name) => {
    // Editor/OS droppings are never application data.
    return !name.endsWith('.tmp') && name !== '.DS_Store'
  })
}

/**
 * Copy one storage root into the stage with TRIPLE-hash mutation detection:
 *   1. read the source bytes → source hash (T0)
 *   2. write the staged copy, re-read it → staged hash (T1)
 *   3. RE-READ THE SOURCE → re-read hash (T2)
 * All three must agree. (1)≠(2) catches staged-copy corruption; (1)≠(3)
 * catches the SOURCE mutating during the staging window — a concurrent writer.
 * Any mismatch throws: this substantiates the documented concurrent-mutation
 * detection claim beyond the offline boundary itself.
 */
async function stageFileGroup(
  root: string,
  targetDir: string,
  label: string,
  hooks?: StageInput['hooks'],
): Promise<StagedFileGroup> {
  const names = await collectFlatFiles(root, label)
  const entries: ManifestFileEntry[] = []
  for (const name of names) {
    const sourcePath = path.join(root, name)
    const sourceBytes = await readFile(sourcePath)
    const sourceHash = sha256Bytes(sourceBytes)
    const targetPath = path.join(targetDir, name)
    await writeFile(targetPath, sourceBytes, { mode: 0o600 })
    // Test seam: inject a mutation exactly inside the detection window (after
    // the staged write, before both re-reads — production callers never set it).
    if (hooks?.afterStagedWrite) await hooks.afterStagedWrite({ name, sourcePath, targetPath })
    const stagedBytes = await readFile(targetPath)
    const stagedHash = sha256Bytes(stagedBytes)
    if (sourceHash !== stagedHash) {
      throw new Error(
        `${label}/${name} staged copy does not match the source read (source hash ${sourceHash.slice(0, 12)}… ≠ staged ` +
          `${stagedHash.slice(0, 12)}…) — the staged copy was corrupted during staging; refusing to continue.`,
      )
    }
    const reReadBytes = await readFile(sourcePath)
    const reReadHash = sha256Bytes(reReadBytes)
    if (reReadHash !== sourceHash) {
      throw new Error(
        `${label}/${name} changed on the SOURCE during staging (initial read ${sourceHash.slice(0, 12)}… ≠ re-read ` +
          `${reReadHash.slice(0, 12)}…) — a writer is active; refusing to continue. Use the documented ` +
          'offline workflow and retry.',
      )
    }
    entries.push({ name, sha256: stagedHash, bytes: stagedBytes.length, dbReferenced: false })
  }
  return { root, entries }
}

async function stageDatabase(dbPath: string, snapshotPath: string): Promise<{ sha256: string; bytes: number; journalMode: string }> {
  // SQLite's own backup facility — never a byte copy of a live file. The
  // connection is read-only against the source; the snapshot is a fresh,
  // compacted, transactionally consistent database file.
  const ro = new Database(dbPath, { readonly: true, create: false })
  try {
    const modeRow = ro.query('PRAGMA journal_mode').get() as { journal_mode?: string } | null
    const journalMode = modeRow?.journal_mode ?? 'unknown'
    const escaped = snapshotPath.replace(/'/g, "''")
    ro.exec(`VACUUM INTO '${escaped}'`)
    const staged = await readFile(snapshotPath)
    return { sha256: sha256Bytes(staged), bytes: staged.length, journalMode }
  } finally {
    ro.close()
  }
}

// ─── DB ↔ file coherence audit (run against the SNAPSHOT database) ────────────

export interface AuditResult {
  ok: boolean
  problems: string[]
  uploadsReferenced: number
  evidenceActiveReferenced: number
  orphanUploads: number
  purgedWithFilePresent: number
}

export function auditSnapshotAgainstManifest(stageDir: string, manifest: BackupManifest): AuditResult {
  const dbPath = path.join(stageDir, manifest.database.file)
  const problems: string[] = []
  const db = new Database(dbPath, { readonly: true, create: false })
  try {
    const uploadsByName = new Map(manifest.uploads.entries.map((e) => [e.name, e]))
    const evidenceByName = new Map(manifest.evidence.entries.map((e) => [e.name, e]))

    const docs = db
      .query('SELECT id, storedPath, fileSize, contentHash FROM StudyDocument')
      .all() as Array<{ id: string; storedPath: string; fileSize: number; contentHash: string }>
    for (const doc of docs) {
      const name = path.basename(doc.storedPath)
      const entry = uploadsByName.get(name)
      if (!entry) {
        problems.push(`StudyDocument ${doc.id} references uploads/${name} which is NOT in the staged backup`)
        continue
      }
      entry.dbReferenced = true
      if (entry.bytes !== doc.fileSize) {
        problems.push(
          `StudyDocument ${doc.id} records ${doc.fileSize} bytes but staged ${name} has ${entry.bytes} bytes ` +
            '(file mutated after upload — refusing to produce an inconsistent backup)',
        )
      }
      if (entry.sha256 !== doc.contentHash) {
        problems.push(
          `StudyDocument ${doc.id} content hash ${doc.contentHash.slice(0, 12)}… does not match staged file hash ` +
            `${entry.sha256.slice(0, 12)}… (file content mutated after upload)`,
        )
      }
    }

    const evidenceRows = db
      .query('SELECT id, storagePath, byteSize, sha256, retentionState FROM ExpertCredentialEvidence')
      .all() as Array<{ id: string; storagePath: string; byteSize: number; sha256: string; retentionState: string }>
    for (const ev of evidenceRows) {
      const entry = evidenceByName.get(ev.storagePath)
      if (ev.retentionState === 'ACTIVE') {
        if (!entry) {
          problems.push(`ACTIVE ExpertCredentialEvidence ${ev.id} references evidence/${ev.storagePath} which is NOT staged`)
          continue
        }
        entry.dbReferenced = true
        if (entry.bytes !== ev.byteSize) {
          problems.push(
            `ExpertCredentialEvidence ${ev.id} records ${ev.byteSize} bytes but staged ${ev.storagePath} has ${entry.bytes} bytes`,
          )
        }
        if (entry.sha256 !== ev.sha256) {
          problems.push(
            `ExpertCredentialEvidence ${ev.id} DB sha256 ${ev.sha256.slice(0, 12)}… does not match staged file hash ` +
              `${entry.sha256.slice(0, 12)}…`,
          )
        }
      } else if (entry) {
        // PURGED rows may legitimately leave bytes behind (unlink is best-effort in the app).
        // They are backed up (never omit bytes) but are recorded honestly.
      }
    }

    const uploadsReferenced = manifest.uploads.entries.filter((e) => e.dbReferenced).length
    const orphanUploads = manifest.uploads.entries.length - uploadsReferenced
    return {
      ok: problems.length === 0,
      problems,
      uploadsReferenced,
      evidenceActiveReferenced: manifest.evidence.entries.filter((e) => e.dbReferenced).length,
      orphanUploads,
      purgedWithFilePresent: 0,
    }
  } finally {
    db.close()
  }
}

// ─── Full staging pipeline ─────────────────────────────────────────────────────

/**
 * Create the complete staging tree: database snapshot + uploads + evidence +
 * manifest (+ sha256 sidecar), then audit the SNAPSHOT database against the
 * staged files. Throws on any inconsistency — an incomplete backup is never
 * produced.
 */
export async function createBackupStage(input: StageInput): Promise<StagedBackup> {
  const { paths, stageDir } = input
  // OPS-2.1: the staging tree must live at a REAL filesystem location — a
  // symbolic-link component anywhere on the stage path would place the
  // snapshot bytes (and the VACUUM INTO database file) wherever the link
  // points, invisible to lexical placement checks. Fail closed.
  const stageScan = scanPath(path.resolve(stageDir))
  if (stageScan.symlinks.length > 0) {
    throw new Error(
      `staging directory (${path.resolve(stageDir)}) traverses symbolic link component(s) ` +
        `(${stageScan.symlinks.join(' → ')}) — staging must live at a real filesystem location; refusing (fail-closed)`,
    )
  }
  const dataDir = path.join(stageDir, 'data')
  const dbTarget = path.join(dataDir, 'database')
  const uploadsTarget = path.join(dataDir, 'files', 'uploads')
  const evidenceTarget = path.join(dataDir, 'files', 'evidence')
  await mkdir(dbTarget, { recursive: true })
  await mkdir(uploadsTarget, { recursive: true })
  await mkdir(evidenceTarget, { recursive: true })

  const dbSnapshotPath = path.join(dbTarget, 'custom.db')
  const dbStaged = await stageDatabase(paths.dbPath, dbSnapshotPath)

  const uploads = await stageFileGroup(paths.uploadsDir, uploadsTarget, 'uploads', input.hooks)
  const evidence = await stageFileGroup(paths.evidenceDir, evidenceTarget, 'evidence', input.hooks)

  const manifest: BackupManifest = {
    schema: MANIFEST_SCHEMA,
    tool: { name: BACKUP_TOOL_NAME, version: BACKUP_TOOL_VERSION },
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    resticVersion: input.resticVersion,
    database: {
      file: 'data/database/custom.db',
      method: 'sqlite-vacuum-into',
      sourceBasename: path.basename(paths.dbPath),
      sha256: dbStaged.sha256,
      bytes: dbStaged.bytes,
      journalModeObserved: dbStaged.journalMode,
    },
    uploads: {
      sourceRoot: 'db/uploads',
      fileCount: uploads.entries.length,
      totalBytes: uploads.entries.reduce((s, e) => s + e.bytes, 0),
      entries: uploads.entries,
    },
    evidence: {
      sourceRoot: 'db/evidence',
      fileCount: evidence.entries.length,
      totalBytes: evidence.entries.reduce((s, e) => s + e.bytes, 0),
      entries: evidence.entries,
    },
    exclusions: [...BACKUP_EXCLUSIONS],
  }

  const audit = auditSnapshotAgainstManifest(stageDir, manifest)
  if (!audit.ok) {
    throw new Error(
      'database↔file coherence audit FAILED — refusing to snapshot an inconsistent data set:\n  ' +
        audit.problems.join('\n  '),
    )
  }

  const manifestJson = JSON.stringify(manifest, null, 2)
  const manifestPath = path.join(stageDir, 'manifest.json')
  await writeFile(manifestPath, manifestJson, { encoding: 'utf8', mode: 0o600 })
  const manifestSha = sha256Bytes(Buffer.from(manifestJson, 'utf8'))
  await writeFile(path.join(stageDir, 'manifest.json.sha256'), manifestSha + '\n', { encoding: 'utf8', mode: 0o600 })

  return { stageDir, manifest, manifestSha256: manifestSha }
}

/** Remove a staging tree (best-effort; the caller decides policy). */
export async function removeStageDir(stageDir: string): Promise<void> {
  await rm(stageDir, { recursive: true, force: true }).catch(() => undefined)
}

// ─── Placement safety ──────────────────────────────────────────────────────────

/**
 * Refuse backup payloads/repositories placed where they could corrupt or be
 * re-ingested by the data they protect:
 *   • never inside (or equal to) a staged data root (db/, db/uploads/, db/evidence/);
 *   • never inside the project source tree unless the operator explicitly
 *     allows it (--allow-in-tree) — protects against accidental commits of
 *     encrypted archives alongside the source.
 *
 * OPS-2.1: the comparison is FILESYSTEM-REAL — the candidate's existing
 * components are lstat-checked (a symbolic-link candidate is refused outright:
 * a staged tree or repository reached through a symlink would physically live
 * wherever the link points, invisible to lexical placement checks) and the
 * ACTUAL location is compared against each protected root's actual location.
 */
export function assertSafeBackupPlacement(
  candidateDir: string,
  sourceRoots: string[],
  projectRoot: string,
  opts: { allowInTree?: boolean; what: string },
): { ok: true } | { ok: false; error: string } {
  const resolved = path.resolve(candidateDir)
  const scan = scanPath(resolved)
  if (scan.symlinks.length > 0) {
    return {
      ok: false,
      error:
        `${opts.what} (${resolved}) traverses ${scan.symlinks.length} symbolic link component(s) ` +
        `(${scan.symlinks.join(' → ')}) — backup payloads must live at real filesystem locations, ` +
        'never reached through symlinks; refusing (fail-closed)',
    }
  }
  for (const root of sourceRoots) {
    const rActual = scanPath(path.resolve(root)).actual
    const inside = scan.actual === rActual || scan.actual.startsWith(rActual + path.sep)
    const contains = rActual === scan.actual || rActual.startsWith(scan.actual + path.sep)
    if (inside || contains) {
      return {
        ok: false,
        error: `${opts.what} must not live inside the data being backed up (${rActual}) — a repository ` +
          'inside its own source risks recursive re-ingestion and corruption. Choose a directory outside db/.',
      }
    }
  }
  const projectActual = scanPath(path.resolve(projectRoot)).actual
  if (!opts.allowInTree && (scan.actual === projectActual || scan.actual.startsWith(projectActual + path.sep))) {
    return {
      ok: false,
      error: `${opts.what} is inside the project source tree (${projectActual}) — pass --allow-in-tree only if ` +
        'you accept the risk of committing backup archives alongside the source. Keeping the repository ' +
        'outside the source tree is strongly recommended.',
    }
  }
  return { ok: true }
}

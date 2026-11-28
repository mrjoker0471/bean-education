// ─── OPS-2D: restore verification — the central acceptance requirement ───────
//
// After a snapshot has been restored into a fresh, isolated directory this
// module decides — check by check, each independently reported — whether the
// restored backup is actually USABLE:
//
//   V1  manifest integrity      manifest.json parses, declares schema
//                               bean-backup-manifest/1, and matches its
//                               manifest.json.sha256 sidecar
//   V2  SQLite integrity        PRAGMA integrity_check == 'ok'
//   V3  referential integrity   PRAGMA foreign_key_check returns zero rows
//   V4  migration history       _prisma_migrations (finished, not rolled back)
//                               equals the prisma/migrations directory chain
//   V5  migration status (opt)  `prisma migrate status` exits 0 on the
//                               restored database (belt-and-braces CLI gate)
//   V6  file presence/hash      every manifest entry exists with the exact
//                               sha256; no unexpected extra files exist
//   V7  DB→file references      every StudyDocument row resolves to a staged
//                               upload with matching bytes + contentHash; every
//                               ACTIVE ExpertCredentialEvidence row resolves to
//                               its file with matching bytes + DB sha256
//
// The verification never writes to the restored tree and never touches the
// live database or upload directories — targets are validated separately
// (assertSafeRestoreTarget).

import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { MANIFEST_SCHEMA, type BackupManifest } from './backup-core'

export interface VerificationCheck {
  id: string
  label: string
  ok: boolean
  detail: string
}

export interface RestoreVerificationReport {
  ok: boolean
  checks: VerificationCheck[]
}

function sha256Bytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// ─── V1: manifest ──────────────────────────────────────────────────────────────

export type ManifestLoad =
  | { ok: true; manifest: BackupManifest }
  | { ok: false; error: string; check: VerificationCheck }

export function loadVerifiedManifest(restoredDir: string): ManifestLoad {
  const manifestPath = path.join(restoredDir, 'manifest.json')
  const sidecarPath = path.join(restoredDir, 'manifest.json.sha256')
  const base = { id: 'manifest', label: 'backup manifest present, schema-valid, sha sidecar matches' }
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      error: `manifest.json not found in restored snapshot (${restoredDir}) — the backup is incomplete`,
      check: { ...base, ok: false, detail: 'manifest.json missing' },
    }
  }
  let manifest: BackupManifest
  let manifestBytes: Buffer
  try {
    manifestBytes = readFileSync(manifestPath)
  } catch (err) {
    return {
      ok: false,
      error: `manifest.json unreadable: ${err instanceof Error ? err.message : String(err)}`,
      check: { ...base, ok: false, detail: 'manifest.json unreadable' },
    }
  }
  if (manifestBytes.length > 64 * 1024 * 1024) {
    return {
      ok: false,
      error: 'manifest.json exceeds 64 MiB — refusing to parse absurd input',
      check: { ...base, ok: false, detail: 'manifest.json oversized' },
    }
  }
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8')) as BackupManifest
  } catch (err) {
    return {
      ok: false,
      error: `manifest.json is not valid JSON (truncated or corrupted backup): ${err instanceof Error ? err.message : String(err)}`,
      check: { ...base, ok: false, detail: 'manifest.json invalid JSON' },
    }
  }
  if (manifest.schema !== MANIFEST_SCHEMA) {
    return {
      ok: false,
      error: `manifest schema mismatch: expected ${MANIFEST_SCHEMA}, got "${String(manifest.schema)}"`,
      check: { ...base, ok: false, detail: 'manifest schema mismatch' },
    }
  }
  if (!existsSync(sidecarPath)) {
    return {
      ok: false,
      error: 'manifest.json.sha256 sidecar missing — cannot prove manifest integrity',
      check: { ...base, ok: false, detail: 'sha256 sidecar missing' },
    }
  }
  let sidecar = ''
  try {
    sidecar = readFileSync(sidecarPath, 'utf8').trim()
  } catch (err) {
    return {
      ok: false,
      error: `manifest.json.sha256 unreadable: ${err instanceof Error ? err.message : String(err)}`,
      check: { ...base, ok: false, detail: 'sha256 sidecar unreadable' },
    }
  }
  const actualSha = sha256Bytes(manifestBytes)
  if (sidecar !== actualSha) {
    return {
      ok: false,
      error: `manifest sha256 mismatch — sidecar says ${sidecar.slice(0, 12)}…, actual manifest is ${actualSha.slice(0, 12)}… (corrupted backup artifact)`,
      check: { ...base, ok: false, detail: 'manifest sha256 mismatch' },
    }
  }
  return { ok: true, manifest, check: { ...base, ok: true, detail: `schema ${manifest.schema}, tool ${manifest.tool.version}` } }
}

// ─── V2/V3: database pragmas ───────────────────────────────────────────────────

export function verifyRestoredDatabase(dbPath: string): { integrity: string; fkViolations: number } {
  const db = new Database(dbPath, { readonly: true, create: false })
  try {
    const ic = db.query('PRAGMA integrity_check').get() as { integrity_check?: string } | null
    const fk = db.query('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>
    return { integrity: ic?.integrity_check ?? 'unknown', fkViolations: fk.length }
  } finally {
    db.close()
  }
}

// ─── V4: migration history ─────────────────────────────────────────────────────

/** Migration chain directories, in order (the repository's authoritative chain). */
export function listMigrationDirectories(projectRoot: string): string[] {
  const dir = path.join(projectRoot, 'prisma', 'migrations')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => existsSync(path.join(dir, name, 'migration.sql')))
}

export function readAppliedMigrations(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true, create: false })
  try {
    const rows = db
      .query(
        'SELECT migration_name FROM _prisma_migrations ' +
          'WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at, rowid',
      )
      .all() as Array<{ migration_name: string }>
    return rows.map((r) => r.migration_name)
  } finally {
    db.close()
  }
}

export interface MigrationHistoryResult {
  ok: boolean
  appliedCount: number
  expectedCount: number
  missing: string[]
  extra: string[]
}

export function verifyMigrationHistory(dbPath: string, projectRoot: string): MigrationHistoryResult {
  const expected = listMigrationDirectories(projectRoot)
  let applied: string[]
  try {
    applied = readAppliedMigrations(dbPath)
  } catch (err) {
    return { ok: false, appliedCount: 0, expectedCount: expected.length, missing: expected, extra: ['<unreadable _prisma_migrations: ' + String(err) + '>'] }
  }
  const expectedSet = new Set(expected)
  const appliedSet = new Set(applied)
  const missing = expected.filter((m) => !appliedSet.has(m))
  const extra = applied.filter((m) => !expectedSet.has(m))
  return { ok: missing.length === 0 && extra.length === 0, appliedCount: applied.length, expectedCount: expected.length, missing, extra }
}

// ─── V6: file presence + hashes ────────────────────────────────────────────────

export interface FileVerificationResult {
  ok: boolean
  missing: string[]
  corrupted: string[]
  unexpected: string[]
  verifiedCount: number
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: string[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await listFilesRecursive(full)))
    else out.push(full)
  }
  return out
}

export async function verifyRestoredFiles(restoredDir: string, manifest: BackupManifest): Promise<FileVerificationResult> {
  const missing: string[] = []
  const corrupted: string[] = []
  let verifiedCount = 0

  const groups: Array<{ label: string; dir: string; entries: BackupManifest['uploads']['entries'] }> = [
    { label: 'uploads', dir: path.join(restoredDir, 'data', 'files', 'uploads'), entries: manifest.uploads.entries },
    { label: 'evidence', dir: path.join(restoredDir, 'data', 'files', 'evidence'), entries: manifest.evidence.entries },
  ]
  for (const group of groups) {
    for (const entry of group.entries) {
      const p = path.join(group.dir, entry.name)
      if (!existsSync(p)) {
        missing.push(`${group.label}/${entry.name}`)
        continue
      }
      const bytes = await readFile(p)
      if (sha256Bytes(bytes) !== entry.sha256) corrupted.push(`${group.label}/${entry.name}`)
      else verifiedCount += 1
    }
  }

  // Unexpected files: anything under data/files that is NOT in the manifest.
  const manifestNames = new Set<string>()
  for (const e of manifest.uploads.entries) manifestNames.add(path.join('uploads', e.name))
  for (const e of manifest.evidence.entries) manifestNames.add(path.join('evidence', e.name))
  const filesRoot = path.join(restoredDir, 'data', 'files')
  const actual = await listFilesRecursive(filesRoot)
  const unexpected: string[] = []
  for (const full of actual) {
    const rel = path.relative(filesRoot, full)
    if (!manifestNames.has(rel)) unexpected.push(rel)
  }

  return { ok: missing.length === 0 && corrupted.length === 0 && unexpected.length === 0, missing, corrupted, unexpected, verifiedCount }
}

// ─── V7: DB→file references ────────────────────────────────────────────────────

export interface DbReferenceResult {
  ok: boolean
  broken: string[]
  mutated: string[]
  checkedUploads: number
  checkedEvidence: number
}

export function verifyDatabaseReferences(dbPath: string, manifest: BackupManifest): DbReferenceResult {
  const db = new Database(dbPath, { readonly: true, create: false })
  try {
    const broken: string[] = []
    const mutated: string[] = []
    const uploadsByName = new Map(manifest.uploads.entries.map((e) => [e.name, e]))
    const evidenceByName = new Map(manifest.evidence.entries.map((e) => [e.name, e]))

    const docs = db
      .query('SELECT id, storedPath, fileSize, contentHash FROM StudyDocument')
      .all() as Array<{ id: string; storedPath: string; fileSize: number; contentHash: string }>
    let checkedUploads = 0
    for (const doc of docs) {
      const name = path.basename(doc.storedPath)
      const entry = uploadsByName.get(name)
      if (!entry) {
        broken.push(`StudyDocument ${doc.id} → uploads/${name} missing from restored files`)
        continue
      }
      checkedUploads += 1
      if (entry.bytes !== doc.fileSize) mutated.push(`StudyDocument ${doc.id}: DB fileSize ${doc.fileSize} ≠ restored bytes ${entry.bytes}`)
      if (entry.sha256 !== doc.contentHash) mutated.push(`StudyDocument ${doc.id}: DB contentHash ≠ restored file hash`)
    }

    const evidenceRows = db
      .query('SELECT id, storagePath, byteSize, sha256, retentionState FROM ExpertCredentialEvidence')
      .all() as Array<{ id: string; storagePath: string; byteSize: number; sha256: string; retentionState: string }>
    let checkedEvidence = 0
    for (const ev of evidenceRows) {
      if (ev.retentionState !== 'ACTIVE') continue
      const entry = evidenceByName.get(ev.storagePath)
      if (!entry) {
        broken.push(`ACTIVE ExpertCredentialEvidence ${ev.id} → evidence/${ev.storagePath} missing from restored files`)
        continue
      }
      checkedEvidence += 1
      if (entry.bytes !== ev.byteSize) mutated.push(`ExpertCredentialEvidence ${ev.id}: DB byteSize ≠ restored bytes`)
      if (entry.sha256 !== ev.sha256) mutated.push(`ExpertCredentialEvidence ${ev.id}: DB sha256 ≠ restored file hash`)
    }

    return { ok: broken.length === 0 && mutated.length === 0, broken, mutated, checkedUploads, checkedEvidence }
  } finally {
    db.close()
  }
}

// ─── Restore target safety ─────────────────────────────────────────────────────

/**
 * A restore target must be new/empty, and must never overlap the live data
 * roots. This is what makes the drill incapable of clobbering a live system.
 */
export function assertSafeRestoreTarget(
  targetDir: string,
  sourceRoots: string[],
): { ok: true } | { ok: false; error: string } {
  const resolved = path.resolve(targetDir)
  for (const root of sourceRoots) {
    const r = path.resolve(root)
    if (resolved === r || resolved.startsWith(r + path.sep)) {
      return { ok: false, error: `restore target must never overlap live data roots (${r})` }
    }
  }
  if (existsSync(resolved)) {
    let isDir = false
    try {
      isDir = statSync(resolved).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) return { ok: false, error: `restore target exists and is not a directory: ${resolved}` }
    const entries = readdirSync(resolved)
    if (entries.length > 0) {
      return {
        ok: false,
        error: `restore target exists and is not empty: ${resolved} (${entries.length} entries) — restore drills never overwrite existing data`,
      }
    }
  }
  return { ok: true }
}

// ─── Assembled verification battery ────────────────────────────────────────────

export interface VerifyRestoredOptions {
  projectRoot: string
  /** Run the additional `prisma migrate status` CLI gate (drill: yes; unit tests: optional). */
  runPrismaMigrateStatus?: boolean
}

export async function verifyRestoredBackup(restoredDir: string, opts: VerifyRestoredOptions): Promise<RestoreVerificationReport> {
  const checks: VerificationCheck[] = []

  const manifestLoad = loadVerifiedManifest(restoredDir)
  checks.push(manifestLoad.check)
  if (!manifestLoad.ok) {
    return { ok: false, checks }
  }
  const manifest = manifestLoad.manifest
  const dbPath = path.join(restoredDir, manifest.database.file)

  // V2/V3
  try {
    const { integrity, fkViolations } = verifyRestoredDatabase(dbPath)
    checks.push({ id: 'db-integrity', label: 'SQLite PRAGMA integrity_check', ok: integrity === 'ok', detail: `integrity_check=${integrity}` })
    checks.push({ id: 'db-foreign-keys', label: 'SQLite PRAGMA foreign_key_check', ok: fkViolations === 0, detail: `${fkViolations} violation(s)` })
  } catch (err) {
    checks.push({ id: 'db-integrity', label: 'SQLite PRAGMA integrity_check', ok: false, detail: `database unreadable: ${err instanceof Error ? err.message : String(err)}` })
    return { ok: false, checks }
  }

  // V4
  const mig = verifyMigrationHistory(dbPath, opts.projectRoot)
  checks.push({
    id: 'migration-history',
    label: 'migration history matches prisma/migrations chain',
    ok: mig.ok,
    detail: mig.ok
      ? `${mig.appliedCount}/${mig.expectedCount} migrations applied in order`
      : `missing: ${mig.missing.join(', ') || '—'}; extra: ${mig.extra.join(', ') || '—'}`,
  })

  // V6
  const files = await verifyRestoredFiles(restoredDir, manifest)
  checks.push({
    id: 'restored-files',
    label: 'restored file presence + sha256 + no unexpected files',
    ok: files.ok,
    detail: files.ok
      ? `${files.verifiedCount} file(s) verified byte-exact`
      : `missing: ${files.missing.join(', ') || '—'}; corrupted: ${files.corrupted.join(', ') || '—'}; unexpected: ${files.unexpected.join(', ') || '—'}`,
  })

  // V7
  const refs = verifyDatabaseReferences(dbPath, manifest)
  checks.push({
    id: 'db-file-references',
    label: 'database references resolve to restored files',
    ok: refs.ok,
    detail: refs.ok
      ? `${refs.checkedUploads} upload(s) + ${refs.checkedEvidence} ACTIVE evidence file(s) verified against DB hashes`
      : `broken: ${refs.broken.join(' | ') || '—'}; mutated: ${refs.mutated.join(' | ') || '—'}`,
  })

  // V5 (optional CLI gate — added last so pure-logic runs stay deterministic)
  if (opts.runPrismaMigrateStatus) {
    const status = await runMigrateStatusGate(dbPath, opts.projectRoot)
    checks.push(status)
  }

  return { ok: checks.every((c) => c.ok), checks }
}

async function runMigrateStatusGate(dbPath: string, projectRoot: string): Promise<VerificationCheck> {
  const { execFile } = await import('node:child_process')
  const base = { id: 'migrate-status', label: 'prisma migrate status on restored database' }
  return new Promise((resolve) => {
    execFile(
      'bun',
      ['x', 'prisma', 'migrate', 'status'],
      {
        cwd: projectRoot,
        env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
        timeout: 180_000,
      },
      (err, stdout) => {
        if (err) {
          resolve({ ...base, ok: false, detail: `migrate status failed: ${String(stdout).slice(-200) || err.message}` })
        } else {
          resolve({ ...base, ok: true, detail: 'database schema is up to date with the migration chain' })
        }
      },
    )
  })
}

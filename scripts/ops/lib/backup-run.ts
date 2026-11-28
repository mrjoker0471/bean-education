// ─── OPS-2C: backup orchestration (dependency-injected; CLI + tests share it) ──
//
// runBackupFlow drives the full documented workflow:
//   1. offline safety gate (DB exists, no journal/WAL sidecars, --confirm-offline)
//   2. staging tree (SQLite VACUUM INTO snapshot + uploads + evidence + manifest
//      + coherence audit — see backup-core)
//   3. encrypted Restic snapshot of the staging tree
//   4. repository integrity check (restic check; optionally --read-data)
//   5. staging cleanup (kept only when --keep-stage)
//
// Every stage returns an explicit result; any failed or incomplete stage makes
// the whole flow fail (nonzero exit at the CLI). A partial run NEVER reports
// success.

import { mkdir, mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertOfflineBoundary,
  assertSafeBackupPlacement,
  createBackupStage,
  removeStageDir,
  resolveDatabaseFileUrl,
  type BackupManifest,
  type StagedBackup,
} from './backup-core'
import type { ResticAdapter } from './restic'

export const BACKUP_TAG_ROOT = 'bean-education'

export interface BackupFlowInput {
  projectRoot: string
  /** Raw DATABASE_URL (resolved with Prisma's real relative-path semantics). */
  databaseUrl: string
  uploadsDir?: string
  evidenceDir?: string
  repository: string
  confirmOffline: boolean
  verifyData: boolean
  keepStage: boolean
  allowInTree: boolean
  /** Explicit staging parent; default is a private temp directory. */
  stageParent?: string
  now?: Date
}

export interface BackupFlowLogEntry {
  stage: string
  ok: boolean
  detail: string
}

export type BackupFlowResult =
  | {
      ok: true
      log: BackupFlowLogEntry[]
      snapshotId: string
      manifest: BackupManifest
      manifestSha256: string
      stageDir: string
      stageRemoved: boolean
    }
  | { ok: false; log: BackupFlowLogEntry[]; failedStage: string; stageDir?: string; stageRemoved: boolean }

export interface ResolvedBackupSources {
  dbPath: string
  uploadsDir: string
  evidenceDir: string
}

/** Resolve the live data sources the operator CLI will back up. */
export function resolveBackupSources(input: {
  projectRoot: string
  databaseUrl: string
  uploadsDir?: string
  evidenceDir?: string
}): { ok: true; sources: ResolvedBackupSources } | { ok: false; error: string } {
  const db = resolveDatabaseFileUrl(input.databaseUrl, input.projectRoot)
  if (!db.ok) return db
  return {
    ok: true,
    sources: {
      dbPath: db.dbPath,
      uploadsDir: input.uploadsDir ?? path.join(process.cwd(), 'db', 'uploads'),
      evidenceDir: input.evidenceDir ?? path.join(process.cwd(), 'db', 'evidence'),
    },
  }
}

/** Extract a local directory from a restic location spec (for placement checks). */
export function localRepoDir(repository: string): string | null {
  if (/^rest:/i.test(repository) || /^s3:/i.test(repository) || /^rclone:/i.test(repository)) return null
  return repository
}

export async function runBackupFlow(input: BackupFlowInput, adapter: ResticAdapter): Promise<BackupFlowResult> {
  const log: BackupFlowLogEntry[] = []
  let stageDir: string | undefined
  let stageRemoved = false

  const fail = (failedStage: string, error: string): BackupFlowResult => {
    log.push({ stage: failedStage, ok: false, detail: error })
    if (stageDir && !input.keepStage) {
      void removeStageDir(stageDir)
      stageRemoved = true
    }
    return { ok: false, log, failedStage, stageDir, stageRemoved }
  }

  // ── Stage 0: source resolution + placement safety ──
  const sources = resolveBackupSources(input)
  if (!sources.ok) return fail('resolve-sources', sources.error)
  const { dbPath, uploadsDir, evidenceDir } = sources.sources

  const repoDir = localRepoDir(input.repository)
  if (repoDir) {
    const placement = assertSafeBackupPlacement(repoDir, [dbPath, uploadsDir, evidenceDir, path.dirname(dbPath)], input.projectRoot, {
      allowInTree: input.allowInTree,
      what: 'backup repository',
    })
    if (!placement.ok) return fail('placement', placement.error)
  }

  // ── Stage 1: offline gate ──
  const gate = await assertOfflineBoundary(dbPath, input.confirmOffline)
  if (!gate.ok) return fail('offline-gate', gate.error ?? 'offline boundary could not be established')
  log.push({
    stage: 'offline-gate',
    ok: true,
    detail: `database present, no journal/WAL sidecars, operator confirmed offline (journal mode: ${gate.observedJournalMode ?? 'unknown'})`,
  })

  // ── Stage 2: staging tree + manifest + coherence audit ──
  try {
    stageDir = input.stageParent
      ? path.join(input.stageParent, `bean-backup-stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      : await mkdtemp(path.join(tmpdir(), 'bean-backup-stage-'))
    await mkdir(stageDir, { recursive: true })

    const stagePlacement = assertSafeBackupPlacement(stageDir, [dbPath, uploadsDir, evidenceDir, path.dirname(dbPath)], input.projectRoot, {
      allowInTree: input.allowInTree,
      what: 'staging directory',
    })
    if (!stagePlacement.ok) return fail('placement', stagePlacement.error)

    const staged: StagedBackup = await createBackupStage({
      paths: { dbPath, uploadsDir, evidenceDir },
      stageDir,
      resticVersion: adapter.version,
      createdAt: input.now,
    })
    log.push({
      stage: 'staging',
      ok: true,
      detail:
        `db snapshot (${staged.manifest.database.bytes} bytes, VACUUM INTO), ` +
        `${staged.manifest.uploads.fileCount} upload(s) [${staged.manifest.uploads.totalBytes} bytes], ` +
        `${staged.manifest.evidence.fileCount} evidence file(s) [${staged.manifest.evidence.totalBytes} bytes]; ` +
        `manifest sha256 ${staged.manifestSha256.slice(0, 16)}…`,
    })

    // ── Stage 3: encrypted Restic snapshot ──
    const tags = [
      BACKUP_TAG_ROOT,
      `bean-manifest:${staged.manifestSha256.slice(0, 8)}`,
      `bean-db:${staged.manifest.database.sourceBasename}`,
    ]
    const { snapshotId } = await adapter.backupDirectory(stageDir, tags)
    log.push({ stage: 'restic-backup', ok: true, detail: `snapshot ${snapshotId} saved (encrypted repository)` })

    // ── Stage 4: repository integrity check ──
    await adapter.check(input.verifyData)
    log.push({
      stage: 'restic-check',
      ok: true,
      detail: input.verifyData ? 'repository integrity verified (full data read)' : 'repository structural integrity verified',
    })

    // ── Stage 5: cleanup ──
    if (!input.keepStage) {
      await removeStageDir(stageDir)
      stageRemoved = true
      log.push({ stage: 'cleanup', ok: true, detail: 'staging tree removed' })
    } else {
      log.push({ stage: 'cleanup', ok: true, detail: `staging tree kept at ${stageDir} (--keep-stage)` })
    }

    return {
      ok: true,
      log,
      snapshotId,
      manifest: staged.manifest,
      manifestSha256: staged.manifestSha256,
      stageDir,
      stageRemoved,
    }
  } catch (err) {
    return fail('staging-or-repository', err instanceof Error ? err.message : String(err))
  }
}

/** Explicit repository initialization for the operator CLI (never silent). */
export async function initializeBackupRepository(input: {
  repository: string
  allowInTree: boolean
  projectRoot: string
}, adapter: ResticAdapter): Promise<{ ok: true } | { ok: false; error: string }> {
  const repoDir = localRepoDir(input.repository)
  if (repoDir) {
    const placement = assertSafeBackupPlacement(repoDir, [], input.projectRoot, {
      allowInTree: input.allowInTree,
      what: 'backup repository',
    })
    if (!placement.ok) return placement
  }
  if (await adapter.repoInitialized()) {
    return {
      ok: false,
      error:
        'repository already initialized — refusing to reinitialize. Reinitializing an existing restic ' +
        'repository orphans every existing snapshot (they remain readable only until pruned, and the ' +
        'old password becomes useless). If you truly intend to start a NEW repository, delete the ' +
        'directory explicitly yourself.',
    }
  }
  await adapter.initRepository()
  return { ok: true }
}

/** True when a staging parent is usable (exists or can be created). */
export async function ensureStageParent(parent: string): Promise<void> {
  if (!existsSync(parent)) await mkdir(parent, { recursive: true })
}

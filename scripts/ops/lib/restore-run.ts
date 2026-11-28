// ─── OPS-2D: restore drill orchestration (real workflow; CLI + tests share it) ──
//
// Full acceptance drill:
//   1. build the isolated fixture (real migration chain + relational rows +
//      uploads + evidence + orphan + purged row + known hashes)
//   2. back the fixture up through the standard backup flow (own staging tree,
//      encrypted snapshot into a throwaway local repository)
//   3. `check` (structure) + `check --read-data` (full data integrity)
//   4. mutate the ORIGINAL fixture (bytes appended; new rows + file created) —
//      the restore must match the manifest, not the mutated source
//   5. restore the snapshot into a NEW, empty, isolated directory
//   6. run the full verification battery (manifest, integrity_check,
//      foreign_key_check, migration history [+ migrate status], file hashes,
//      DB→file references)
//   7. fault scenarios (--fault): prove corruption / truncation / missing
//      files / repository corruption / interrupted staging are DETECTED and
//      never reported as success
//   8. PATH PORTABILITY proofs (clean runs only — fault runs exit at their
//      injected fault): the restored data set is opened through the
//      application's REAL file-reading logic in child-process probes:
//        canonical — bytes materialised at the exact recorded absolute paths;
//        remap     — validated storedPath remapping onto a fresh recovery
//                    app-data layout (never touching the original backup,
//                    the fixture or any live database)
//   9. clean up every temporary artifact unless retention is explicitly requested
//
// The drill never touches a live database, upload directory or evidence
// directory: targets are validated, and every path it creates lives in its own
// temp roots.

import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildBackupFixture, mutateFixtureAfterBackup, type BackupFixture, type FixtureMutation } from './fixture'
import { runBackupFlow, BACKUP_TAG_ROOT } from './backup-run'
import { createBackupStage, removeStageDir } from './backup-core'
import { assertSafeRestoreTarget, verifyRestoredBackup, verifyRestoredDatabase, verifyDatabaseReferences, verifyMigrationHistory, loadVerifiedManifest } from './restore-verify'
import {
  planCanonicalMaterialization,
  materializeCanonicalFiles,
  planUploadsRemap,
  applyUploadsRemap,
  populateRecoveryLayout,
  runPortabilityProbe,
  sha256File,
} from './restore-path-mapping'
import type { ResticAdapter } from './restic'

export type RestoreDrillFault =
  | 'corrupt-file'        // flip one byte inside a restored upload → hash verification must fail
  | 'corrupt-manifest'    // truncate manifest.json in the restored copy → manifest check must fail
  | 'missing-file'        // delete one restored file → presence verification must fail
  | 'repo-corruption'     // corrupt a pack file in the repository → restic check must fail
  | 'incomplete-manifest' // snapshot a stage WITHOUT its manifest → restored verification must fail

export const RESTORE_DRILL_FAULTS: RestoreDrillFault[] = [
  'corrupt-file',
  'corrupt-manifest',
  'missing-file',
  'repo-corruption',
  'incomplete-manifest',
]

export interface RestoreDrillInput {
  projectRoot: string
  /** Optional existing repository (must be initialized); default: throwaway local repo. */
  repository?: string
  snapshotId?: string // reserved for future operator re-verification; drill verifies its own snapshot
  fixtureRoot?: string
  restoreTarget?: string
  keep?: boolean
  fault?: RestoreDrillFault
  runMigrateStatus?: boolean
  now?: Date
}

export interface RestoreDrillStep {
  step: string
  ok: boolean
  detail: string
}

export interface DrillVerificationReport {
  ok: boolean
  checks: Array<{ id: string; label: string; ok: boolean; detail: string }>
}

export interface PathPortabilityProof {
  canonical: { documentsChecked: number; evidenceChecked: number; rangeChecks: number; canonicalRoot: string }
  remap: { rowsRemapped: number; originalRoot: string; newRoot: string; documentsChecked: number; evidenceChecked: number }
}

export type RestoreDrillResult =
  | {
      ok: true
      steps: RestoreDrillStep[]
      snapshotId: string
      fixture?: BackupFixture
      mutation?: FixtureMutation
      report?: DrillVerificationReport
      portability?: PathPortabilityProof
      targetDir?: string
      dirsToKeep?: string[]
    }
  | { ok: false; steps: RestoreDrillStep[]; failedStep: string }

interface DrillDirs {
  workRoot: string
  fixtureRoot: string
  repoDir: string
  targetDir: string
  stageParent: string
}

async function prepareDrillDirs(input: RestoreDrillInput, adapter: ResticAdapter): Promise<DrillDirs> {
  const workRoot = await mkdtemp(path.join(tmpdir(), 'bean-ops2-drill-'))
  return {
    workRoot,
    fixtureRoot: input.fixtureRoot ?? path.join(workRoot, 'fixture'),
    // The caller's adapter owns the repository location; an explicitly passed
    // input.repository wins, then the adapter's own local directory, then a
    // private default inside the drill work root.
    repoDir: input.repository ?? adapter.repositoryDir ?? path.join(workRoot, 'restic-repo'),
    targetDir: input.restoreTarget ?? path.join(workRoot, 'restore-target'),
    stageParent: path.join(workRoot, 'stage'),
  }
}

/** Flip one byte inside a file (fault injection for corruption scenarios). */
async function flipOneByte(p: string): Promise<void> {
  const buf = await readFile(p)
  const idx = Math.max(0, buf.length - 2)
  buf[idx] = buf[idx] ^ 0xff
  await writeFile(p, buf, { mode: 0o600 })
}

/**
 * Byte-for-byte state of a flat uploads directory: sorted `name:sha256` pairs.
 * OPS-2.1: enumerated with readdir(withFileTypes) — symbolic links and other
 * non-regular entries are an explicit failure (never followed), so a swapped
 * entry can never silently pass the preserve/restore byte comparison.
 */
async function snapshotUploadsDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.isSymbolicLink()) {
      throw new Error(`unexpected symbolic link in the uploads directory state snapshot: ${path.join(dir, e.name)} — never followed (fail-closed)`)
    }
    if (!e.isFile()) {
      throw new Error(`unexpected non-regular-file entry in the uploads directory state snapshot: ${path.join(dir, e.name)} — refusing`)
    }
    out.push(`${e.name}:${await sha256File(path.join(dir, e.name))}`)
  }
  return out
}

/**
 * Restic stores the ORIGINAL absolute source path inside a snapshot, so
 * `restore --target T` recreates `<T>/<original-absolute-path>/…`. The
 * staging tree's root is uniquely identifiable by its manifest.json +
 * manifest.json.sha256 pair — search a bounded depth for exactly one such
 * directory. A missing pair (incomplete backup) falls back to the target
 * itself so verification reports the truth instead of guessing.
 */
async function locateRestoredRoot(targetDir: string): Promise<{ root: string; located: boolean }> {
  let queue = [targetDir]
  const found: string[] = []
  for (let depth = 0; depth <= 24 && queue.length > 0; depth++) {
    const next: string[] = []
    for (const dir of queue) {
      if (existsSync(path.join(dir, 'manifest.json')) && existsSync(path.join(dir, 'manifest.json.sha256'))) {
        found.push(dir)
      }
      let entries: Array<{ name: string; isDirectory(): boolean }>
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) if (e.isDirectory()) next.push(path.join(dir, e.name))
    }
    queue = next
  }
  if (found.length === 1) return { root: found[0], located: true }
  if (found.length > 1) {
    throw new Error(
      `restore produced ${found.length} manifest-bearing directories — ambiguous snapshot content, refusing to verify`,
    )
  }
  return { root: targetDir, located: false }
}

async function corruptOnePackFile(repoDir: string): Promise<string> {
  const dataDir = path.join(repoDir, 'data')
  const hexDirs = (await readdir(dataDir)).sort()
  const { chmod } = await import('node:fs/promises')
  for (const hex of hexDirs) {
    const packDir = path.join(dataDir, hex)
    const packs = (await readdir(packDir)).filter((f) => !f.endsWith('.tmp') && !f.endsWith('.crt'))
    if (packs.length > 0) {
      const target = path.join(packDir, packs[0])
      // Restic marks pack files read-only on disk; the corruption injector must
      // explicitly make the file writable before damaging it.
      await chmod(target, 0o600).catch(() => undefined)
      await flipOneByte(target)
      return path.join('data', hex, packs[0])
    }
  }
  throw new Error('no pack files found to corrupt (unexpected repository layout)')
}

export async function runRestoreDrill(input: RestoreDrillInput, adapter: ResticAdapter): Promise<RestoreDrillResult> {
  const steps: RestoreDrillStep[] = []
  const dirs = await prepareDrillDirs(input, adapter)
  const keep = input.keep === true
  const dirsToKeep = keep ? [dirs.workRoot] : []

  const fail = (failedStep: string, detail: string, cleanup: boolean): RestoreDrillResult => {
    steps.push({ step: failedStep, ok: false, detail })
    if (cleanup && !keep) {
      void rm(dirs.workRoot, { recursive: true, force: true }).catch(() => undefined)
    }
    return { ok: false, steps, failedStep }
  }

  try {
    // ── 0: repository (explicit initialization — never silent) ──
    if (await adapter.repoInitialized()) {
      steps.push({
        step: 'repo-init',
        ok: true,
        detail: input.repository
          ? 'using the existing initialized repository'
          : 'repository reports initialized (throwaway repo from a previous drill run)',
      })
    } else if (input.repository) {
      return fail('repo-init', 'given repository is not initialized — run ops:backup:init-repo first', true)
    } else {
      // Throwaway drill repository: initialization here is the explicit,
      // logged repository-initialization operation for THIS drill only.
      await adapter.initRepository()
      steps.push({ step: 'repo-init', ok: true, detail: 'throwaway local restic repository initialized (temp password, temp location, AES256-encrypted)' })
    }

    // ── 1: fixture (extraDocument: the path-portability fixture — two owners,
    // two absolute storedPaths — drives the canonical/remap proofs below) ──
    const fixture = await buildBackupFixture(dirs.fixtureRoot, input.projectRoot, { extraDocument: true })
    steps.push({
      step: 'fixture',
      ok: true,
      detail:
        `real migration chain applied; ${fixture.uploads.length} upload(s) + ${fixture.evidence.length} ACTIVE evidence ` +
        `(orphan upload and PURGED row included); known hashes recorded`,
    })

    // ── 2: interrupted-staging fault snapshots a manifest-less stage ──
    if (input.fault === 'incomplete-manifest') {
      const stageDir = path.join(dirs.stageParent, 'incomplete-stage')
      await mkdir(stageDir, { recursive: true })
      const staged = await createBackupStage({
        paths: { dbPath: fixture.dbPath, uploadsDir: fixture.uploadsDir, evidenceDir: fixture.evidenceDir },
        stageDir,
        resticVersion: adapter.version,
        createdAt: input.now,
      })
      // Simulate an interrupted backup: the snapshot is taken from a stage whose
      // manifest was never written (the coherence audit ran, but the run died
      // before the manifest landed). Restic happily snapshots the partial tree.
      await rm(path.join(stageDir, 'manifest.json'), { force: true })
      await rm(path.join(stageDir, 'manifest.json.sha256'), { force: true })
      const { snapshotId } = await adapter.backupDirectory(stageDir, [BACKUP_TAG_ROOT, 'bean-drill-fault:incomplete-manifest'])
      steps.push({ step: 'fault-injection', ok: true, detail: `snapshot ${snapshotId} taken from a stage WITHOUT its manifest (interrupted-staging shape)` })
      await removeStageDir(stageDir)

      const targetCheck = assertSafeRestoreTarget(dirs.targetDir, [fixture.uploadsDir, fixture.evidenceDir, path.dirname(fixture.dbPath)])
      if (!targetCheck.ok) return fail('target-safety', targetCheck.error, true)
      try {
        await adapter.restoreSnapshot(snapshotId, dirs.targetDir)
      } catch (err) {
        return fail('restore', `snapshot restore failed: ${err instanceof Error ? err.message : String(err)}`, true)
      }
      const located = await locateRestoredRoot(dirs.targetDir)
      const report = await verifyRestoredBackup(located.root, { projectRoot: input.projectRoot, runPrismaMigrateStatus: false })
      const detected = !report.ok
      steps.push({
        step: 'fault-detection',
        ok: detected,
        detail: detected
          ? `incomplete snapshot correctly REJECTED by: ${report.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')} — an interrupted backup is never reported as success`
          : 'DANGEROUS: verification PASSED without a manifest — interrupted backups must never verify as success',
      })
      if (!detected) return fail('fault-detection', 'incomplete backup was NOT detected', true)
      if (!keep) await rm(dirs.workRoot, { recursive: true, force: true }).catch(() => undefined)
      else steps.push({ step: 'cleanup', ok: true, detail: `artifacts kept for inspection: ${dirs.workRoot}` })
      return { ok: true, steps, snapshotId }
    }

    // ── 3: standard backup flow (fixture has no writers; drill owns the boundary) ──
    const backup = await runBackupFlow(
      {
        projectRoot: input.projectRoot,
        databaseUrl: `file:${fixture.dbPath}`,
        uploadsDir: fixture.uploadsDir,
        evidenceDir: fixture.evidenceDir,
        repository: input.repository ?? dirs.repoDir,
        confirmOffline: true,
        verifyData: false, // full-data check runs explicitly as drill step 4
        keepStage: false,
        allowInTree: true, // fixture/repo live in private temp dirs, not the project tree
        stageParent: dirs.stageParent,
        now: input.now,
      },
      adapter,
    )
    if (!backup.ok) {
      return fail(backup.failedStage, backup.log.map((l) => `${l.stage}: ${l.detail}`).join(' | '), true)
    }
    for (const l of backup.log) steps.push({ step: `backup:${l.stage}`, ok: true, detail: l.detail })
    const snapshotId = backup.snapshotId
    steps.push({ step: 'backup:snapshot', ok: true, detail: `snapshot ${snapshotId}` })

    // ── 4: repository corruption fault (detection must come from restic check) ──
    if (input.fault === 'repo-corruption') {
      const repoForFault = adapter.repositoryDir ?? dirs.repoDir
      const rel = await corruptOnePackFile(repoForFault)
      steps.push({ step: 'fault-injection', ok: true, detail: `corrupted pack file ${rel} — restic check must fail` })
      let detected = false
      let detail = ''
      try {
        await adapter.check(true)
        detail = 'restic check PASSED despite corruption'
      } catch (err) {
        detected = true
        detail = `restic check FAILED after repository corruption (${(err instanceof Error ? err.message : String(err)).slice(0, 160)}) — the integrity gate detects damaged repositories`
      }
      steps.push({ step: 'fault-detection', ok: detected, detail })
      if (!detected) return fail('fault-detection', detail, true)
      if (!keep) await rm(dirs.workRoot, { recursive: true, force: true }).catch(() => undefined)
      else steps.push({ step: 'cleanup', ok: true, detail: `artifacts kept for inspection: ${dirs.workRoot}` })
      return { ok: true, steps, snapshotId }
    }

    // ── 5: repository integrity (structure + full data read) ──
    await adapter.check(false)
    await adapter.check(true)
    steps.push({ step: 'repo-check', ok: true, detail: 'restic check + check --read-data passed (every byte of the repository verified)' })

    // ── 6: mutate the ORIGINAL fixture after the backup ──
    let mutation: FixtureMutation
    try {
      mutation = await mutateFixtureAfterBackup(fixture)
    } catch (err) {
      return fail('post-backup-mutation', err instanceof Error ? err.message : String(err), true)
    }
    steps.push({
      step: 'post-backup-mutation',
      ok: true,
      detail:
        `mutated original fixture after backup: appended ${mutation.appendedBytes} bytes to ${mutation.appendedTo}, ` +
        `created new document ${mutation.newDocumentId} + upload ${mutation.newUploadName} — the restored snapshot must NOT reflect these`,
    })

    // ── 7: restore into a NEW, empty, isolated directory ──
    const targetCheck = assertSafeRestoreTarget(dirs.targetDir, [fixture.uploadsDir, fixture.evidenceDir, path.dirname(fixture.dbPath)])
    if (!targetCheck.ok) return fail('target-safety', targetCheck.error, true)
    try {
      await adapter.restoreSnapshot(snapshotId, dirs.targetDir)
    } catch (err) {
      return fail('restore', `snapshot restore failed or was interrupted: ${err instanceof Error ? err.message : String(err)} — never reported as success`, true)
    }
    steps.push({ step: 'restore', ok: true, detail: `snapshot ${snapshotId} restored into an isolated directory` })

    // Restic nests the original absolute source path under the target — locate
    // the actual staging-tree root (or fall back to the target so a missing
    // manifest is reported honestly).
    const located = await locateRestoredRoot(dirs.targetDir)
    steps.push({
      step: 'restore-root',
      ok: true,
      detail: located.located
        ? `restored staging tree located at ${located.root}`
        : 'restored staging tree could NOT be located (no manifest pair) — verification will report the truth',
    })

    // Faults that mutate the RESTORED copy (before verification).
    if (input.fault === 'corrupt-file') {
      const p = path.join(located.root, 'data', 'files', 'uploads', fixture.uploads[0].name)
      await flipOneByte(p)
      steps.push({ step: 'fault-injection', ok: true, detail: `flipped a byte inside restored ${fixture.uploads[0].name} — hash verification must flag corruption` })
    } else if (input.fault === 'corrupt-manifest') {
      await writeFile(path.join(located.root, 'manifest.json'), '{"schema":"bean-backup-manifest/1","trunc', { encoding: 'utf8' })
      steps.push({ step: 'fault-injection', ok: true, detail: 'truncated restored manifest.json — manifest check must fail closed' })
    } else if (input.fault === 'missing-file') {
      const p = path.join(located.root, 'data', 'files', 'evidence', fixture.evidence[0].name)
      await rm(p, { force: true })
      steps.push({ step: 'fault-injection', ok: true, detail: `removed restored ${fixture.evidence[0].name} — presence verification must flag the missing file` })
    }

    // ── 8: verification battery ──
    const report = await verifyRestoredBackup(located.root, {
      projectRoot: input.projectRoot,
      runPrismaMigrateStatus: input.runMigrateStatus !== false,
    })
    for (const c of report.checks) {
      steps.push({ step: `verify:${c.id}`, ok: c.ok, detail: `${c.label} — ${c.detail}` })
    }
    if (!report.ok) {
      const failed = report.checks.filter((c) => !c.ok).map((c) => c.id).join(', ')
      const expected = input.fault !== undefined
      steps.push({
        step: 'fault-detection',
        ok: expected,
        detail: expected
          ? `injected fault correctly DETECTED — verification failed on: ${failed} (a corrupted/incomplete backup is never reported as success)`
          : `restored backup failed verification: ${failed}`,
      })
      if (!expected) return fail('verification', `restored backup failed verification: ${failed}`, true)
      if (!keep) await rm(dirs.workRoot, { recursive: true, force: true }).catch(() => undefined)
      else steps.push({ step: 'cleanup', ok: true, detail: `artifacts kept for inspection: ${dirs.workRoot}` })
      return { ok: true, steps, snapshotId }
    }

    // ── 9: post-mutation isolation assertion ──
    const manifest = loadVerifiedManifest(located.root)
    if (!manifest.ok) return fail('post-mutation-isolation', manifest.error, true)
    const uploadNames = manifest.manifest.uploads.entries.map((e) => e.name).sort()
    const isolationOk = !uploadNames.includes(mutation.newUploadName) && uploadNames.includes(mutation.appendedTo)
    steps.push({
      step: 'post-mutation-isolation',
      ok: isolationOk,
      detail: isolationOk
        ? `restored snapshot contains exactly the backup-time upload set (${uploadNames.length} entries) — neither the appended bytes nor the post-backup document ${mutation.newDocumentId} leaked in`
        : 'restored snapshot unexpectedly reflects post-backup mutations',
    })
    if (!isolationOk) return fail('post-mutation-isolation', 'restored data does not match the backup-time state', true)

    // ── 9b: PATH PORTABILITY proofs — the restored data set must be openable
    // through the application's REAL file-reading logic, not just hash-verified
    // in place. `StudyDocument.storedPath` is an absolute path baked in at
    // upload time; `ExpertCredentialEvidence.storagePath` is relative and is
    // resolved at runtime by the app's own evidenceFilePath() guard. Both modes
    // below operate ONLY on isolated copies / drill-owned temp roots — never on
    // the original backup snapshot, the original fixture data, or a live DB.

    const restoredDbCopy = path.join(located.root, manifest.manifest.database.file)
    const restoredUploadsDir = path.join(located.root, 'data', 'files', 'uploads')
    const restoredEvidenceDir = path.join(located.root, 'data', 'files', 'evidence')
    const manifestUploadNames = manifest.manifest.uploads.entries.map((e) => e.name)

    // ---- MODE canonical: materialise bytes at the exact recorded absolute ----
    // paths (the drill simulates a same-layout recovery host: the fixture's
    // live uploads dir is preserved aside byte-for-byte, the recorded root is
    // materialised from the restored snapshot, probed through the real route
    // handler, then the live bytes are restored and proven untouched).
    const preState = await snapshotUploadsDir(fixture.uploadsDir)
    const preserveDir = `${fixture.uploadsDir}.canonical-preserve`
    let canonicalDetail = ''
    let canonicalProof: PathPortabilityProof['canonical'] | null = null
    try {
      if (existsSync(preserveDir)) throw new Error(`preserve path already exists: ${preserveDir} — refusing to run the canonical proof`)
      await rename(fixture.uploadsDir, preserveDir)
      try {
        const plan = planCanonicalMaterialization({
          dbPath: restoredDbCopy,
          manifestUploadNames,
          forbiddenRoots: [located.root, dirs.repoDir, dirs.targetDir, dirs.stageParent, preserveDir, fixture.evidenceDir, fixture.dbPath],
        })
        if (!plan.ok) throw new Error(plan.error)
        const mat = await materializeCanonicalFiles(plan.plan, restoredUploadsDir)
        if (!mat.ok) throw new Error(mat.error)
        const probe = await runPortabilityProbe({
          projectRoot: input.projectRoot,
          appRoot: fixture.root,
          dbPath: restoredDbCopy,
          mode: 'canonical',
        })
        if (!probe.ok) throw new Error(probe.error)
        canonicalProof = {
          documentsChecked: probe.outcome.result.documentsChecked,
          evidenceChecked: probe.outcome.result.evidenceChecked,
          rangeChecks: probe.outcome.result.rangeChecks,
          canonicalRoot: plan.plan.root,
        }
        canonicalDetail =
          `recorded root ${plan.plan.root} materialised from the restored snapshot (${mat.written} file(s)); ` +
          `child probe opened ${probe.outcome.result.documentsChecked} document(s) through the REAL ` +
          `/api/materials/[id]/file route (200 + sha256=contentHash + Range 206) and ${probe.outcome.result.evidenceChecked} ` +
          `ACTIVE evidence file(s) through the app's evidenceFilePath() resolution`
      } finally {
        // Restore the live fixture uploads dir EXACTLY as it was — byte-for-byte.
        await rm(fixture.uploadsDir, { recursive: true, force: true }).catch(() => undefined)
        await rename(preserveDir, fixture.uploadsDir)
        const postState = await snapshotUploadsDir(fixture.uploadsDir)
        if (JSON.stringify(postState) !== JSON.stringify(preState)) {
          throw new Error('fixture uploads directory did not restore byte-identically after the canonical proof — failing the drill closed')
        }
      }
    } catch (err) {
      return fail('path-portability:canonical', err instanceof Error ? err.message : String(err), true)
    }
    steps.push({ step: 'path-portability:canonical', ok: true, detail: canonicalDetail })

    // ---- MODE remap: validated storedPath remapping on the isolated DB ----
    const recoveryAppRoot = path.join(dirs.workRoot, 'recovery-app')
    const remapForbidden = [
      fixture.root,
      fixture.dbPath,
      fixture.uploadsDir,
      fixture.evidenceDir,
      located.root,
      dirs.repoDir,
      dirs.targetDir,
      dirs.stageParent,
    ]
    const populated = await populateRecoveryLayout({
      recoveryAppRoot,
      dbBasename: manifest.manifest.database.sourceBasename,
      dbSourcePath: restoredDbCopy,
      restoredUploadsDir,
      restoredEvidenceDir,
      forbiddenRoots: remapForbidden, // OPS-2.1: real-filesystem disjointness for the recovery layout
    })
    if (!populated.ok) return fail('path-portability:remap', populated.error, true)
    const remapPlan = planUploadsRemap({
      dbPath: populated.dbPath,
      manifestUploadNames,
      newRoot: populated.uploadsDir,
      forbiddenRoots: remapForbidden,
    })
    if (!remapPlan.ok) return fail('path-portability:remap', remapPlan.error, true)
    const applied = applyUploadsRemap(populated.dbPath, remapPlan.plan)
    if (!applied.ok) return fail('path-portability:remap', applied.error, true)
    // The remapped copy must still be a healthy, fully-referenced database.
    const remapIntegrity = verifyRestoredDatabase(populated.dbPath)
    const remapMigrations = verifyMigrationHistory(populated.dbPath, input.projectRoot)
    const remapRefs = verifyDatabaseReferences(populated.dbPath, manifest.manifest)
    const remapHealthy =
      remapIntegrity.integrity === 'ok' &&
      remapIntegrity.fkViolations === 0 &&
      remapMigrations.ok &&
      remapRefs.ok
    if (!remapHealthy) {
      return fail(
        'path-portability:remap',
        `remapped copy failed re-verification (integrity=${remapIntegrity.integrity}, fk=${remapIntegrity.fkViolations}, migrations ok=${remapMigrations.ok}, references ok=${remapRefs.ok})`,
        true,
      )
    }
    const remapProbe = await runPortabilityProbe({
      projectRoot: input.projectRoot,
      appRoot: recoveryAppRoot,
      dbPath: populated.dbPath,
      mode: 'remap',
    })
    if (!remapProbe.ok) return fail('path-portability:remap', remapProbe.error, true)
    const remapProof: PathPortabilityProof['remap'] = {
      rowsRemapped: applied.applied,
      originalRoot: remapPlan.plan.originalRoot,
      newRoot: remapPlan.plan.newRoot,
      documentsChecked: remapProbe.outcome.result.documentsChecked,
      evidenceChecked: remapProbe.outcome.result.evidenceChecked,
    }
    steps.push({
      step: 'path-portability:remap',
      ok: true,
      detail:
        `remapped ${applied.applied} StudyDocument row(s) ${remapPlan.plan.originalRoot} → ${remapPlan.plan.newRoot} on the ISOLATED recovery copy ` +
        `(integrity ok, 0 FK violations, migration history unchanged, DB→file references still verified); ` +
        `child probe (cwd=recovery root) opened ${remapProbe.outcome.result.documentsChecked} document(s) through the REAL route ` +
        `and ${remapProbe.outcome.result.evidenceChecked} evidence file(s) through the app's own resolution logic`,
    })

    // ── 10: cleanup ──
    if (!keep) {
      await rm(dirs.targetDir, { recursive: true, force: true }).catch(() => undefined)
      await rm(dirs.workRoot, { recursive: true, force: true }).catch(() => undefined)
      steps.push({ step: 'cleanup', ok: true, detail: 'restore target, fixture, throwaway repository and staging removed (all temp data safely deleted)' })
    } else {
      steps.push({ step: 'cleanup', ok: true, detail: `artifacts kept for inspection: ${dirsToKeep.join(', ')}` })
    }

    return {
      ok: true,
      steps,
      snapshotId,
      fixture,
      mutation,
      report: { ok: report.ok, checks: report.checks },
      portability: { canonical: canonicalProof as PathPortabilityProof['canonical'], remap: remapProof },
      targetDir: dirs.targetDir,
      dirsToKeep: keep ? dirsToKeep : undefined,
    }
  } catch (err) {
    const detail = err instanceof Error ? `${err.message}${err.stack ? ` :: ${err.stack.split('\n').slice(1, 4).join(' | ')}` : ''}` : String(err)
    return fail('unexpected', detail, true)
  }
}

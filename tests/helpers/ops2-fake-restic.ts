// ─── OPS-2 test helper: deterministic fake Restic adapter ─────────────────────
//
// Implements the ResticAdapter seam with plain directory semantics:
//   • backupDirectory  → copies the staging tree into <repo>/snapshots/<id>
//   • restoreSnapshot  → copies the stored snapshot back into the target
//   • check            → verifies every stored snapshot still contains its
//                        manifest sidecar structure (so pack-corruption fakes
//                        can fail it)
//   • listSnapshots    → metadata recorded at backup time
//
// This keeps unit tests hermetic (CI has no restic) while the REAL restic
// behaviour is proven by scripts/ops/restore-drill.ts runs documented in
// docs/OPS-2-BACKUP-RESTORE.md. The adapter is deliberately honest about what
// it fakes: encryption (restic's AES256 repo encryption) is NOT simulated —
// real-encryption evidence comes from the drill runs.

import { cp, rm, mkdir, readdir, stat, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ResticAdapter, ResticSnapshotInfo } from '../../scripts/ops/lib/restic'

export class FakeResticAdapter implements ResticAdapter {
  readonly version: string
  readonly repositoryDir: string
  private readonly repoDir: string
  private readonly snapshots: Array<ResticSnapshotInfo & { id: string }> = []
  private nextId = 1
  /** Restic semantics: a repo is "initialized" once its config exists (init ran). */
  private initialized = false
  /** sha256 of the fake pack file at init — check() re-verifies (repo-corruption fake). */
  private packSha256: string | null = null
  /** When true, check() fails (used to fake a corrupted repository). */
  public failCheck = false
  /** When set, restoreSnapshot() throws (used to fake an interrupted restore). */
  public restoreError: string | null = null
  /** When set, backupDirectory() throws (used to fake an interrupted backup). */
  public backupError: string | null = null

  constructor(repoDir: string, version = '0.18.0-fake') {
    this.repoDir = repoDir
    this.repositoryDir = repoDir
    this.version = version
  }

  async repoInitialized(): Promise<boolean> {
    return this.initialized
  }

  async initRepository(): Promise<void> {
    await mkdir(path.join(this.repoDir, 'snapshots'), { recursive: true })
    this.initialized = true
    // A restic-shaped data/0/ pack file so repository-corruption injection can
    // operate through the same filesystem layout the real drill uses.
    const packDir = path.join(this.repoDir, 'data', '0')
    await mkdir(packDir, { recursive: true })
    const packBytes = Buffer.from(`FAKE-PACK-${Date.now()}-${Math.random()}`)
    await writeFile(path.join(packDir, 'pack-fake0001'), packBytes, { mode: 0o600 })
    this.packSha256 = createHash('sha256').update(packBytes).digest('hex')
  }

  async backupDirectory(stageDir: string, tags: string[]): Promise<{ snapshotId: string }> {
    if (this.backupError) throw new Error(this.backupError)
    if (!existsSync(stageDir)) throw new Error(`fake: stage dir missing: ${stageDir}`)
    const id = `fake${String(this.nextId).padStart(8, '0')}`
    this.nextId += 1
    const target = path.join(this.repoDir, 'snapshots', id)
    await cp(stageDir, target, { recursive: true })
    this.snapshots.push({ id, time: new Date().toISOString(), tags: [...tags] })
    return { snapshotId: id }
  }

  async check(readData: boolean): Promise<void> {
    if (this.failCheck) throw new Error('fake: repository data corrupted (pack checksum mismatch)')
    // Pack integrity: re-hash the fake pack file — corruption is detected the
    // same way `restic check` detects it in the real engine.
    const packPath = path.join(this.repoDir, 'data', '0', 'pack-fake0001')
    if (this.packSha256 !== null) {
      if (!existsSync(packPath)) throw new Error('fake: repository pack file missing')
      const buf = await readFile(packPath)
      if (createHash('sha256').update(buf).digest('hex') !== this.packSha256) {
        throw new Error('fake: repository pack file corrupted — integrity check failed')
      }
    }
    for (const s of this.snapshots) {
      const dir = path.join(this.repoDir, 'snapshots', s.id)
      if (!existsSync(path.join(dir, 'manifest.json'))) {
        throw new Error(`fake: snapshot ${s.id} is missing its manifest`)
      }
      if (readData) {
        const dataDir = path.join(dir, 'data')
        if (!existsSync(dataDir)) throw new Error(`fake: snapshot ${s.id} lost its data tree`)
      }
    }
  }

  async restoreSnapshot(snapshotId: string, targetDir: string): Promise<void> {
    if (this.restoreError) throw new Error(this.restoreError)
    const dir = path.join(this.repoDir, 'snapshots', snapshotId)
    if (!existsSync(dir)) throw new Error(`fake: unknown snapshot ${snapshotId}`)
    await cp(dir, targetDir, { recursive: true })
  }

  async listSnapshots(): Promise<ResticSnapshotInfo[]> {
    return this.snapshots.map(({ id, time, tags }) => ({ id, time, tags }))
  }

  /** Test handle: simulate a corrupted repository artifact. */
  async corruptSnapshotData(snapshotId: string): Promise<void> {
    const dir = path.join(this.repoDir, 'snapshots', snapshotId, 'data', 'files', 'uploads')
    const files = await readdir(dir)
    const p = path.join(dir, files[0])
    const buf = await readFile(p)
    buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff
    await writeFile(p, buf)
  }

  /** Test handle: confirm a stored snapshot exists on disk. */
  async snapshotDir(snapshotId: string): Promise<string> {
    const dir = path.join(this.repoDir, 'snapshots', snapshotId)
    await stat(dir)
    return dir
  }

  /** Test handle: delete one file inside a stored snapshot (missing-file fake). */
  async removeSnapshotFile(snapshotId: string, relPath: string): Promise<void> {
    await rm(path.join(this.repoDir, 'snapshots', snapshotId, relPath), { force: true })
  }
}

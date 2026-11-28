// ─── OPS-2.1: restore-path SYMLINK / filesystem-boundary adversarial tests ─────
//
// The independent-review finding: the restore-boundary checks relied on lexical
// `path.resolve()` comparisons, which never consult the filesystem. When an
// existing path component is a SYMBOLIC LINK, the lexical "resolved" path is
// not the location the bytes would actually land in. This suite drives every
// documented adversarial shape against the hardened boundaries, on disposable
// temporary directories only (no live DB, no real user data, nothing outside
// the test's own temp roots is ever written):
//
//   S1  destination root symlink pointing INSIDE a protected root — refused
//   S2  destination root symlink pointing OUTSIDE the recovery root — refused
//       (the symlinked-destination policy is unconditional, not overlap-gated)
//   S3  symlinked ancestor directory — refused by every boundary that would
//       create or write beneath it
//   S4  symlinked restored database path — the writable remap refuses the
//       alias and the aliased target database stays byte-identical
//   S5  symlinked recovery target — refused before any layout is created
//   S6  symlinked upload file — backup staging, recovery-layout population and
//       restored-file verification all refuse; never silently followed
//   S7  symlinked evidence file — same refusal at every boundary
//   S8  path traversal combined with symlink components — the lexical resolve
//       erases `sym/..`, the filesystem-real root guard still refuses the
//       direct-through-symlink shape and no bytes reach the link target
//   S9  symlink target swapped between planning and materialization — the
//       write-time re-scan refuses (root swap + intermediate-dir swap)
//   S10 normal canonical recovery remains successful (real files at the exact
//       recorded paths, hash-identical)
//   S11 normal remapped recovery remains successful (fresh real layout, rows
//       remapped, original database byte-identical, integrity ok)
//   S12 existing files are never overwritten — regular file, dangling symlink
//       at plan time, and a file appearing between plan and write
//   S13 failure cleanup never deletes pre-existing data — only files the
//       failed call wrote are removed; protected directories and their
//       contents survive; a written leaf that became a symlink is left alone
//
// Race-condition honesty: POSIX cannot atomically validate every ancestor AND
// perform the subsequent write. The hardened code re-validates at the point of
// write, creates leaves with O_CREAT|O_EXCL (race-free: never overwrites,
// never follows a leaf symlink) and re-verifies after each write. The tests
// exercise the deterministic parts of that discipline (swap BEFORE the write
// attempt); complete TOCTOU elimination is not claimed anywhere.

import { describe, it, expect, afterAll } from 'bun:test'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  readFileSync,
  lstatSync,
  existsSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import {
  planUploadsRemap,
  applyUploadsRemap,
  planCanonicalMaterialization,
  materializeCanonicalFiles,
  populateRecoveryLayout,
  type CanonicalMaterializationPlan,
  type UploadsRemapPlan,
} from '../../scripts/ops/lib/restore-path-mapping'
import { assertSafeRestoreTarget, verifyRestoredFiles, verifyRestoredBackup, loadVerifiedManifest } from '../../scripts/ops/lib/restore-verify'
import { createBackupStage, assertSafeBackupPlacement, type BackupManifest } from '../../scripts/ops/lib/backup-core'

const root = mkdtempSync(join(tmpdir(), 'bean-ops2-symlink-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// ─── Shared synthetic infrastructure ───────────────────────────────────────────

function sha(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

const DOC1 = Buffer.from('SYMLINK-SAFETY-FIXTURE-DOC-ONE\n')
const DOC2 = Buffer.from('SYMLINK-SAFETY-FIXTURE-DOC-TWO\n')
const UPLOAD_NAMES = ['doc1.pdf', 'doc2.pdf']

/**
 * A minimal StudyDocument-only SQLite database — enough for the storedPath
 * analysis / remap / canonical planners (which read exactly those columns).
 * No migration chain is needed for the boundary tests; the real-chain
 * behaviour is covered by the ops2-restore and ops2-path-portability suites.
 */
function makeDbWithRows(dbPath: string, rows: Array<{ id: string; storedPath: string }>): void {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  try {
    db.exec('CREATE TABLE StudyDocument (id TEXT PRIMARY KEY, storedPath TEXT NOT NULL, fileSize INTEGER NOT NULL, contentHash TEXT NOT NULL)')
    for (const r of rows) {
      const bytes = r.storedPath.endsWith('doc1.pdf') ? DOC1 : DOC2
      db.query('INSERT INTO StudyDocument (id, storedPath, fileSize, contentHash) VALUES (?, ?, ?, ?)').run(r.id, r.storedPath, bytes.length, sha(bytes))
    }
  } finally {
    db.close()
  }
}

/**
 * Writable ISOLATED copy of the live database in its own directory — the shape
 * the real drill uses (an isolated restored copy whose location is disjoint
 * from every protected root).
 */
function isolatedDbCopy(label: string): string {
  const dir = join(root, uniq(label))
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'custom.db')
  writeFileSync(p, readFileSync(liveDbPath), { mode: 0o600 })
  return p
}

let minimalDbCounter = 0
/** A fresh empty standalone SQLite file per call (staging tests must not share). */
function makeMinimalDbCopy(): string {
  minimalDbCounter += 1
  const p = join(root, `minimal-${minimalDbCounter}-${Math.random().toString(36).slice(2, 8)}`, 'custom.db')
  makeMinimalDb(p)
  return p
}

/** A standalone SQLite file usable as createBackupStage's VACUUM INTO source. */
function makeMinimalDb(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  try {
    db.exec('CREATE TABLE StudyDocument (id TEXT PRIMARY KEY, storedPath TEXT NOT NULL, fileSize INTEGER NOT NULL, contentHash TEXT NOT NULL)')
    db.exec('CREATE TABLE ExpertCredentialEvidence (id TEXT PRIMARY KEY, storagePath TEXT NOT NULL, byteSize INTEGER NOT NULL, sha256 TEXT NOT NULL, retentionState TEXT NOT NULL)')
  } finally {
    db.close()
  }
}

// The "live" application layout the protected roots guard (never written to by
// any test below — its byte-identity is asserted after refusals).
const liveRoot = join(root, 'live-app')
const liveDbPath = join(liveRoot, 'db', 'custom.db')
const liveUploadsDir = join(liveRoot, 'db', 'uploads')
const liveEvidenceDir = join(liveRoot, 'db', 'evidence')

let liveDbSha = ''
let seq = 0
function uniq(label: string): string {
  seq += 1
  return `${label}-${seq}-${Math.random().toString(36).slice(2, 8)}`
}

// Build once: the live app root with two upload files, one evidence file and
// the StudyDocument rows pointing at the live uploads root.
makeDbWithRows(liveDbPath, [
  { id: 'doc-row-1', storedPath: join(liveUploadsDir, 'doc1.pdf') },
  { id: 'doc-row-2', storedPath: join(liveUploadsDir, 'doc2.pdf') },
])
mkdirSync(liveUploadsDir, { recursive: true })
mkdirSync(liveEvidenceDir, { recursive: true })
writeFileSync(join(liveUploadsDir, 'doc1.pdf'), DOC1, { mode: 0o600 })
writeFileSync(join(liveUploadsDir, 'doc2.pdf'), DOC2, { mode: 0o600 })
writeFileSync(join(liveEvidenceDir, 'ev1.pdf'), Buffer.from('EVIDENCE-BYTES\n'), { mode: 0o600 })
writeFileSync(join(liveRoot, 'precious.txt'), 'PRE-EXISTING USER DATA\n', { mode: 0o600 })
liveDbSha = sha(readFileSync(liveDbPath))

function expectLiveUntouched(): void {
  expect(sha(readFileSync(liveDbPath))).toBe(liveDbSha)
  expect(readFileSync(join(liveUploadsDir, 'doc1.pdf')).equals(DOC1)).toBe(true)
  expect(readFileSync(join(liveUploadsDir, 'doc2.pdf')).equals(DOC2)).toBe(true)
}

// ─── S1: destination root symlink pointing inside a protected root ─────────────

describe('S1: destination root symlink pointing inside a protected root', () => {
  it('refuses the restore target, the remap root, the canonical root and the recovery layout — no bytes move', async () => {
    const link = join(root, uniq('link-inside'))
    symlinkSync(liveRoot, link) // → the protected "live" app root

    // restore target
    const t = assertSafeRestoreTarget(link, [liveUploadsDir, liveEvidenceDir, liveDbPath])
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.error).toContain('symbolic link')

    // remap recovery uploads root beneath the link (isolated DB copy — the
    // drill's real shape; the live db's own dirname contains the live uploads
    // root and would trip the contain-guard for an unrelated reason)
    const r = planUploadsRemap({
      dbPath: isolatedDbCopy('s1-remap-copy'),
      manifestUploadNames: UPLOAD_NAMES,
      newRoot: join(link, 'recovery', 'uploads'),
      forbiddenRoots: [liveUploadsDir, liveEvidenceDir],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('symbolic link')

    // canonical root recorded THROUGH the link
    const canonDb = join(root, uniq('s1-db'), 'custom.db')
    makeDbWithRows(canonDb, [{ id: 'c1', storedPath: join(link, 'db', 'uploads', 'doc1.pdf') }])
    const c = planCanonicalMaterialization({ dbPath: canonDb, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [] })
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.error).toContain('symbolic link')

    // recovery app root beneath the link
    const p = await populateRecoveryLayout({
      recoveryAppRoot: join(link, 'recovery-app'),
      dbBasename: 'custom.db',
      dbSourcePath: liveDbPath,
      restoredUploadsDir: liveUploadsDir,
      restoredEvidenceDir: liveEvidenceDir,
    })
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error).toContain('symbolic link')

    // the protected root is untouched: no recovery dirs appeared inside it
    expect(existsSync(join(liveRoot, 'recovery'))).toBe(false)
    expect(existsSync(join(liveRoot, 'recovery-app'))).toBe(false)
    expectLiveUntouched()
  })
})

// ─── S2: destination root symlink pointing outside the recovery root ───────────

describe('S2: destination root symlink pointing outside the intended recovery root', () => {
  it('refuses even when the link target is fully disjoint — the policy is unconditional', () => {
    const outside = mkdtempSync(join(tmpdir(), 'bean-ops2-symlink-outside-'))
    try {
      const link = join(root, uniq('link-outside'))
      symlinkSync(outside, link) // disjoint from every protected root — still refused

      const t = assertSafeRestoreTarget(link, [liveUploadsDir])
      expect(t.ok).toBe(false)
      if (!t.ok) expect(t.error).toContain('symbolic link')

      const r = planUploadsRemap({
        dbPath: isolatedDbCopy('s2-remap-copy'),
        manifestUploadNames: UPLOAD_NAMES,
        newRoot: join(link, 'up'),
        forbiddenRoots: [liveUploadsDir],
      })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('symbolic link')

      const b = assertSafeBackupPlacement(join(link, 'repo'), [], root, { what: 'backup repository' })
      expect(b.ok).toBe(false)
      if (!b.ok) expect(b.error).toContain('symbolic link')

      expect(readdirSync(outside).length).toBe(0) // nothing was written through the link
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

// ─── S3: symlinked ancestor directory ──────────────────────────────────────────

describe('S3: symlinked ancestor directory', () => {
  it('refuses destinations beneath a symlinked ancestor at target/layout/materialization boundaries', async () => {
    const base = join(root, uniq('s3-base'))
    mkdirSync(base, { recursive: true })
    const escape = join(root, uniq('s3-escape'))
    mkdirSync(escape, { recursive: true })
    symlinkSync(escape, join(base, 'linked'))

    // restore target beneath the ancestor link
    const t = assertSafeRestoreTarget(join(base, 'linked', 'target'), [liveUploadsDir])
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.error).toContain('symbolic link')

    // recovery layout beneath the ancestor link
    const p = await populateRecoveryLayout({
      recoveryAppRoot: join(base, 'linked', 'recovery-app'),
      dbBasename: 'custom.db',
      dbSourcePath: liveDbPath,
      restoredUploadsDir: liveUploadsDir,
      restoredEvidenceDir: liveEvidenceDir,
    })
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error).toContain('symbolic link')

    // canonical materialization beneath the ancestor link (write-time re-scan)
    const plan: CanonicalMaterializationPlan = {
      root: join(base, 'linked'),
      destinations: [{ absolutePath: join(base, 'linked', 'doc1.pdf'), basename: 'doc1.pdf' }],
    }
    const m = await materializeCanonicalFiles(plan, liveUploadsDir)
    expect(m.ok).toBe(false)
    if (!m.ok) expect(m.error).toContain('symbolic link')

    expect(existsSync(join(escape, 'target'))).toBe(false)
    expect(existsSync(join(escape, 'recovery-app'))).toBe(false)
    expect(existsSync(join(escape, 'doc1.pdf'))).toBe(false)
    expectLiveUntouched()
  })
})

// ─── S4: symlinked restored database path ──────────────────────────────────────

describe('S4: symlinked restored database path', () => {
  it('the writable remap refuses a symlink alias; the aliased database stays byte-identical', () => {
    // A neutral isolated copy + a valid plan, then an ALIAS placed elsewhere
    // pointing back at the isolated copy — standing in for an alias to a live DB.
    const copyDir = join(root, uniq('s4-copy'))
    mkdirSync(copyDir, { recursive: true })
    const copyPath = join(copyDir, 'custom.db')
    const copyShaBefore = sha(readFileSync(liveDbPath))
    writeFileSync(copyPath, readFileSync(liveDbPath), { mode: 0o600 })

    const plan = planUploadsRemap({
      dbPath: copyPath,
      manifestUploadNames: UPLOAD_NAMES,
      newRoot: join(root, uniq('s4-uploads')),
      forbiddenRoots: [liveRoot],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)

    const aliasDir = join(root, uniq('s4-alias'))
    mkdirSync(aliasDir, { recursive: true })
    const aliasPath = join(aliasDir, 'aliased.db')
    symlinkSync(copyPath, aliasPath)

    // planning refuses the alias outright
    const planned = planUploadsRemap({
      dbPath: aliasPath,
      manifestUploadNames: UPLOAD_NAMES,
      newRoot: join(root, uniq('s4-uploads-2')),
      forbiddenRoots: [liveRoot],
    })
    expect(planned.ok).toBe(false)
    if (!planned.ok) expect(planned.error).toContain('symbolic link')

    // and the writable application refuses it too
    const applied = applyUploadsRemap(aliasPath, plan.plan)
    expect(applied.ok).toBe(false)
    if (!applied.ok) expect(applied.error).toContain('symbolic link')

    // the aliased target was never written
    expect(sha(readFileSync(copyPath))).toBe(copyShaBefore)
    expectLiveUntouched()
  })
})

// ─── S5: symlinked recovery target ─────────────────────────────────────────────

describe('S5: symlinked recovery target', () => {
  it('a recovery layout is never populated through a symlinked root', async () => {
    const empty = join(root, uniq('s5-empty'))
    mkdirSync(empty, { recursive: true })
    const link = join(root, uniq('s5-link'))
    symlinkSync(empty, link)

    const p = await populateRecoveryLayout({
      recoveryAppRoot: link, // the recovery root ITSELF is a symlink
      dbBasename: 'custom.db',
      dbSourcePath: liveDbPath,
      restoredUploadsDir: liveUploadsDir,
      restoredEvidenceDir: liveEvidenceDir,
      forbiddenRoots: [liveRoot],
    })
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error).toContain('symbolic link')

    expect(existsSync(join(empty, 'db'))).toBe(false) // nothing landed at the link target
    expectLiveUntouched()
  })
})

// ─── S6/S7: symlinked upload / evidence files ──────────────────────────────────

function makeStoragewithSymlink(label: string, which: 'uploads' | 'evidence'): { uploadsDir: string; evidenceDir: string; escape: string } {
  const escape = join(root, uniq(`${label}-escape`))
  mkdirSync(escape, { recursive: true })
  const uploadsDir = join(root, `${label}-uploads`)
  const evidenceDir = join(root, `${label}-evidence`)
  mkdirSync(uploadsDir, { recursive: true })
  mkdirSync(evidenceDir, { recursive: true })
  if (which === 'uploads') {
    writeFileSync(join(uploadsDir, 'doc1.pdf'), DOC1, { mode: 0o600 })
    symlinkSync(join(escape, 'secret-target.bin'), join(uploadsDir, 'doc2.pdf')) // dangling or not: refused
  } else {
    writeFileSync(join(uploadsDir, 'doc1.pdf'), DOC1, { mode: 0o600 })
    symlinkSync(join(escape, 'secret-target.bin'), join(evidenceDir, 'ev1.pdf'))
  }
  return { uploadsDir, evidenceDir, escape }
}

describe('S6/S7: symlinked upload and evidence files are an explicit failure', () => {
  it('backup staging refuses to enumerate through symlinks', async () => {
    for (const which of ['uploads', 'evidence'] as const) {
      const storage = makeStoragewithSymlink(uniq('s67'), which)
      const stageDir = join(root, uniq('s67-stage'))
      mkdirSync(stageDir, { recursive: true })
      let thrown: unknown = null
      try {
        await createBackupStage({
          paths: { dbPath: makeMinimalDbCopy(), uploadsDir: storage.uploadsDir, evidenceDir: storage.evidenceDir },
          stageDir,
          resticVersion: '0.18.0-fake',
        })
      } catch (err) {
        thrown = err
      }
      expect(thrown).not.toBeNull()
      expect((thrown as Error).message).toContain('symbolic link')
      expect(existsSync(join(storage.escape, 'secret-target.bin'))).toBe(false)
    }
  })

  it('recovery-layout population refuses symlink entries in restored storage', async () => {
    for (const which of ['uploads', 'evidence'] as const) {
      const storage = makeStoragewithSymlink(uniq('s67r'), which)
      const p = await populateRecoveryLayout({
        recoveryAppRoot: join(root, uniq('s67-rec')),
        dbBasename: 'custom.db',
        dbSourcePath: liveDbPath,
        restoredUploadsDir: storage.uploadsDir,
        restoredEvidenceDir: storage.evidenceDir,
        forbiddenRoots: [liveRoot],
      })
      expect(p.ok).toBe(false)
      if (!p.ok) expect(p.error).toContain('symbolic link')
      expect(existsSync(join(storage.escape, 'secret-target.bin'))).toBe(false)
    }
  })

  it('restored-file verification flags a manifest entry replaced by a symlink (never followed)', async () => {
    const stageDir = join(root, uniq('s6c-stage'))
    mkdirSync(stageDir, { recursive: true })
    // Clean, symlink-free storage roots so staging succeeds.
    const uploadsDir = join(root, uniq('s6c-uploads'))
    const evidenceDir = join(root, uniq('s6c-evidence'))
    mkdirSync(uploadsDir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(uploadsDir, 'doc1.pdf'), DOC1, { mode: 0o600 })
    const staged = await createBackupStage({
      paths: { dbPath: makeMinimalDbCopy(), uploadsDir, evidenceDir },
      stageDir,
      resticVersion: '0.18.0-fake',
    })

    // Clean state verifies.
    const clean = await verifyRestoredFiles(stageDir, staged.manifest)
    expect(clean.ok).toBe(true)

    // Replace the restored upload with a symlink to foreign bytes.
    const foreign = join(root, uniq('s6c-foreign'))
    writeFileSync(foreign, Buffer.from('FOREIGN-BYTES-NOT-IN-BACKUP\n'))
    const entryPath = join(stageDir, 'data', 'files', 'uploads', 'doc1.pdf')
    rmSync(entryPath, { force: true })
    symlinkSync(foreign, entryPath)

    const after = await verifyRestoredFiles(stageDir, staged.manifest)
    expect(after.ok).toBe(false)
    expect(after.corrupted.join(' ')).toContain('symbolic link')
  })
})

// ─── S8: path traversal combined with symlink components ───────────────────────

describe('S8: path traversal combined with symlink components', () => {
  it('a storedPath reaching THROUGH a symlinked subdirectory is refused; nothing reaches the link target', () => {
    const escape = join(root, uniq('s8-escape'))
    mkdirSync(escape, { recursive: true })
    // The live uploads dir stays intact; a symlinked subdirectory inside a
    // COPY of it is the hostile recorded root.
    const uploadsDir = join(root, uniq('s8-uploads'))
    mkdirSync(uploadsDir, { recursive: true })
    writeFileSync(join(uploadsDir, 'doc1.pdf'), DOC1, { mode: 0o600 })
    symlinkSync(escape, join(uploadsDir, 'sym'))

    const dbPath = join(root, uniq('s8-db'), 'custom.db')
    // Lexical resolve() keeps this INSIDE the uploads root — the old purely
    // lexical guard saw a benign destination; the real filesystem says /escape.
    makeDbWithRows(dbPath, [{ id: 't1', storedPath: join(uploadsDir, 'sym', 'doc1.pdf') }])

    // Canonical: the recorded root ITSELF is the symlinked directory — the
    // destination-root guard refuses it (the purely lexical check would have
    // seen a benign path inside the uploads root).
    const c = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [] })
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.error).toContain('symbolic link')

    // Remap: no bytes ever move THROUGH the original root — rows are rewritten
    // in the isolated DB copy only — so the remap plans onto the real recovery
    // root and the link target still receives nothing.
    const r = planUploadsRemap({
      dbPath,
      manifestUploadNames: UPLOAD_NAMES,
      newRoot: join(root, uniq('s8-rec-uploads')),
      forbiddenRoots: [liveRoot],
    })
    expect(r.ok).toBe(true)
    if (r.ok) for (const row of r.plan.rows) expect(row.to.startsWith(r.plan.newRoot + '/')).toBe(true)

    expect(existsSync(join(escape, 'doc1.pdf'))).toBe(false) // no canary bytes through the link
    expectLiveUntouched()
  })

  it('a traversal-shaped storedPath through `sym/..` can never place bytes at the link target', () => {
    const escape = join(root, uniq('s8b-escape'))
    mkdirSync(escape, { recursive: true })
    const uploadsDir = join(root, uniq('s8b-uploads'))
    mkdirSync(uploadsDir, { recursive: true })
    symlinkSync(escape, join(uploadsDir, 'sym'))

    // path.resolve() collapses `sym/..` lexically — the planned destination is
    // the plain resolved path, whose every component is validated at write
    // time; the link itself is never part of the write path.
    const dbPath = join(root, uniq('s8b-db'), 'custom.db')
    makeDbWithRows(dbPath, [{ id: 't1', storedPath: join(uploadsDir, 'sym', '..', 'doc1.pdf') }])
    const plan = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [] })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.plan.root).toBe(uploadsDir)
  })
})

// ─── S9: symlink target changed between planning and materialization ───────────

describe('S9: symlink target changed between planning and materialization', () => {
  it('a canonical root swapped to a symlink after planning refuses at write time', async () => {
    const canon = join(root, uniq('s9-root'))
    const escape = join(root, uniq('s9-escape'))
    mkdirSync(escape, { recursive: true })
    const dbPath = join(root, uniq('s9-db'), 'custom.db')
    makeDbWithRows(dbPath, [{ id: 't1', storedPath: join(canon, 'doc1.pdf') }])
    const plan = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [] })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)

    // Swap the (so far nonexistent) canonical root into a symlink AFTER planning.
    rmSync(canon, { force: true, recursive: true })
    symlinkSync(escape, canon)

    const m = await materializeCanonicalFiles(plan.plan, liveUploadsDir)
    expect(m.ok).toBe(false)
    if (!m.ok) expect(m.error).toContain('symbolic link')
    expect(existsSync(join(escape, 'doc1.pdf'))).toBe(false)
  })

  it('an intermediate directory swapped to a symlink after planning refuses at write time', async () => {
    const canon = join(root, uniq('s9b-root'))
    const escape = join(root, uniq('s9b-escape'))
    mkdirSync(escape, { recursive: true })
    const dbPath = join(root, uniq('s9b-db'), 'custom.db')
    makeDbWithRows(dbPath, [{ id: 't1', storedPath: join(canon, 'sub', 'doc1.pdf') }])
    const plan = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [] })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)

    // Between planning and materialization: real root, symlinked intermediate.
    mkdirSync(canon, { recursive: true })
    symlinkSync(escape, join(canon, 'sub'))

    const m = await materializeCanonicalFiles(plan.plan, liveUploadsDir)
    expect(m.ok).toBe(false)
    if (!m.ok) expect(m.error).toContain('symbolic link')
    expect(existsSync(join(escape, 'doc1.pdf'))).toBe(false)
    expect(existsSync(join(canon, 'sub', 'doc1.pdf'))).toBe(false)
  })
})

// ─── S10/S11: normal recovery remains successful ───────────────────────────────

describe('S10: normal canonical recovery remains successful', () => {
  it('materialises real regular files at the exact recorded paths, hash-identical', async () => {
    const canon = join(root, uniq('s10-canonical'))
    const dbPath = join(root, uniq('s10-db'), 'custom.db')
    makeDbWithRows(dbPath, [
      { id: 't1', storedPath: join(canon, 'doc1.pdf') },
      { id: 't2', storedPath: join(canon, 'doc2.pdf') },
    ])
    const plan = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [liveRoot] })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)

    const m = await materializeCanonicalFiles(plan.plan, liveUploadsDir)
    expect(m.ok).toBe(true)
    if (m.ok) expect(m.written).toBe(2)

    for (const [name, bytes] of [
      ['doc1.pdf', DOC1],
      ['doc2.pdf', DOC2],
    ] as const) {
      const p = join(canon, name)
      const st = lstatSync(p)
      expect(st.isSymbolicLink()).toBe(false)
      expect(st.isFile()).toBe(true)
      expect(sha(readFileSync(p))).toBe(sha(bytes))
    }
  })
})

describe('S11: normal remapped recovery remains successful', () => {
  it('populates a fresh real layout, remaps onto it, and the original database is byte-identical', async () => {
    const copyDir = join(root, uniq('s11-copy'))
    mkdirSync(copyDir, { recursive: true })
    const copyPath = join(copyDir, 'custom.db')
    writeFileSync(copyPath, readFileSync(liveDbPath), { mode: 0o600 })

    const rec = join(root, uniq('s11-recovery'))
    const populated = await populateRecoveryLayout({
      recoveryAppRoot: rec,
      dbBasename: 'custom.db',
      dbSourcePath: copyPath,
      restoredUploadsDir: liveUploadsDir,
      restoredEvidenceDir: liveEvidenceDir,
      forbiddenRoots: [liveRoot],
    })
    expect(populated.ok).toBe(true)
    if (!populated.ok) throw new Error(populated.error)

    // the new uploads root resolves to the intended recovery layout
    expect(populated.uploadsDir).toBe(join(rec, 'db', 'uploads'))
    expect(lstatSync(populated.uploadsDir).isSymbolicLink()).toBe(false)
    expect(lstatSync(populated.dbPath).isSymbolicLink()).toBe(false)

    const plan = planUploadsRemap({
      dbPath: populated.dbPath,
      manifestUploadNames: UPLOAD_NAMES,
      newRoot: populated.uploadsDir,
      forbiddenRoots: [liveRoot, copyDir],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)
    expect(plan.plan.originalRoot).toBe(liveUploadsDir)
    expect(plan.plan.newRoot).toBe(populated.uploadsDir)

    const applied = applyUploadsRemap(populated.dbPath, plan.plan)
    expect(applied.ok).toBe(true)
    if (applied.ok) expect(applied.applied).toBe(2)

    const db = new Database(populated.dbPath, { readonly: true, create: false })
    let rows: Array<{ id: string; storedPath: string }>
    let integrity: unknown
    try {
      rows = db.query('SELECT id, storedPath FROM StudyDocument ORDER BY id').all() as Array<{ id: string; storedPath: string }>
      integrity = db.query('PRAGMA integrity_check').get()
    } finally {
      db.close()
    }
    for (const row of rows) expect(row.storedPath.startsWith(populated.uploadsDir + '/')).toBe(true)
    expect(integrity).toEqual({ integrity_check: 'ok' })

    // the ORIGINAL database bytes never moved
    expect(sha(readFileSync(copyPath))).toBe(sha(readFileSync(liveDbPath)))
    expectLiveUntouched()
  })
})

// ─── S12: existing files are never overwritten ─────────────────────────────────

describe('S12: existing files are never overwritten', () => {
  it('a regular file at a destination refuses the plan', () => {
    const canon = join(root, uniq('s12a'))
    mkdirSync(canon, { recursive: true })
    writeFileSync(join(canon, 'doc1.pdf'), Buffer.from('PRE-EXISTING\n'))
    const dbPath = join(root, uniq('s12a-db'), 'custom.db')
    makeDbWithRows(dbPath, [{ id: 't1', storedPath: join(canon, 'doc1.pdf') }])
    const plan = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [] })
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.error).toContain('already exists')
    expect(readFileSync(join(canon, 'doc1.pdf')).toString()).toBe('PRE-EXISTING\n')
  })

  it('a DANGLING SYMLINK at a destination refuses the plan (existsSync would have missed it)', () => {
    const canon = join(root, uniq('s12b'))
    mkdirSync(canon, { recursive: true })
    symlinkSync(join(root, uniq('s12b-nowhere')), join(canon, 'doc1.pdf'))
    const dbPath = join(root, uniq('s12b-db'), 'custom.db')
    makeDbWithRows(dbPath, [{ id: 't1', storedPath: join(canon, 'doc1.pdf') }])
    const plan = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [] })
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.error).toContain('already exists')
      expect(plan.error).toContain('symbolic link')
    }
  })

  it('a file appearing between planning and materialization refuses the write — nothing is overwritten', async () => {
    const canon = join(root, uniq('s12c'))
    const dbPath = join(root, uniq('s12c-db'), 'custom.db')
    makeDbWithRows(dbPath, [
      { id: 't1', storedPath: join(canon, 'doc1.pdf') },
      { id: 't2', storedPath: join(canon, 'doc2.pdf') },
    ])
    const plan = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [liveRoot] })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)

    // Someone plants doc2.pdf between plan and write.
    mkdirSync(canon, { recursive: true })
    writeFileSync(join(canon, 'doc2.pdf'), Buffer.from('PLANTED-AFTER-PLAN\n'), { mode: 0o600 })

    const m = await materializeCanonicalFiles(plan.plan, liveUploadsDir)
    expect(m.ok).toBe(false)
    if (!m.ok) expect(m.error).toContain('appeared during materialization')
    expect(readFileSync(join(canon, 'doc2.pdf')).toString()).toBe('PLANTED-AFTER-PLAN\n')
  })
})

// ─── S13: failure cleanup never deletes pre-existing protected data ─────────────

describe('S13: failure cleanup never deletes pre-existing protected data', () => {
  it('canonical partial failure removes only the files the call wrote; protected dirs and planted files survive', async () => {
    const canon = join(root, uniq('s13-canonical'))
    mkdirSync(canon, { recursive: true })
    // PRE-EXISTING protected directory with user data inside the canonical root.
    mkdirSync(join(canon, 'precious'), { recursive: true })
    writeFileSync(join(canon, 'precious', 'user-data.txt'), 'USER DATA MUST SURVIVE\n')

    const dbPath = join(root, uniq('s13-db'), 'custom.db')
    makeDbWithRows(dbPath, [
      { id: 't1', storedPath: join(canon, 'doc1.pdf') },
      { id: 't2', storedPath: join(canon, 'doc2.pdf') },
    ])
    const plan = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [liveRoot] })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)

    // Failure AFTER the first write: plant the second destination.
    writeFileSync(join(canon, 'doc2.pdf'), Buffer.from('PLANTED-NOT-OURS\n'), { mode: 0o600 })

    const m = await materializeCanonicalFiles(plan.plan, liveUploadsDir)
    expect(m.ok).toBe(false)
    if (!m.ok) expect(m.error).toContain('partial failure')

    // The file the failed call wrote was cleaned up…
    expect(existsSync(join(canon, 'doc1.pdf'))).toBe(false)
    // …the pre-existing protected directory and its content are intact…
    expect(readFileSync(join(canon, 'precious', 'user-data.txt')).toString()).toBe('USER DATA MUST SURVIVE\n')
    // …the planted file was never deleted (it was not ours)…
    expect(readFileSync(join(canon, 'doc2.pdf')).toString()).toBe('PLANTED-NOT-OURS\n')
    // …and the root itself was never removed.
    expect(existsSync(canon)).toBe(true)
  })

  it('recovery-layout partial failure removes only written files and leaves the escape target untouched', async () => {
    const storage = makeStoragewithSymlink(uniq('s13b'), 'evidence') // uploads real, evidence has symlink
    const rec = join(root, uniq('s13b-rec'))
    const p = await populateRecoveryLayout({
      recoveryAppRoot: rec,
      dbBasename: 'custom.db',
      dbSourcePath: liveDbPath,
      restoredUploadsDir: storage.uploadsDir,
      restoredEvidenceDir: storage.evidenceDir,
      forbiddenRoots: [liveRoot],
    })
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.error).toContain('partial failure')

    // The evidence symlink's TARGET never received bytes…
    expect(existsSync(join(storage.escape, 'secret-target.bin'))).toBe(false)
    // …the freshly created layout was rolled back (all dirs empty → removed)…
    expect(existsSync(join(rec, 'db'))).toBe(false)
    // …and nothing pre-existing (the live root, the storage roots) was touched.
    expectLiveUntouched()
    expect(existsSync(join(storage.uploadsDir, 'doc1.pdf'))).toBe(true)
  })

  it('a written leaf that has become a symlink is left untouched (never unlinked blindly)', async () => {
    const canon = join(root, uniq('s13c'))
    const dbPath = join(root, uniq('s13c-db'), 'custom.db')
    makeDbWithRows(dbPath, [
      { id: 't1', storedPath: join(canon, 'doc1.pdf') },
      { id: 't2', storedPath: join(canon, 'doc2.pdf') },
    ])
    const plan = planCanonicalMaterialization({ dbPath, manifestUploadNames: UPLOAD_NAMES, forbiddenRoots: [liveRoot] })
    expect(plan.ok).toBe(true)
    if (!plan.ok) throw new Error(plan.error)

    // Force a failure AFTER the first write by planting the second destination…
    mkdirSync(canon, { recursive: true })
    writeFileSync(join(canon, 'doc2.pdf'), Buffer.from('STOP\n'))
    const m = await materializeCanonicalFiles(plan.plan, liveUploadsDir)
    expect(m.ok).toBe(false)

    // …then swap the leaf the call wrote into a symlink and rerun cleanup via a
    // fresh failing attempt: the swapped leaf must never be unlinked blindly.
    const firstLeaf = join(canon, 'doc1.pdf')
    // The failed run above already cleaned doc1.pdf; re-create the scenario by
    // planting doc1.pdf as a symlink and failing again on doc2.pdf.
    const escape = join(root, uniq('s13c-escape'))
    mkdirSync(escape, { recursive: true })
    symlinkSync(join(escape, 'victim.bin'), firstLeaf)
    const m2 = await materializeCanonicalFiles(plan.plan, liveUploadsDir)
    expect(m2.ok).toBe(false)
    // The symlink at doc1.pdf survived the cleanup (lstat-regular-file guard).
    expect(lstatSync(firstLeaf).isSymbolicLink()).toBe(true)
    expect(existsSync(join(escape, 'victim.bin'))).toBe(false)
  })
})

// ─── Bonus boundary: manifest-driven paths are untrusted ───────────────────────

describe('OPS-2.1: restored-tree manifest paths are untrusted', () => {
  function writeManifest(dir: string, databaseFile: string, uploadEntry: { name: string; sha256: string; bytes: number }): void {
    const manifest: BackupManifest = {
      schema: 'bean-backup-manifest/1',
      tool: { name: 'bean-ops-backup', version: '1.0.0' },
      createdAt: new Date().toISOString(),
      resticVersion: '0.18.0-fake',
      database: {
        file: databaseFile as BackupManifest['database']['file'],
        method: 'sqlite-vacuum-into',
        sourceBasename: 'custom.db',
        sha256: '0'.repeat(64),
        bytes: 1,
        journalModeObserved: 'delete',
      },
      uploads: { sourceRoot: 'db/uploads', fileCount: 1, totalBytes: uploadEntry.bytes, entries: [uploadEntry] },
      evidence: { sourceRoot: 'db/evidence', fileCount: 0, totalBytes: 0, entries: [] },
      exclusions: [],
    }
    mkdirSync(dir, { recursive: true })
    const json = JSON.stringify(manifest)
    writeFileSync(join(dir, 'manifest.json'), json)
    writeFileSync(join(dir, 'manifest.json.sha256'), sha(Buffer.from(json, 'utf8')) + '\n')
  }

  it('a SYMLINKED restored database (alias to a live database) fails verification closed', async () => {
    const restored = join(root, uniq('s14-restored'))
    mkdirSync(join(restored, 'data', 'database'), { recursive: true })
    writeManifest(restored, 'data/database/custom.db', { name: 'doc1.pdf', sha256: sha(DOC1), bytes: DOC1.length })
    // The restored "database" is a symlink alias pointing at the LIVE db.
    symlinkSync(liveDbPath, join(restored, 'data', 'database', 'custom.db'))

    const report = await verifyRestoredBackup(restored, { projectRoot: root, runPrismaMigrateStatus: false })
    const loc = report.checks.find((c) => c.id === 'db-location')
    expect(report.ok).toBe(false)
    expect(loc?.ok).toBe(false)
    expect(loc?.detail).toContain('symbolic link')
    expectLiveUntouched()
  })

  it('a manifest database.file that escapes the restored tree is refused before any open', async () => {
    const restored = join(root, uniq('s15-restored'))
    writeManifest(restored, '../../outside/custom.db', { name: 'doc1.pdf', sha256: sha(DOC1), bytes: DOC1.length })
    const report = await verifyRestoredBackup(restored, { projectRoot: root, runPrismaMigrateStatus: false })
    const loc = report.checks.find((c) => c.id === 'db-location')
    expect(report.ok).toBe(false)
    expect(loc?.ok).toBe(false)
    expect(loc?.detail).toContain('traversal refused')
  })

  it('a symlinked manifest.json itself is refused (verification never follows symlinks)', () => {
    const restored = join(root, uniq('s16-restored'))
    mkdirSync(restored, { recursive: true })
    const outsideManifest = join(root, uniq('s16-outside-manifest.json'))
    writeFileSync(outsideManifest, '{"schema":"bean-backup-manifest/1"}')
    symlinkSync(outsideManifest, join(restored, 'manifest.json'))
    const loaded = loadVerifiedManifest(restored)
    expect(loaded.ok).toBe(false)
    if (!loaded.ok) expect(loaded.error).toContain('symbolic link')
  })
})

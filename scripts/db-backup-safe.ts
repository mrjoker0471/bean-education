// ─── OPS-2: safe pre-migration database snapshot (replaces the old `cp`) ──────
//
// `bun run db:backup` previously executed a plain filesystem `cp` of the live
// SQLite file — exactly what the OPS-2 backup/restore standard forbids for an
// actively written database (a cp can tear a database mid-write). This script
// keeps the documented developer workflow ("backup before every schema change")
// but takes the snapshot through SQLite's own backup facility (VACUUM INTO),
// which always yields a transactionally consistent copy regardless of writers.
//
// Scope honesty (printed on every run):
//   • This is a DATABASE-ONLY pre-migration snapshot for development/migration
//     sessions. It does NOT include db/uploads/ or db/evidence/ and is not the
//     disaster-recovery backup. For complete verified backups use ops:backup.
//
// Target convention preserved from the old script: db/backups/<name>-<ts>.db
// (git-ignored; db/backups is excluded from backup scope as a backup repository
// inside the source tree).

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { resolveDatabaseFileUrl } from './ops/lib/backup-core'

async function main(): Promise<number> {
  const projectRoot = process.cwd()
  const databaseUrl = process.env.DATABASE_URL ?? ''
  if (!databaseUrl) {
    console.error(
      '[db:backup] DATABASE_URL is not set — refusing to guess which database to snapshot. ' +
        'Set DATABASE_URL (bun auto-loads .env) and retry.',
    )
    return 1
  }
  const resolved = resolveDatabaseFileUrl(databaseUrl, projectRoot)
  if (!resolved.ok) {
    console.error(`[db:backup] ${resolved.error}`)
    return 1
  }
  const dbPath = resolved.dbPath
  if (!existsSync(dbPath)) {
    console.error(`[db:backup] database file does not exist: ${dbPath} — nothing to snapshot.`)
    return 1
  }

  for (const suffix of ['-journal', '-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) {
      console.warn(
        `[db:backup] NOTE: ${path.basename(dbPath + suffix)} exists — writers may be active. The VACUUM INTO ` +
          'snapshot below is still transactionally consistent, but it captures ONLY the database.',
      )
    }
  }

  const backupDir = path.join(projectRoot, 'db', 'backups')
  await mkdir(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
  const target = path.join(backupDir, `${path.basename(dbPath, '.db')}-${stamp}.db`)

  const ro = new Database(dbPath, { readonly: true, create: false })
  let mode = 'unknown'
  try {
    const modeRow = ro.query('PRAGMA journal_mode').get() as { journal_mode?: string } | null
    mode = modeRow?.journal_mode ?? 'unknown'
    ro.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  } finally {
    ro.close()
  }

  // Verify the snapshot before claiming success.
  const snap = new Database(target, { readonly: true, create: false })
  let integrity = 'unknown'
  try {
    const ic = snap.query('PRAGMA integrity_check').get() as { integrity_check?: string } | null
    integrity = ic?.integrity_check ?? 'unknown'
  } finally {
    snap.close()
  }
  if (integrity !== 'ok') {
    console.error(`[db:backup] snapshot FAILED integrity_check (${integrity}) — deleting the bad snapshot.`)
    await rm(target, { force: true })
    return 1
  }

  // Restricted-store file discipline: 0600 (chmod explicitly — the file was
  // created by VACUUM INTO under the process umask).
  const bytes = await readFile(target)
  await chmod(target, 0o600)
  await stat(target) // confirm materialization
  const sha = createHash('sha256').update(bytes).digest('hex')

  console.log(`[db:backup] snapshot created : ${target}`)
  console.log(`[db:backup] size            : ${bytes.length} bytes · sha256 ${sha.slice(0, 16)}…`)
  console.log(`[db:backup] integrity_check : ok (journal mode observed: ${mode})`)
  console.log('[db:backup] SCOPE: database only — uploads/evidence are NOT included. For complete verified')
  console.log('[db:backup] backups (files + manifest + encrypted repository + restore drill) use:')
  console.log('[db:backup]   bun run ops:backup   (see docs/OPS-2-BACKUP-RESTORE.md)')
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[db:backup] unexpected failure: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  },
)

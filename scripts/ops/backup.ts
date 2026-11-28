// ─── OPS-2C: operator backup CLI ───────────────────────────────────────────────
//
//   bun scripts/ops/backup.ts init-repo [--repo <dir|rest:…>] [flags]
//   bun scripts/ops/backup.ts backup    [--repo <dir|rest:…>] [flags]
//
// Repository:  --repo argument or BEAN_BACKUP_REPOSITORY (local dir today;
//              rest:/s3:/rclone: backends later — no provider is hard-coded).
// Password:    RESTIC_PASSWORD_FILE (0600, outside the source tree) or
//              RESTIC_PASSWORD_COMMAND. Bare RESTIC_PASSWORD is refused.
// Sources:     SQLite DB resolved from DATABASE_URL (Prisma's real
//              relative-path semantics), db/uploads and db/evidence relative
//              to the current working directory (overridable via
//              BEAN_BACKUP_UPLOADS_DIR / BEAN_BACKUP_EVIDENCE_DIR).
// Offline:     --confirm-offline asserts the app + workers are stopped; the
//              tool additionally refuses while SQLite journal sidecars exist.
//
// Exit codes:  0 success · 1 any failed/incomplete stage · 2 usage error.

import {
  resolveResticBinary,
  createResticAdapter,
  ResticRepositoryAlreadyInitialized,
} from './lib/restic'
import { initializeBackupRepository, runBackupFlow, ensureStageParent } from './lib/backup-run'

interface CliArgs {
  command: 'init-repo' | 'backup'
  repo?: string
  confirmOffline: boolean
  verifyData: boolean
  keepStage: boolean
  allowInTree: boolean
  resticBin?: string
  stageParent?: string
  passwordFile?: string
  passwordCommand?: string
  uploadsDir?: string
  evidenceDir?: string
}

function parseArgs(argv: string[]): CliArgs | { usageError: string } {
  const command = argv[0]
  if (command !== 'init-repo' && command !== 'backup') {
    return { usageError: `unknown command "${String(command ?? '')}" — use "backup" or "init-repo"` }
  }
  const args: CliArgs = {
    command,
    confirmOffline: false,
    verifyData: false,
    keepStage: false,
    allowInTree: false,
  }
  const rest = argv.slice(1)
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    const next = () => rest[++i]
    switch (a) {
      case '--repo': args.repo = next(); break
      case '--confirm-offline': args.confirmOffline = true; break
      case '--verify-data': args.verifyData = true; break
      case '--keep-stage': args.keepStage = true; break
      case '--allow-in-tree': args.allowInTree = true; break
      case '--restic-bin': args.resticBin = next(); break
      case '--stage-parent': args.stageParent = next(); break
      case '--password-file': args.passwordFile = next(); break
      case '--password-command': args.passwordCommand = next(); break
      case '--uploads-dir': args.uploadsDir = next(); break
      case '--evidence-dir': args.evidenceDir = next(); break
      case '--help': case '-h': return { usageError: 'help requested' }
      default: return { usageError: `unknown flag "${a}"` }
    }
  }
  return args
}

function usage(): string {
  return [
    'BEAN Education backup toolkit (OPS-2) — encrypted, verified, restic-backed.',
    '',
    'Usage:',
    '  bun scripts/ops/backup.ts init-repo [--repo <dir|rest:…>] [flags]   # explicit one-time repository init',
    '  bun scripts/ops/backup.ts backup    [--repo <dir|rest:…>] [flags]   # create a verified backup',
    '',
    'Required inputs:',
    '  DATABASE_URL                    sqlite file: URL (relative paths resolve against prisma/ — Prisma semantics)',
    '  repository                      --repo or BEAN_BACKUP_REPOSITORY',
    '  password                        RESTIC_PASSWORD_FILE (chmod 600, outside the source tree) or RESTIC_PASSWORD_COMMAND',
    '',
    'Flags:',
    '  --confirm-offline   assert the app + background workers are gracefully stopped (required for backup)',
    '  --verify-data       run restic check --read-data (full byte-level integrity verification)',
    '  --keep-stage        keep the staging tree for inspection (default: removed after the run)',
    '  --allow-in-tree     allow repo/stage inside the project source tree (strongly discouraged)',
    '  --restic-bin <p>    restic binary override (default: RESTIC_BIN or PATH)',
    '  --stage-parent <d>  where to create the staging tree (default: system temp)',
    '  --uploads-dir <d> / --evidence-dir <d>   storage-root overrides (default: <cwd>/db/… ; env: BEAN_BACKUP_UPLOADS_DIR, BEAN_BACKUP_EVIDENCE_DIR)',
    '',
    'Exit codes: 0 success · 1 any failed or incomplete stage · 2 usage error.',
    'Documentation: docs/OPS-2-BACKUP-RESTORE.md',
  ].join('\n')
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2))
  if ('usageError' in parsed) {
    console.error(usage())
    if (parsed.usageError !== 'help requested') console.error(`\nError: ${parsed.usageError}`)
    return 2
  }
  const args = parsed

  const repository = args.repo ?? process.env.BEAN_BACKUP_REPOSITORY ?? ''
  if (!repository) {
    console.error('No repository configured — pass --repo <dir|rest:…> or set BEAN_BACKUP_REPOSITORY.\n')
    console.error(usage())
    return 2
  }
  const uploadsDir = args.uploadsDir ?? process.env.BEAN_BACKUP_UPLOADS_DIR
  const evidenceDir = args.evidenceDir ?? process.env.BEAN_BACKUP_EVIDENCE_DIR
  const passwordFile = args.passwordFile ?? process.env.RESTIC_PASSWORD_FILE
  const passwordCommand = args.passwordCommand ?? process.env.RESTIC_PASSWORD_COMMAND

  const projectRoot = process.cwd()
  const binary = await resolveResticBinary({ resticBin: args.resticBin })
  const adapter = createResticAdapter(
    { repository, passwordFile, passwordCommand },
    binary,
  )

  console.log(`[backup] restic ${binary.version} (${binary.bin})`)
  console.log(`[backup] repository: ${repository}`)

  if (args.command === 'init-repo') {
    if (args.confirmOffline) console.log('[backup] note: --confirm-offline is not needed for init-repo')
    try {
      const result = await initializeBackupRepository(
        { repository, allowInTree: args.allowInTree, projectRoot },
        adapter,
      )
      if (!result.ok) {
        console.error(`[backup] init-repo FAILED: ${result.error}`)
        return 1
      }
      console.log('[backup] repository initialized. Record the recovery password independently of this host NOW —')
      console.log('         a lost repository password means every backup inside it is UNRECOVERABLE.')
      return 0
    } catch (err) {
      if (err instanceof ResticRepositoryAlreadyInitialized) {
        console.error(`[backup] init-repo FAILED: ${err.message}`)
        return 1
      }
      console.error(`[backup] init-repo FAILED: ${err instanceof Error ? err.message : String(err)}`)
      return 1
    }
  }

  // backup
  if (args.stageParent) await ensureStageParent(args.stageParent)
  const result = await runBackupFlow(
    {
      projectRoot,
      databaseUrl: process.env.DATABASE_URL ?? '',
      uploadsDir,
      evidenceDir,
      repository,
      confirmOffline: args.confirmOffline,
      verifyData: args.verifyData,
      keepStage: args.keepStage,
      allowInTree: args.allowInTree,
      stageParent: args.stageParent,
    },
    adapter,
  )

  for (const entry of result.log) {
    console.log(`[backup] stage=${entry.stage} ok=${entry.ok} — ${entry.detail}`)
  }

  if (!result.ok) {
    console.error(`\n[backup] FAILED at stage "${result.failedStage}" — nothing was reported as successful.`)
    if (result.stageDir && !result.stageRemoved) {
      console.error(`[backup] staging tree kept at ${result.stageDir} for inspection (remove it manually).`)
    }
    return 1
  }

  const m = result.manifest
  console.log('')
  console.log(`[backup] SUCCESS — snapshot ${result.snapshotId}`)
  console.log(`[backup]   database     : ${m.database.file} (${m.database.bytes} bytes, method: ${m.database.method}, sha256 ${m.database.sha256.slice(0, 16)}…)`)
  console.log(`[backup]   uploads      : ${m.uploads.fileCount} file(s), ${m.uploads.totalBytes} bytes`)
  console.log(`[backup]   evidence     : ${m.evidence.fileCount} file(s), ${m.evidence.totalBytes} bytes`)
  console.log(`[backup]   manifest     : sha256 ${result.manifestSha256.slice(0, 16)}… (manifest.json + sidecar inside the snapshot)`)
  console.log(`[backup]   exclusions   : ${m.exclusions.length} policies applied (see docs/OPS-2-BACKUP-RESTORE.md)`)
  console.log('[backup] Remember: this proves the LOCAL backup capability. Remote destination,')
  console.log('[backup] schedule and retention remain owner decisions (docs/OPS-2-BACKUP-RESTORE.md).')
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[backup] unexpected failure: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  },
)

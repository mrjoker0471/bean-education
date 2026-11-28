// ─── OPS-2D: restore drill CLI ────────────────────────────────────────────────
//
//   bun scripts/ops/restore-drill.ts [--repo <dir>] [flags]
//   bun scripts/ops/restore-drill.ts --fault <scenario>            # prove detection
//
// Runs the FULL isolated acceptance drill: real migration-chain fixture →
// verified backup → restic check (--read-data) → restore into a fresh empty
// directory → integrity/foreign-key/migration/hash/reference verification →
// path-portability proofs (canonical + validated remap, both opened through
// the application's REAL file-reading logic — see docs §4.5) → cleanup. With
// --fault, the drill injects one failure and asserts it is DETECTED (exit 0) —
// if the fault is NOT detected, the drill exits 1.
//
// No real user data, no live database, no cloud credentials. The only restic
// repository touched is the drill's own throwaway (or the --repo one you name).

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveResticBinary, createResticAdapter } from './lib/restic'
import { runRestoreDrill, RESTORE_DRILL_FAULTS, type RestoreDrillFault } from './lib/restore-run'

interface DrillArgs {
  repo?: string
  fixtureRoot?: string
  restoreTarget?: string
  keep: boolean
  resticBin?: string
  fault?: RestoreDrillFault
  skipMigrateStatus: boolean
  passwordFile?: string
  passwordCommand?: string
}

function parseArgs(argv: string[]): DrillArgs | { usageError: string } {
  const args: DrillArgs = { keep: false, skipMigrateStatus: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '--repo': args.repo = next(); break
      case '--fixture-root': args.fixtureRoot = next(); break
      case '--restore-target': args.restoreTarget = next(); break
      case '--keep': args.keep = true; break
      case '--restic-bin': args.resticBin = next(); break
      case '--fault': {
        const v = next()
        if (!v || !RESTORE_DRILL_FAULTS.includes(v as RestoreDrillFault)) {
          return { usageError: `--fault must be one of: ${RESTORE_DRILL_FAULTS.join(', ')}` }
        }
        args.fault = v as RestoreDrillFault
        break
      }
      case '--skip-migrate-status': args.skipMigrateStatus = true; break
      case '--password-file': args.passwordFile = next(); break
      case '--password-command': args.passwordCommand = next(); break
      case '--help': case '-h': return { usageError: 'help requested' }
      default: return { usageError: `unknown flag "${a}"` }
    }
  }
  return args
}

function usage(): string {
  return [
    'BEAN Education restore drill (OPS-2D) — proves a backup can be restored and verified.',
    '',
    'Usage:',
    '  bun scripts/ops/restore-drill.ts [flags]              # full drill with a throwaway repository',
    '  bun scripts/ops/restore-drill.ts --fault <scenario>   # inject one failure; it MUST be detected',
    '',
    'Fault scenarios (each must be detected; nondetection exits 1):',
    ...RESTORE_DRILL_FAULTS.map((f) => `  ${f}`),
    '',
    'Flags:',
    '  --repo <dir>            run the drill against this (initialized) repository instead of a throwaway',
    '  --fixture-root <dir>    where to build the fixture (default: private temp, removed afterwards)',
    '  --restore-target <dir>  where to restore (default: private empty temp dir; never overlaps live data)',
    '  --keep                  keep fixture/repo/target for inspection (default: all temp data removed)',
    '  --restic-bin <p>        restic binary override (default: RESTIC_BIN or PATH)',
    '  --skip-migrate-status   skip the prisma migrate status CLI gate (unit tests use this)',
    '  --password-file / --password-command   password source (default: drill generates its own temp password)',
    '',
    'Exit codes: 0 drill passed (or fault correctly detected) · 1 failure or UNDETECTED fault · 2 usage error.',
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
  const projectRoot = process.cwd()

  const binary = await resolveResticBinary({ resticBin: args.resticBin })
  const repository = args.repo
  let passwordFile = args.passwordFile
  let passwordCommand = args.passwordCommand
  const drillTempRoot = repository ? undefined : await mkdtemp(path.join(tmpdir(), 'bean-ops2-cli-'))
  if (!repository) {
    // Throwaway repository + throwaway password (random, written 0600 outside the source tree).
    // The drill library discovers the repo location through the adapter (repositoryDir).
    const { writeFile, chmod, mkdir } = await import('node:fs/promises')
    const { randomBytes } = await import('node:crypto')
    await mkdir(drillTempRoot, { recursive: true })
    const passwordPath = path.join(drillTempRoot, 'drill-repo-password')
    await writeFile(passwordPath, randomBytes(32).toString('base64'), { mode: 0o600 })
    await chmod(passwordPath, 0o600)
    passwordFile = passwordPath
  }
  if (!passwordFile && !passwordCommand) {
    console.error('No password source — pass --password-file or --password-command (or use the default throwaway repository).')
    return 2
  }

  const adapter = createResticAdapter(
    {
      repository: repository ?? path.join(drillTempRoot ?? '', 'restic-repo'),
      passwordFile,
      passwordCommand,
    },
    binary,
  )
  console.log(`[drill] restic ${binary.version} (${binary.bin})`)
  console.log(`[drill] repository: ${adapter.repositoryDir ?? repository}${args.fault ? ` · fault: ${args.fault}` : ''}`)

  const result = await runRestoreDrill(
    {
      projectRoot,
      repository: args.repo,
      fixtureRoot: args.fixtureRoot,
      restoreTarget: args.restoreTarget,
      keep: args.keep,
      fault: args.fault,
      runMigrateStatus: !args.skipMigrateStatus,
    },
    adapter,
  )

  console.log('')
  for (const step of result.steps) {
    console.log(`[drill] ${step.ok ? 'PASS' : 'FAIL'} ${step.step} — ${step.detail}`)
  }
  console.log('')

  // Remove the CLI's throwaway repo root unless the drill kept it for inspection.
  if (drillTempRoot && !args.keep) {
    const { rm } = await import('node:fs/promises')
    await rm(drillTempRoot, { recursive: true, force: true }).catch(() => undefined)
  }

  if (!result.ok) {
    console.error(`[drill] FAILED at step "${result.failedStep}". Nothing was reported as successful.`)
    return 1
  }
  if (args.fault) {
    console.log(`[drill] FAULT SCENARIO PASSED — "${args.fault}" was correctly detected and never reported as success.`)
  } else {
    console.log('[drill] RESTORE DRILL PASSED — the backup was created, integrity-checked, restored into an')
    console.log('[drill] isolated environment, and independently verified (manifest, SQLite integrity,')
    console.log('[drill] foreign keys, migration history, file hashes, database→file references).')
    console.log('[drill] This proves the tested LOCAL capability; remote destination, schedule and retention')
    console.log('[drill] remain owner decisions.')
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[drill] unexpected failure: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  },
)

// ─── OPS-2E: retention CLI — EXPLICIT, gated, never called by backup ─────────
//
//   BEAN_BACKUP_RETENTION_APPROVED=true bun scripts/ops/retention.ts \
//     --policy-file retention-policy.json --forget --prune
//
// Hard gates (every one must pass or the command refuses — nothing is deleted):
//   1. BEAN_BACKUP_RETENTION_APPROVED must be exactly "true" — the owner has
//      explicitly approved a retention policy (docs/OPS-2-BACKUP-RESTORE.md
//      marks the proposed policy OWNER APPROVAL REQUIRED).
//   2. A policy file must be supplied (--policy-file) declaring keep-* counts.
//      Retention never invents a policy.
//   3. Deletion must be requested flag by flag: --forget (snapshot removal)
//      and --prune (data reclaim). Backup creation NEVER deletes anything and
//      never invokes this command; restore is fully independent.
//   4. `restic check` runs after retention; a failed check fails the command.
//
// Exit codes: 0 success · 1 refused or failed · 2 usage error.

import { readFile } from 'node:fs/promises'
import {
  resolveResticBinary,
  createResticAdapter,
  runResticMaintenanceCommand,
} from './lib/restic'

interface RetentionPolicy {
  keepLast?: number
  keepDaily?: number
  keepWeekly?: number
  keepMonthly?: number
  keepYearly?: number
  /** Free-text justification recorded in the command log (recommended). */
  rationale?: string
}

interface RetentionArgs {
  policyFile?: string
  forget: boolean
  prune: boolean
  resticBin?: string
  repo?: string
  passwordFile?: string
  passwordCommand?: string
}

function parseArgs(argv: string[]): RetentionArgs | { usageError: string } {
  const args: RetentionArgs = { forget: false, prune: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '--policy-file': args.policyFile = next(); break
      case '--forget': args.forget = true; break
      case '--prune': args.prune = true; break
      case '--restic-bin': args.resticBin = next(); break
      case '--repo': args.repo = next(); break
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
    'BEAN Education retention (OPS-2E) — explicit snapshot forget/prune, OWNER-APPROVAL GATED.',
    '',
    'Usage:',
    '  BEAN_BACKUP_RETENTION_APPROVED=true bun scripts/ops/retention.ts \\',
    '       --policy-file retention-policy.json [--forget] [--prune] [flags]',
    '',
    'Policy file (JSON): { "keepLast": 4, "keepDaily": 7, "keepWeekly": 4, "keepMonthly": 6,',
    '                      "keepYearly": 1, "rationale": "owner-approved on <date> by <name>" }',
    '',
    'The proposed policy in docs/OPS-2-BACKUP-RESTORE.md is marked OWNER APPROVAL REQUIRED.',
    'Without BEAN_BACKUP_RETENTION_APPROVED=true this command refuses to run.',
    '',
    'Exit codes: 0 success · 1 refused or failed · 2 usage error.',
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

  if (process.env.BEAN_BACKUP_RETENTION_APPROVED !== 'true') {
    console.error(
      '[retention] REFUSED — BEAN_BACKUP_RETENTION_APPROVED is not set to "true".\n' +
        '[retention] The retention policy is a decision reserved to the owner\n' +
        '[retention] (docs/OPS-2-BACKUP-RESTORE.md, section "Retention — OWNER APPROVAL REQUIRED").\n' +
        '[retention] Nothing was deleted.',
    )
    return 1
  }
  if (!args.policyFile) {
    console.error('[retention] REFUSED — no --policy-file given. Retention never invents a policy. Nothing was deleted.')
    return 1
  }
  if (!args.forget && !args.prune) {
    console.error('[retention] REFUSED — nothing requested: pass --forget and/or --prune explicitly. Nothing was deleted.')
    return 1
  }

  let policy: RetentionPolicy
  try {
    policy = JSON.parse(await readFile(args.policyFile, 'utf8')) as RetentionPolicy
  } catch (err) {
    console.error(`[retention] REFUSED — policy file unreadable or invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  const repository = args.repo ?? process.env.BEAN_BACKUP_REPOSITORY ?? ''
  if (!repository) {
    console.error('[retention] REFUSED — no repository configured (--repo or BEAN_BACKUP_REPOSITORY). Nothing was deleted.')
    return 1
  }
  const spec = {
    repository,
    passwordFile: args.passwordFile ?? process.env.RESTIC_PASSWORD_FILE,
    passwordCommand: args.passwordCommand ?? process.env.RESTIC_PASSWORD_COMMAND,
  }

  const binary = await resolveResticBinary({ resticBin: args.resticBin })
  const adapter = createResticAdapter(spec, binary)

  console.log(`[retention] restic ${binary.version} · repository: ${repository}`)
  console.log(
    `[retention] approved policy: keepLast=${policy.keepLast ?? '—'} keepDaily=${policy.keepDaily ?? '—'} ` +
      `keepWeekly=${policy.keepWeekly ?? '—'} keepMonthly=${policy.keepMonthly ?? '—'} keepYearly=${policy.keepYearly ?? '—'}`,
  )
  if (policy.rationale) console.log(`[retention] rationale: ${policy.rationale}`)

  try {
    if (args.forget) {
      const flags: string[] = []
      if (policy.keepLast !== undefined) flags.push('--keep-last', String(policy.keepLast))
      if (policy.keepDaily !== undefined) flags.push('--keep-daily', String(policy.keepDaily))
      if (policy.keepWeekly !== undefined) flags.push('--keep-weekly', String(policy.keepWeekly))
      if (policy.keepMonthly !== undefined) flags.push('--keep-monthly', String(policy.keepMonthly))
      if (policy.keepYearly !== undefined) flags.push('--keep-yearly', String(policy.keepYearly))
      if (flags.length === 0) {
        console.error('[retention] REFUSED — policy declares no keep-* rules; refusing to run forget with empty retention. Nothing was deleted.')
        return 1
      }
      const forgetArgs = ['forget', ...flags, '--tag', 'bean-education']
      console.log(`[retention] running: restic ${forgetArgs.join(' ')}`)
      const out = await runResticMaintenanceCommand(spec, binary, forgetArgs)
      console.log(out.trim())
    }

    if (args.prune) {
      console.log('[retention] running: restic prune')
      const out = await runResticMaintenanceCommand(spec, binary, ['prune'], { timeoutMs: 60 * 60_000 })
      console.log(out.trim())
    }

    // Post-retention integrity gate — a failed check fails the command.
    await adapter.check(false)
    console.log('[retention] post-retention repository check passed.')
    return 0
  } catch (err) {
    console.error(`[retention] FAILED: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`[retention] unexpected failure: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  },
)

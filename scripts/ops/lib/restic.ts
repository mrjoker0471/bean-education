// ─── OPS-2B: Restic repository-engine adapter (thin, honest, fail-closed) ────
//
// The backup/restore toolkit shells out to the OFFICIAL Restic CLI as an
// external host dependency. This module is the ONLY place that knows about
// the restic process surface.
//
// Safety rules enforced here:
//   • The repository password never travels on a command line. It is handed
//     to restic exclusively through RESTIC_PASSWORD_FILE (securely
//     permissioned, 0600) or RESTIC_PASSWORD_COMMAND. A bare RESTIC_PASSWORD
//     environment variable is refused outright (process listings / shell
//     history leak risk).
//   • The child process receives a MINIMAL environment (PATH/HOME/TMPDIR plus
//     the explicit restic variables) — the parent's secrets never leak into
//     restic.
//   • Every invocation is bounded by a timeout — a hung restic call fails
//     closed instead of hanging the backup forever.
//   • Any error text that could contain a repository URL with embedded
//     credentials is redacted before it is surfaced.
//
// Tested with restic 0.18.0 (official release, SHA256-verified against the
// published SHA256SUMS). Minimum supported floor: 0.17.0 (documented in
// docs/OPS-2-BACKUP-RESTORE.md). The exact version is recorded in every
// backup manifest so a restore always knows what created it.

import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'

/** Minimum restic version the toolkit is documented to support. */
export const RESTIC_MIN_VERSION = '0.17.0'
/** The version this milestone was actually tested against. */
export const RESTIC_TESTED_VERSION = '0.18.0'

const RESTIC_TIMEOUT_MS = 10 * 60_000

/** Compare dotted version strings numerically (a >= b). */
export function versionAtLeast(actual: string, minimum: string): boolean {
  const a = actual.split('.').map((n) => Number.parseInt(n, 10))
  const b = minimum.split('.').map((n) => Number.parseInt(n, 10))
  if (a.some((n) => Number.isNaN(n)) || b.some((n) => Number.isNaN(n))) return false
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av !== bv) return av > bv
  }
  return true
}

/** Parse "restic 0.18.0 compiled with go1.24.1 ..." → "0.18.0" (or null). */
export function parseResticVersion(versionOutput: string): string | null {
  const m = /^restic\s+(\d+\.\d+\.\d+)\b/.exec(versionOutput.trim())
  return m ? m[1] : null
}

/** Redact credentials embedded in repository URLs before any text is printed. */
export function redactRepositoryUrl(text: string): string {
  return text.replace(/(rest?:\/\/)[^/\s@]+:[^/\s@]+@/g, '$1***:***@')
}

export interface ResticConnectionSpec {
  /** Restic location spec: a local directory path, or a future rest:/s3:/… backend. */
  repository: string
  /** Absolute path to a securely permissioned password file (0600). */
  passwordFile?: string
  /** Password command whose stdout is the password (restic-native contract). */
  passwordCommand?: string
}

export type ResticEnvResolution =
  | { ok: true; env: Record<string, string> }
  | { ok: false; error: string }

/**
 * Build the minimal child environment for restic and enforce the password
 * policy. Never includes RESTIC_PASSWORD; never echoes secret material.
 */
export async function resolveResticEnv(spec: ResticConnectionSpec): Promise<ResticEnvResolution> {
  if (process.env.RESTIC_PASSWORD !== undefined) {
    return {
      ok: false,
      error:
        'RESTIC_PASSWORD is set in the environment. The toolkit refuses bare password ' +
        'environment variables (leak risk via process listings and shell history). ' +
        'Unset RESTIC_PASSWORD and provide RESTIC_PASSWORD_FILE (0600) or ' +
        'RESTIC_PASSWORD_COMMAND instead.',
    }
  }
  if (!spec.repository) return { ok: false, error: 'repository location is required' }
  if (!spec.passwordFile && !spec.passwordCommand) {
    return {
      ok: false,
      error:
        'no repository password source configured — provide RESTIC_PASSWORD_FILE ' +
        '(securely permissioned 0600 file, stored OUTSIDE the backup source tree) or ' +
        'RESTIC_PASSWORD_COMMAND',
    }
  }
  if (spec.passwordFile && spec.passwordCommand) {
    return { ok: false, error: 'provide exactly one password source (file or command), not both' }
  }

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    RESTIC_REPOSITORY: spec.repository,
  }
  if (spec.passwordFile) {
    let st
    try {
      st = await stat(spec.passwordFile)
    } catch {
      return { ok: false, error: `RESTIC_PASSWORD_FILE does not exist: ${spec.passwordFile}` }
    }
    if (!st.isFile()) return { ok: false, error: 'RESTIC_PASSWORD_FILE must be a regular file' }
    if (st.size === 0) return { ok: false, error: 'RESTIC_PASSWORD_FILE is empty' }
    if ((st.mode & 0o077) !== 0) {
      return {
        ok: false,
        error:
          'RESTIC_PASSWORD_FILE is too permissive — it must not be readable by group or ' +
          `others. Fix with: chmod 600 ${spec.passwordFile}`,
      }
    }
    env.RESTIC_PASSWORD_FILE = spec.passwordFile
  }
  if (spec.passwordCommand) env.RESTIC_PASSWORD_COMMAND = spec.passwordCommand
  return { ok: true, env }
}

export interface ResticBinary {
  bin: string
  version: string
}

/** Locate the restic binary (explicit override → RESTIC_BIN → PATH) and verify its version. */
export async function resolveResticBinary(opts: { resticBin?: string } = {}): Promise<ResticBinary> {
  const bin = opts.resticBin ?? process.env.RESTIC_BIN ?? 'restic'
  let stdout: string
  try {
    stdout = await runProcess(bin, ['version'], { env: minimalProcessEnv() })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(
      `restic binary not usable at "${bin}" (${detail}). Restic is a host dependency — ` +
        `install the official release (tested: ${RESTIC_TESTED_VERSION}) and point ` +
        'RESTIC_BIN at it if it is not on PATH.',
    )
  }
  const version = parseResticVersion(stdout)
  if (!version) {
    throw new Error(`could not parse a restic version from "${bin}" output: ${stdout.slice(0, 120)}`)
  }
  if (!versionAtLeast(version, RESTIC_MIN_VERSION)) {
    throw new Error(
      `restic ${version} is below the documented minimum ${RESTIC_MIN_VERSION} ` +
        `(tested version: ${RESTIC_TESTED_VERSION}) — refusing to proceed`,
    )
  }
  return { bin, version }
}

function minimalProcessEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
  }
}

interface RunOpts {
  env: Record<string, string>
  timeoutMs?: number
}

function runProcess(bin: string, args: string[], opts: RunOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        env: opts.env,
        timeout: opts.timeoutMs ?? RESTIC_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(redactRepositoryUrl(`${stderr || stdout || err.message}`).trim())
          e.name = 'ResticCommandError'
          const code = (err as NodeJS.ErrnoException).code
          if (code !== undefined) (e as Error & { exitCode?: unknown }).exitCode = code
          reject(e)
          return
        }
        resolve(redactRepositoryUrl(stdout))
      },
    )
  })
}

// ─── Restic operations ─────────────────────────────────────────────────────────

export interface ResticSnapshotInfo {
  id: string
  time: string
  tags: string[]
}

/**
 * The seam between the backup toolkit and the repository engine. The operator
 * CLIs construct the real CLI adapter (createResticAdapter); unit tests inject
 * a deterministic fake with the same interface.
 */
export interface ResticAdapter {
  readonly version: string
  /** Local filesystem path of the repository, when it is a local directory (informational). */
  readonly repositoryDir?: string
  /** True when the repository is already initialized (has a config). */
  repoInitialized(): Promise<boolean>
  /** Explicit repository initialization — refuses when already initialized. */
  initRepository(): Promise<void>
  /** Snapshot one staged directory. Returns the new snapshot id. */
  backupDirectory(stageDir: string, tags: string[]): Promise<{ snapshotId: string }>
  /** Repository integrity check (optionally reading all data). */
  check(readData: boolean): Promise<void>
  /** Restore a snapshot into a target directory (target handled by caller). */
  restoreSnapshot(snapshotId: string, targetDir: string): Promise<void>
  /** List snapshots (id, time, tags). */
  listSnapshots(): Promise<ResticSnapshotInfo[]>
}

export class ResticRepositoryAlreadyInitialized extends Error {}

/** Local directory of a restic location spec (null for remote backends). */
function localRepoPath(repository: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(repository)) return null // rest:, s3:, rclone:, b2:, …
  return repository
}

/** Real CLI-backed adapter. Constructed by the operator CLIs; tests inject fakes. */
export function createResticAdapter(spec: ResticConnectionSpec, binary: ResticBinary): ResticAdapter {
  async function run(args: string[], opts?: { timeoutMs?: number }): Promise<string> {
    const env = await resolveResticEnv(spec)
    if (!env.ok) throw new Error(env.error)
    return runProcess(binary.bin, args, { env: env.env, timeoutMs: opts?.timeoutMs })
  }

  async function snapshotsJson(): Promise<ResticSnapshotInfo[]> {
    const out = await run(['snapshots', '--json'])
    try {
      const parsed = JSON.parse(out) as Array<{ id?: string; short_id?: string; time?: string; tags?: string[] }>
      return parsed.map((s) => ({
        id: s.id ?? s.short_id ?? '',
        time: s.time ?? '',
        tags: Array.isArray(s.tags) ? s.tags : [],
      }))
    } catch {
      throw new Error('could not parse `restic snapshots --json` output')
    }
  }

  return {
    version: binary.version,
    repositoryDir: localRepoPath(spec.repository) ?? undefined,

    async repoInitialized(): Promise<boolean> {
      try {
        await snapshotsJson()
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/unable to open config file|Is there a repository at|config file/i.test(msg)) {
          return false
        }
        // Wrong password etc. must NOT be reported as "not initialized".
        throw err
      }
    },

    async initRepository(): Promise<void> {
      try {
        await run(['init'])
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (/already initialized|config file already exists/i.test(msg)) {
          throw new ResticRepositoryAlreadyInitialized(
            'repository is already initialized — refusing to reinitialize (silent ' +
              'reinitialization would orphan every existing snapshot)',
          )
        }
        throw err
      }
    },

    async backupDirectory(stageDir: string, tags: string[]): Promise<{ snapshotId: string }> {
      const args = ['backup', stageDir]
      for (const tag of tags) args.push('--tag', tag)
      const out = await run(args)
      const m = /snapshot\s+([0-9a-f]+)\s+saved/i.exec(out)
      if (!m) {
        throw new Error(`restic backup did not report a saved snapshot id. Output: ${out.slice(-400)}`)
      }
      return { snapshotId: m[1] }
    },

    async check(readData: boolean): Promise<void> {
      const args = readData ? ['check', '--read-data'] : ['check']
      await run(args, { timeoutMs: 30 * 60_000 })
    },

    async restoreSnapshot(snapshotId: string, targetDir: string): Promise<void> {
      await run(['restore', snapshotId, '--target', targetDir], { timeoutMs: 30 * 60_000 })
    },

    listSnapshots: snapshotsJson,
  }
}

/**
 * Run an explicit restic MAINTENANCE command (forget / prune). Exposed only for
 * the retention CLI — the backup and restore flows must never delete snapshots.
 * The caller owns every safety gate; this helper owns only the process surface.
 */
export async function runResticMaintenanceCommand(
  spec: ResticConnectionSpec,
  binary: ResticBinary,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const env = await resolveResticEnv(spec)
  if (!env.ok) throw new Error(env.error)
  return runProcess(binary.bin, args, { env: env.env, timeoutMs: opts.timeoutMs })
}

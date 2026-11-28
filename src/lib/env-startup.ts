// ─── OPS-1D: central startup environment validation ──────────────────────────
// Validates ONLY the genuine core-startup configuration. Everything else stays
// optional by design and degrades honestly at its own feature boundary — it is
// deliberately NOT moved into boot:
//   • Google OAuth   → unconfigured sign-in returns an honest 503 (never fake).
//   • LiveKit        → live classrooms show an honest "not configured" state.
//   • OCR binaries   → scanned PDFs degrade to NEEDS_OCR (documented).
//   • Legal publication variables → separate from core startup entirely; they
//     gate PUBLIC release (scripts/legal-release-check.mjs), never internal
//     staging, and are never required merely to run the app.
//
// Message discipline (security requirement):
//   • Problems name the variable and the expected SHAPE, never the VALUE.
//   • No environment values, secrets or resolved paths are ever echoed here.

export interface StartupEnvironmentReport {
  /** True when every genuine core-startup requirement is satisfied. */
  ok: boolean
  /** Operator-facing problems. Variable names only — never values. */
  problems: string[]
}

/** SQLite is the supported deployment database (docs/DECISIONS.md — ADR-004
 *  and the single-writer design contract). Prisma SQLite URLs look like
 *  `file:./db/custom.db` or an absolute `file:/app/db/custom.db`. */
const SQLITE_URL_SCHEME = /^file:/i

export function validateStartupEnvironment(
  env: Record<string, string | undefined> = process.env,
): StartupEnvironmentReport {
  const problems: string[] = []

  const databaseUrl = env.DATABASE_URL
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    problems.push(
      'DATABASE_URL is required but not set (expected a SQLite file URL, e.g. "file:./db/custom.db").',
    )
  } else if (!SQLITE_URL_SCHEME.test(databaseUrl.trim())) {
    problems.push(
      'DATABASE_URL must be a SQLite file URL starting with "file:" — this deployment targets SQLite (see docs/DECISIONS.md).',
    )
  }

  return { ok: problems.length === 0, problems }
}

/** Operator-facing error for a failed boot-time validation. Values are never
 *  included — only the variable names and expected shapes from the report. */
export function startupEnvironmentErrorMessage(report: StartupEnvironmentReport): string {
  return `BEAN startup environment is invalid — fix before starting: ${report.problems.join(' ')}`
}

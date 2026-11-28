// ─── OPS-1D: central startup environment validation ───────────────────────────
// Coverage:
//   E1  missing DATABASE_URL → not ok, operator-facing problem
//   E2  empty DATABASE_URL → not ok
//   E3  non-SQLite scheme → not ok, message names SQLite/file: (the value is
//       never echoed — assertion proves the secret-bearing value cannot leak)
//   E4  valid SQLite URLs (relative + absolute) → ok, no problems
//   E5  messages never contain environment values (name + shape only)
//   E6  OAuth/LiveKit/OCR/legal variables are NOT required at boot (staying
//       absent keeps the report ok — they degrade honestly at their features)

import { describe, it, expect } from 'bun:test'
import { validateStartupEnvironment, startupEnvironmentErrorMessage } from '@/lib/env-startup'

describe('OPS-1D validateStartupEnvironment', () => {
  it('E1: missing DATABASE_URL → not ok with a clear operator-facing problem', () => {
    const report = validateStartupEnvironment({})
    expect(report.ok).toBe(false)
    expect(report.problems).toHaveLength(1)
    expect(report.problems[0]).toContain('DATABASE_URL')
    expect(report.problems[0]).toContain('required')
    expect(report.problems[0]).toContain('file:')
  })

  it('E2: empty DATABASE_URL → not ok', () => {
    expect(validateStartupEnvironment({ DATABASE_URL: '' }).ok).toBe(false)
    expect(validateStartupEnvironment({ DATABASE_URL: '   ' }).ok).toBe(false)
  })

  it('E3: a non-SQLite URL fails and its value is never echoed', () => {
    const secretBearing = 'postgresql://admin:s3cret@db.internal.example:5432/bean'
    const report = validateStartupEnvironment({ DATABASE_URL: secretBearing })
    expect(report.ok).toBe(false)
    expect(report.problems[0]).toContain('SQLite')
    expect(report.problems[0]).toContain('file:')
    const message = startupEnvironmentErrorMessage(report)
    expect(message).toContain('DATABASE_URL')
    // The connection string (including its credentials) must never appear.
    expect(message).not.toContain(secretBearing)
    expect(message).not.toContain('s3cret')
    expect(message).not.toContain('postgresql')
  })

  it('E4: valid SQLite file URLs pass (relative and absolute)', () => {
    expect(validateStartupEnvironment({ DATABASE_URL: 'file:./db/custom.db' }).ok).toBe(true)
    expect(validateStartupEnvironment({ DATABASE_URL: 'file:/app/db/custom.db' }).ok).toBe(true)
    expect(validateStartupEnvironment({ DATABASE_URL: 'file:./db/custom.db' }).problems).toEqual([])
  })

  it('E5: the operator message names the variable and shape, never the value', () => {
    const value = 'file:/host/only/operator/knows/this-path.db'
    const report = validateStartupEnvironment({ DATABASE_URL: value })
    expect(report.ok).toBe(true)
    const message = startupEnvironmentErrorMessage(report)
    expect(message).not.toContain(value)
  })

  it('E6: optional feature configuration stays optional at boot', () => {
    const env: Record<string, string> = {
      DATABASE_URL: 'file:./db/custom.db',
      // deliberately absent: GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI,
      // LIVEKIT_*, TESSERACT_BIN/POPPLER_BIN/TESSDATA_PREFIX,
      // BEAN_LEGAL_* / BEAN_GRIEVANCE_* / BEAN_PRIVACY_* / BEAN_CONSUMER_*
    }
    const report = validateStartupEnvironment(env)
    expect(report.ok).toBe(true)
    expect(report.problems).toEqual([])
  })

  it('E7: the operator-facing error prefixes a clear failure banner', () => {
    const message = startupEnvironmentErrorMessage(validateStartupEnvironment({}))
    expect(message.startsWith('BEAN startup environment is invalid')).toBe(true)
    expect(message).toContain('fix before starting')
  })
})

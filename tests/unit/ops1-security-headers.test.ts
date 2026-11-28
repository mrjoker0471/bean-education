// ─── OPS-1C: conservative security-header baseline (next.config) ──────────────
// Production-response verification: the header list shipped by next.config is
// asserted here against the compatibility requirements —
//   S1  nosniff + frame restriction + referrer policy on EVERY route
//   S2  Permissions-Policy preserves LiveKit camera/microphone/screen-share
//       and PDF-viewer fullscreen, denies geolocation/payment/usb
//   S3  no HSTS by default (plain-HTTP localhost dev is never touched)
//   S4  HSTS sent only under the explicit operator HTTPS flag
//   S5  no CSP introduced (deferred until the actual script/worker/connect/
//       media source audit — a guessed CSP could break OAuth/PDF/LiveKit)
// The CI "Production build" step proves the config parses and applies.

import { describe, it, expect } from 'bun:test'
import type { NextConfig } from 'next'

const config = (await import('../../next.config')).default as NextConfig & {
  headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>>
}

const headerValue = (rules: Array<{ source: string; headers: Array<{ key: string; value: string }> }>, key: string): string | undefined =>
  rules[0]?.headers.find((h) => h.key === key)?.value

describe('OPS-1C security headers', () => {
  it('S1: applies the baseline to every route (single catch-all source)', async () => {
    const rules = await config.headers()
    expect(rules).toHaveLength(1)
    expect(rules[0].source).toBe('/:path*')
    expect(headerValue(rules, 'X-Content-Type-Options')).toBe('nosniff')
    expect(headerValue(rules, 'X-Frame-Options')).toBe('DENY')
    expect(headerValue(rules, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin')
  })

  it('S2: Permissions-Policy preserves LiveKit camera/mic/screen-share and PDF fullscreen', async () => {
    const rules = await config.headers()
    const pp = headerValue(rules, 'Permissions-Policy') ?? ''
    expect(pp).toContain('camera=(self)')
    expect(pp).toContain('microphone=(self)')
    expect(pp).toContain('display-capture=(self)')
    expect(pp).toContain('fullscreen=(self)')
    expect(pp).toContain('geolocation=()')
    expect(pp).toContain('payment=()')
    expect(pp).toContain('usb=()')
  })

  it('S3: no HSTS by default — plain-HTTP development is never sent HSTS', async () => {
    delete process.env.BEAN_ENABLE_HSTS
    const rules = await config.headers()
    expect(rules[0].headers.find((h) => h.key === 'Strict-Transport-Security')).toBeUndefined()
  })

  it('S4: HSTS is emitted only under the explicit operator HTTPS flag', async () => {
    process.env.BEAN_ENABLE_HSTS = 'true'
    try {
      const rules = await config.headers()
      const hsts = headerValue(rules, 'Strict-Transport-Security')
      expect(hsts).toBeDefined()
      expect(hsts).toContain('max-age=')
    } finally {
      delete process.env.BEAN_ENABLE_HSTS
    }
    const rules = await config.headers()
    expect(rules[0].headers.find((h) => h.key === 'Strict-Transport-Security')).toBeUndefined()
  })

  it('S5: no Content-Security-Policy is introduced (deferred pending source audit)', async () => {
    const rules = await config.headers()
    expect(rules[0].headers.find((h) => h.key === 'Content-Security-Policy')).toBeUndefined()
    expect(rules[0].headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')).toBeUndefined()
  })
})

// ─── url-guard tests (Phase 3A) — SSRF defences, NO real network ──────────────
import { describe, expect, test } from 'bun:test'
import {
  assertPublicHttpUrl,
  isPrivateIPv4,
  isPrivateIPv6,
  isBlockedIPLiteral,
  guardedFetch,
  htmlToText,
} from '@/lib/riishe/url-guard'

describe('isPrivateIPv4', () => {
  test('blocks loopback, RFC1918, link-local, metadata, CGNAT, multicast, reserved', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '192.0.2.1', '198.51.100.7', '203.0.113.9']) {
      expect(isPrivateIPv4(ip)).toBe(true)
    }
  })
  test('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '198.52.100.1', '203.1.113.9']) {
      expect(isPrivateIPv4(ip)).toBe(false)
    }
  })
  test('rejects malformed quads', () => {
    expect(isPrivateIPv4('999.1.1.1')).toBe(true)
    expect(isPrivateIPv4('not-an-ip')).toBe(true)
  })
})

describe('isPrivateIPv6 / isBlockedIPLiteral', () => {
  test('blocks loopback, ULA, link-local, mapped v4 private, multicast, docs', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', 'ff02::1', '2001:db8::1']) {
      expect(isPrivateIPv6(ip)).toBe(true)
    }
  })
  test('allows public v6 and public mapped v4', () => {
    expect(isPrivateIPv6('2606:4700::1')).toBe(false)
    expect(isPrivateIPv6('::ffff:8.8.8.8')).toBe(false)
  })
  test('ip-literal host check', () => {
    expect(isBlockedIPLiteral('127.0.0.1')).toBe(true)
    expect(isBlockedIPLiteral('8.8.8.8')).toBe(false)
    expect(isBlockedIPLiteral('example.com')).toBe(false)
  })
})

describe('assertPublicHttpUrl', () => {
  test('allows https/http public hosts', () => {
    expect(assertPublicHttpUrl('https://upsc.gov.in/paper.pdf').hostname).toBe('upsc.gov.in')
    expect(assertPublicHttpUrl('http://example.com/a?b=1').protocol).toBe('http:')
  })
  test('blocks non-http schemes (file:, data:, ftp:, javascript:)', () => {
    for (const raw of ['file:///etc/passwd', 'data:text/html,x', 'ftp://example.com/x', 'javascript:alert(1)', 'gopher://x']) {
      expect(() => assertPublicHttpUrl(raw)).toThrow(/blocked scheme|invalid URL/)
    }
  })
  test('blocks localhost variants and metadata hostnames', () => {
    for (const raw of ['http://localhost/x', 'http://LOCALHOST:8080/x', 'http://metadata.google.internal/computeMetadata/v1/', 'http://metadata/', 'http://service.internal/x', 'http://printer.local/x']) {
      expect(() => assertPublicHttpUrl(raw)).toThrow(/blocked host/)
    }
  })
  test('blocks private/reserved IP literals as hosts', () => {
    for (const raw of ['http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/x', 'http://192.168.1.10/x']) {
      expect(() => assertPublicHttpUrl(raw)).toThrow(/blocked IP host/)
    }
    expect(() => assertPublicHttpUrl('http://8.8.8.8/x')).not.toThrow()
  })
  test('blocks credentials in URL and unparseable input', () => {
    expect(() => assertPublicHttpUrl('https://user:pass@example.com/')).toThrow(/credentials/)
    expect(() => assertPublicHttpUrl('not a url at all')).toThrow()
  })
})

// Minimal Response shim for the injected fetch
function jsonResponse(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const headers = new Headers(init.headers ?? { 'content-type': 'text/html' })
  const status = init.status ?? 200
  return new Response(body, { status, headers }) as unknown as Response
}

describe('guardedFetch', () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

  test('fetches an allowed page and returns normalised text', async () => {
    const fetchImpl = (async () => jsonResponse('<html><body><p>hello research world</p></body></html>')) as unknown as typeof fetch
    const res = await guardedFetch('https://example.com/page', { fetchImpl, lookup: publicLookup })
    expect(res.status).toBe(200)
    expect(res.finalUrl).toBe('https://example.com/page')
    expect(res.body).toContain('hello research world')
  })

  test('blocks DNS that resolves to private space', async () => {
    const privateLookup = async () => [{ address: '10.0.0.9', family: 4 }]
    await expect(guardedFetch('https://evil.example.com/x', { fetchImpl: (async () => jsonResponse('x')) as unknown as typeof fetch, lookup: privateLookup })).rejects.toThrow(/private\/reserved/)
  })

  test('follows validated redirects and blocks redirects to private space', async () => {
    let call = 0
    const goodFetch = (async () => {
      call++
      if (call === 1) return jsonResponse('', { status: 302, headers: { location: 'https://final.example.com/doc' } })
      return jsonResponse('final content')
    }) as unknown as typeof fetch
    const res = await guardedFetch('https://start.example.com/a', { fetchImpl: goodFetch, lookup: publicLookup })
    expect(res.finalUrl).toBe('https://final.example.com/doc')
    expect(res.hops.length).toBe(2)

    const badFetch = (async () => jsonResponse('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })) as unknown as typeof fetch
    await expect(guardedFetch('https://start.example.com/a', { fetchImpl: badFetch, lookup: publicLookup })).rejects.toThrow(/blocked IP host/)
  })

  test('blocks redirect loops beyond the cap', async () => {
    const loopFetch = (async () => jsonResponse('', { status: 302, headers: { location: 'https://loop.example.com/again' } })) as unknown as typeof fetch
    await expect(guardedFetch('https://loop.example.com/start', { fetchImpl: loopFetch, lookup: publicLookup })).rejects.toThrow(/too many redirects/)
  })

  test('enforces content-type policy', async () => {
    const exeFetch = (async () => jsonResponse('MZ...', { headers: { 'content-type': 'application/octet-stream' } })) as unknown as typeof fetch
    await expect(guardedFetch('https://example.com/file', { fetchImpl: exeFetch, lookup: publicLookup })).rejects.toThrow(/blocked content-type/)
  })

  test('enforces the declared size cap for text', async () => {
    const bigFetch = (async () => jsonResponse('x', { headers: { 'content-type': 'text/plain', 'content-length': String(600 * 1024) } })) as unknown as typeof fetch
    await expect(guardedFetch('https://example.com/big', { fetchImpl: bigFetch, lookup: publicLookup })).rejects.toThrow(/too large/)
  })

  test('non-OK statuses are honest failures', async () => {
    const notFound = (async () => jsonResponse('nope', { status: 404 })) as unknown as typeof fetch
    await expect(guardedFetch('https://example.com/missing', { fetchImpl: notFound, lookup: publicLookup })).rejects.toThrow(/HTTP 404/)
  })
})

describe('htmlToText', () => {
  test('strips tags, scripts and styles, collapses whitespace, unescapes entities', () => {
    const html = `<html><head><style>body{color:red}</style></head><body><script>evil()</script><h1>Title</h1><p>Line&nbsp;one &amp; two &lt;tag&gt;</p></body></html>`
    const text = htmlToText(html)
    expect(text).not.toContain('evil')
    expect(text).not.toContain('color:red')
    expect(text).toContain('Title')
    expect(text).toContain('Line one & two <tag>')
  })
})

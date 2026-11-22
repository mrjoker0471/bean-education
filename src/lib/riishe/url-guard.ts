// ─── SSRF-guarded URL fetch (Phase 3A Deep Research) ─────────────────────────
// The ONLY sanctioned way for Riishe research to retrieve an external URL.
// Layered defences, in order:
//   1. Scheme allow-list (http/https only — no file:, gopher:, data:, …)
//   2. Hostname deny-list (localhost variants, .local/.internal, cloud
//      metadata endpoints) and IP-literal rejection of private/reserved space
//   3. DNS resolution check — EVERY resolved A/AAAA record must be public
//      (catches hostnames that point at internal space)
//   4. Redirect policy: fetch uses redirect:'manual'; each hop (≤3) is
//      re-validated (scheme + host + fresh DNS) before following
//   5. Response policy: content-type allow-list, hard byte cap, timeout
//
// Honest limitation (documented in docs/PHASE3A_SECURITY.md): classic
// DNS-rebinding (TOCTOU between our resolve and the transport's own resolve)
// is mitigated but not eliminated — we resolve and validate first, and the
// transport re-resolves independently. Fully closing that gap requires a
// custom socket agent; this layer keeps the practical attack surface
// (localhost, RFC1918, link-local, metadata endpoints, IP literals, open
// redirects) closed.
import dns from 'node:dns'
import net from 'node:net'

export const FETCH_TIMEOUT_MS = 15_000
export const MAX_FETCH_BYTES = 512 * 1024 // 512 KB of text evidence is plenty
export const MAX_PDF_FETCH_BYTES = 8 * 1024 * 1024 // PDFs are fetched for official sources only
export const MAX_REDIRECTS = 3

const ALLOWED_TEXT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain']
const ALLOWED_PDF_TYPES = ['application/pdf']

export type FetchBodyKind = 'text' | 'pdf'

export interface GuardedFetchResult {
  finalUrl: string
  status: number
  contentType: string
  body: string // text bodies decoded; pdf bodies returned as base64 in bodyBase64
  bodyBase64?: string
  truncated: boolean
  hops: string[] // every URL visited (for provenance)
}

// ── IP classification (pure) ─────────────────────────────────────────────────

/** True when an IPv4 address is private, reserved, link-local or loopback. */
export function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return true // not a valid dotted quad → treat as unsafe
  const o = m.slice(1).map(Number)
  if (o.some(n => n > 255)) return true
  const [a, b] = o
  if (a === 0) return true // 0.0.0.0/8 "this network"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 192 && b === 0) return true // 192.0.0/24 + 192.0.2/24 TEST-NET
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51) return true // TEST-NET-2
  if (a === 203 && b === 0) return true // TEST-NET-3
  if (a >= 224) return true // multicast + reserved + broadcast
  return false
}

/** True when an IPv6 address is loopback, ULA, link-local or v4-mapped private. */
export function isPrivateIPv6(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase().replace(/^\[|\]$/g, '')
  // v4-mapped/embedded (::ffff:10.0.0.1) — check the embedded v4 part
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  if (ip === '::' || ip === '::1') return true // unspecified + loopback
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]?:/.test(ip) || ip.startsWith('fe80:')) return true // fe80::/10 link-local
  if (ip.startsWith('2001:db8:')) return true // documentation range
  if (/^ff/.test(ip)) return true // multicast
  return false
}

/** True when the string is an IP literal that must not be fetched. */
export function isBlockedIPLiteral(host: string): boolean {
  if (net.isIPv4(host)) return isPrivateIPv4(host)
  if (net.isIPv6(host)) return isPrivateIPv6(host)
  return false
}

const BLOCKED_HOSTNAME_RE = /^(localhost|.*\.local|.*\.localhost|.*\.internal|.*\.home\.arpa|metadata\.google\.internal|metadata)$/i

/**
 * Validate a URL for fetching. Throws a descriptive Error on any violation.
 * Pure (no DNS) — the DNS layer is `assertResolvablePublicHost`.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`blocked scheme: ${url.protocol}`)
  }
  // URL keeps brackets on IPv6 literals — strip before classification.
  const bareHost = url.hostname.replace(/^\[|\]$/g, '')
  if (!bareHost) throw new Error('empty host')
  if (BLOCKED_HOSTNAME_RE.test(bareHost)) throw new Error(`blocked host: ${bareHost}`)
  if (isBlockedIPLiteral(bareHost)) throw new Error(`blocked IP host: ${bareHost}`)
  if (url.username || url.password) throw new Error('credentials in URL are not allowed')
  return url
}

/** Resolve every A/AAAA record of the host and require ALL of them public. */
export async function assertResolvablePublicHost(
  url: URL,
  lookup: (host: string) => Promise<{ address: string; family: number }[]> = defaultLookup,
): Promise<void> {
  const host = url.hostname
  if (net.isIP(host)) {
    // literal already validated by assertPublicHttpUrl
    return
  }
  const records = await lookup(host)
  if (!records.length) throw new Error(`host does not resolve: ${host}`)
  for (const r of records) {
    if (r.family === 6 ? isPrivateIPv6(r.address) : isPrivateIPv4(r.address)) {
      throw new Error(`host resolves to a private/reserved address (${r.address})`)
    }
  }
}

function defaultLookup(host: string): Promise<{ address: string; family: number }[]> {
  return dns.promises.lookup(host, { all: true }) as unknown as Promise<{ address: string; family: number }[]>
}

function contentTypeAllowed(contentType: string, kind: FetchBodyKind): boolean {
  const ct = contentType.split(';')[0].trim().toLowerCase()
  return kind === 'pdf' ? ALLOWED_PDF_TYPES.includes(ct) : ALLOWED_TEXT_TYPES.includes(ct)
}

/** Size-capped reader — stops pulling bytes once the cap is hit. */
async function readCapped(res: Response, cap: number): Promise<{ body: string; truncated: boolean; base64?: string }> {
  const reader = res.body?.getReader()
  if (!reader) return { body: '', truncated: false }
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > cap) {
        truncated = true
        void reader.cancel().catch(() => {})
        break
      }
      chunks.push(value)
    }
  }
  const merged = Buffer.concat(chunks.map(c => Buffer.from(c)))
  return { body: merged.toString('utf8'), truncated, base64: merged.toString('base64') }
}

/**
 * The guarded fetch. Validates every hop, enforces content-type/size/timeout
 * policy, and returns a normalised result. Network injectable for tests.
 */
export async function guardedFetch(
  rawUrl: string,
  opts: {
    kind?: FetchBodyKind
    fetchImpl?: typeof fetch
    lookup?: (host: string) => Promise<{ address: string; family: number }[]>
  } = {},
): Promise<GuardedFetchResult> {
  const kind = opts.kind ?? 'text'
  const doFetch = opts.fetchImpl ?? fetch
  const lookup = opts.lookup ?? defaultLookup
  const hops: string[] = []
  let current = assertPublicHttpUrl(rawUrl)
  hops.push(current.toString())

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertResolvablePublicHost(current, lookup)
    let res: Response
    try {
      res = await doFetch(current.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'BEAN-Education-Research/1.0 (+evidence retrieval; no JS, no cookies)' },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(/timeout|abort/i.test(msg) ? 'source fetch timed out' : `source fetch failed: ${msg.slice(0, 120)}`)
    }

    // Redirect handling: validate every Location before following it.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new Error(`redirect without location (status ${res.status})`)
      if (hop === MAX_REDIRECTS) throw new Error(`too many redirects (>${MAX_REDIRECTS})`)
      const next = assertPublicHttpUrl(new URL(loc, current).toString())
      current = next
      hops.push(current.toString())
      continue
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok) throw new Error(`source returned HTTP ${res.status}`)
    if (!contentTypeAllowed(contentType, kind)) {
      throw new Error(`blocked content-type: ${contentType.split(';')[0].trim() || 'unknown'}`)
    }
    const declared = Number(res.headers.get('content-length') ?? 0)
    const cap = kind === 'pdf' ? MAX_PDF_FETCH_BYTES : MAX_FETCH_BYTES
    if (declared > cap) throw new Error(`source too large (content-length ${declared})`)
    const { body, truncated, base64 } = await readCapped(res, cap)
    if (truncated && kind === 'pdf') throw new Error(`source PDF too large (>${MAX_PDF_FETCH_BYTES} bytes)`)
    return {
      finalUrl: current.toString(),
      status: res.status,
      contentType,
      body: kind === 'pdf' ? '' : body,
      bodyBase64: kind === 'pdf' ? base64 : undefined,
      truncated,
      hops,
    }
  }
  throw new Error('unreachable') // loop always returns or throws
}

/** Strip HTML to readable text (no network) — used before excerpting. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script/gi, ' ')
    .replace(/<style[\s\S]*?<\/style/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

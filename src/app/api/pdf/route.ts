import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
// Long enough for slow government CDNs; the stream itself is piped through.
export const maxDuration = 60

const UPSTREAM_TIMEOUT_MS = 30_000
const MAX_BYTES = 60 * 1024 * 1024 // hard cap — all registered documents are far below this

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function sanitizeFilename(title: string): string {
  const base = title
    .replace(/\(PDF[^)]*\)/gi, '')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return (base || 'document') + '.pdf'
}

/**
 * GET /api/pdf?url=...&download=1
 *
 * Same-origin, registry-whitelisted PDF streamer for the integrated viewer.
 *
 * Security model:
 *  - The `url` parameter must EXACTLY match a Resource row whose fileKind is
 *    'PDF'. There is no other resolution path — this can never become an open
 *    proxy/SSRF relay, and ordinary webpages can never be streamed as PDFs.
 *  - The upstream response's content-type must be a PDF; anything else is
 *    rejected (a webpage can never masquerade as a PDF through this route).
 *  - Range requests are forwarded so pdf.js can progressively load large
 *    documents without downloading them fully first.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  const download = req.nextUrl.searchParams.get('download')
  const wantAttachment = download === '1' || download === 'true'

  if (!url) return jsonError('Missing document URL', 400)

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return jsonError('Invalid document URL', 400)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return jsonError('Only http(s) document URLs are supported', 400)
  }

  // Registry whitelist — exact URL match against a registered PDF resource.
  const resource = await db.resource.findFirst({
    where: { url, fileKind: 'PDF' },
    select: { id: true, title: true },
  })
  if (!resource) {
    return jsonError('This document is not in the verified BEAN Education registry, so it cannot be opened in the reader.', 403)
  }

  const filename = sanitizeFilename(resource.title)
  const range = req.headers.get('range')

  const headers: Record<string, string> = {
    accept: 'application/pdf,*/*',
    'user-agent': 'BEANEDUCATION/1.0 (study-platform; document reader)',
  }
  if (range && !wantAttachment) headers['range'] = range

  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|abort/i.test(err.name + ' ' + err.message)
    console.error('[api/pdf] fetch failed:', url, err)
    return jsonError(
      timedOut
        ? 'The official server did not respond in time. It may be busy — try again, or open the original source.'
        : 'The document could not be fetched from the official source right now.',
      502
    )
  }

  if (!upstream.ok && upstream.status !== 206) {
    return jsonError(
      `The official source responded with HTTP ${upstream.status} for this document.`,
      upstream.status === 404 || upstream.status === 410 ? 404 : 502
    )
  }

  const contentType = upstream.headers.get('content-type') ?? ''
  const looksPdf = /application\/pdf|application\/octet-stream|application\/x-pdf/i.test(contentType) ||
    // Some CDNs omit content-type on 206 responses; allow those through —
    // the resource is already a verified PDF in the registry.
    (!contentType && upstream.status === 206)
  if (!looksPdf) {
    return jsonError(
      'The source did not return a PDF file for this link — it cannot be shown in the reader.',
      415
    )
  }

  // Guard the declared size when known (whole-file requests only).
  const declaredLength = Number(upstream.headers.get('content-length') ?? '0')
  if (declaredLength && !range && declaredLength > MAX_BYTES) {
    return jsonError('This document is too large to open in the reader.', 413)
  }

  const out = new Headers()
  out.set('content-type', 'application/pdf')
  if (upstream.headers.get('content-length')) out.set('content-length', upstream.headers.get('content-length')!)
  if (upstream.headers.get('content-range')) out.set('content-range', upstream.headers.get('content-range')!)
  if (upstream.headers.get('accept-ranges')) out.set('accept-ranges', upstream.headers.get('accept-ranges')!)
  if (upstream.headers.get('last-modified')) out.set('last-modified', upstream.headers.get('last-modified')!)
  if (upstream.headers.get('etag')) out.set('etag', upstream.headers.get('etag')!)
  out.set('cache-control', 'private, max-age=3600')
  out.set('content-disposition', `${wantAttachment ? 'attachment' : 'inline'}; filename="${filename}"`)
  out.set('x-content-type-options', 'nosniff')

  return new Response(upstream.body, { status: upstream.status, headers: out })
}

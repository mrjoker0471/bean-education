import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stat, open } from 'node:fs/promises'
import { Readable } from 'node:stream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// GET — stream the stored PDF to its OWNER only (same-origin, Range-capable so
// the integrated pdf.js reader can progressively load large files).
// This is the ONLY way an uploaded file ever leaves storage: ownership is
// checked on every request, files are never in /public, and the response is
// always application/pdf with nosniff.
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const url = new URL(req.url)
    const guestId = url.searchParams.get('guestId')
    if (!guestId) return NextResponse.json({ error: 'guestId required' }, { status: 400 })

    const doc = await db.studyDocument.findUnique({ where: { id } })
    if (!doc || doc.guestId !== guestId) {
      return NextResponse.json({ error: 'Material not found' }, { status: 404 })
    }

    let fileStat
    try {
      fileStat = await stat(doc.storedPath)
    } catch {
      return NextResponse.json({ error: 'The stored file is missing — please re-upload the document.' }, { status: 410 })
    }

    const download = url.searchParams.get('download') === '1'
    const total = fileStat.size
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${sanitizeName(doc.originalName || `${doc.title}.pdf`)}"`,
    }

    const range = req.headers.get('range')
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      if (m) {
        let start = m[1] === '' ? undefined : Number(m[1])
        let end = m[2] === '' ? undefined : Number(m[2])
        if (start === undefined && end !== undefined) {
          // suffix range: last N bytes
          start = Math.max(0, total - Number(end))
          end = total - 1
        }
        if (start === undefined || Number.isNaN(start)) start = 0
        if (end === undefined || Number.isNaN(end) || end >= total) end = total - 1
        if (start > end || start >= total) {
          return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
        }
        const chunk = await readSlice(doc.storedPath, start, end)
        return new NextResponse(new Uint8Array(chunk), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': String(end - start + 1),
          },
        })
      }
    }

    const chunk = await readSlice(doc.storedPath, 0, total - 1)
    return new NextResponse(new Uint8Array(chunk), {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(total) },
    })
  } catch (err) {
    console.error('[api/materials/[id]/file]', err)
    return NextResponse.json({ error: 'Failed to serve the file' }, { status: 500 })
  }
}

async function readSlice(path: string, start: number, end: number): Promise<Buffer> {
  const fh = await open(path, 'r')
  try {
    const len = end - start + 1
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, start)
    return buf
  } finally {
    await fh.close()
  }
}

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim()
  return (cleaned.endsWith('.pdf') ? cleaned : `${cleaned}.pdf`).slice(0, 120) || 'document.pdf'
}

// Buffer → BodyInit helper (Node stream not needed since we slice to memory;
// 15 MB cap keeps this safe)
void Readable

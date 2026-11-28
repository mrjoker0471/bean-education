// ─── OPS-2 amendment: restore PORTABILITY PROBE (child process) ────────────────
//
// This script is EXECUTED AS A SEPARATE `bun` PROCESS by the restore drill —
// never imported by it (its imports bind DATABASE_URL and Next runtime pieces
// that must belong to the child only). It proves the recovered data set is
// actually openable THROUGH THE APPLICATION'S REAL FILE-READING LOGIC:
//
//   • Documents: the actual `/api/materials/[id]/file` route handler is invoked
//     with a real NextRequest per restored StudyDocument row — ownership check,
//     stat(doc.storedPath), Range-capable byte read — and the served bytes must
//     hash to the row's recorded contentHash (the same integrity contract the
//     analysis pipeline enforces).
//   • Evidence: the app's actual `evidenceFilePath()` resolution (relative
//     storagePath resolved against <cwd>/db/evidence with the escape guard) is
//     used for every ACTIVE ExpertCredentialEvidence row, and the bytes must
//     hash to the DB-recorded sha256 at the recorded byteSize.
//
// Environment contract:
//   DATABASE_URL      file: URL of the ISOLATED restored/remapped database copy
//   BEAN_PROBE_MODE   "canonical" | "remap" (reporting only)
//   cwd               the app root whose db/uploads + db/evidence semantics
//                     should hold (canonical: the recorded-layout root;
//                     remap: the recovery app root)
//
// The probe is strictly read-only. It NEVER writes to the restored tree, the
// original fixture, or any live database. Output: one final line
// `BEAN_PROBE_RESULT: {json}` and exit 0 only when every check passed.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
// Real application logic under test (imported, never re-implemented):
import * as fileRoute from '@/app/api/materials/[id]/file/route'
import { evidenceFilePath } from '@/lib/ci/fleet/applications'

interface DocCheck {
  id: string
  storedPath: string
  fullStatus: number
  bytesOk: boolean
  hashOk: boolean
  rangeStatus: number
  rangeOk: boolean
  problems: string[]
}

interface EvidenceCheck {
  id: string
  storagePath: string
  resolvedPath: string
  sizeOk: boolean
  hashOk: boolean
  problems: string[]
}

export interface ProbeResult {
  ok: boolean
  mode: string
  documentsChecked: number
  evidenceChecked: number
  rangeChecks: number
  documents: DocCheck[]
  evidence: EvidenceCheck[]
  problems: string[]
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

async function checkDocument(doc: { id: string; guestId: string; storedPath: string; fileSize: number; contentHash: string }): Promise<DocCheck> {
  const check: DocCheck = {
    id: doc.id,
    storedPath: doc.storedPath,
    fullStatus: 0,
    bytesOk: false,
    hashOk: false,
    rangeStatus: 0,
    rangeOk: false,
    problems: [],
  }
  const url = `http://localhost/api/materials/${doc.id}/file?guestId=${encodeURIComponent(doc.guestId)}`
  const ctx = { params: Promise.resolve({ id: doc.id }) }

  // Full-body request through the real route handler.
  let bytes: Buffer
  try {
    const res = await fileRoute.GET(new NextRequest(url), ctx)
    check.fullStatus = res.status
    if (res.status !== 200) {
      check.problems.push(`route returned ${res.status} for the full-body request (410 means the stored path could not be opened)`)
      return check
    }
    const declared = Number(res.headers.get('content-length') ?? '-1')
    bytes = Buffer.from(await res.arrayBuffer())
    check.bytesOk = bytes.length === declared && bytes.length === doc.fileSize
    if (!check.bytesOk) {
      check.problems.push(`served ${bytes.length} bytes (declared ${declared}, DB fileSize ${doc.fileSize})`)
    }
    const served = sha256(bytes)
    check.hashOk = served === doc.contentHash
    if (!check.hashOk) {
      check.problems.push(`served bytes sha256 ${served.slice(0, 12)}… ≠ DB contentHash ${doc.contentHash.slice(0, 12)}…`)
    }
  } catch (err) {
    check.problems.push(`full-body request threw: ${err instanceof Error ? err.message : String(err)}`)
    return check
  }

  // Range request through the same real handler (the reader is Range-capable).
  try {
    const rangeRes = await fileRoute.GET(new NextRequest(url, { headers: { range: 'bytes=0-9' } }), ctx)
    check.rangeStatus = rangeRes.status
    if (rangeRes.status !== 206) {
      check.problems.push(`range request returned ${rangeRes.status}, expected 206`)
      return check
    }
    const slice = Buffer.from(await rangeRes.arrayBuffer())
    const cr = rangeRes.headers.get('content-range') ?? ''
    check.rangeOk =
      slice.length === 10 &&
      slice.equals(bytes.subarray(0, 10)) &&
      cr === `bytes 0-9/${doc.fileSize}`
    if (!check.rangeOk) {
      check.problems.push(`range slice/Content-Range mismatch (${cr})`)
    }
  } catch (err) {
    check.problems.push(`range request threw: ${err instanceof Error ? err.message : String(err)}`)
  }
  return check
}

async function checkEvidence(row: { id: string; storagePath: string; byteSize: number; sha256: string }): Promise<EvidenceCheck> {
  const check: EvidenceCheck = {
    id: row.id,
    storagePath: row.storagePath,
    resolvedPath: '',
    sizeOk: false,
    hashOk: false,
    problems: [],
  }
  try {
    // The app's REAL access logic — resolution + restricted-store escape guard.
    const resolved = evidenceFilePath(row.storagePath)
    check.resolvedPath = resolved
    const expectedRoot = path.resolve(process.cwd(), 'db', 'evidence')
    if (!resolved.startsWith(expectedRoot + path.sep)) {
      check.problems.push(`resolved path ${resolved} is outside the runtime evidence root ${expectedRoot}`)
      return check
    }
    const bytes = await readFile(resolved)
    check.sizeOk = bytes.length === row.byteSize
    if (!check.sizeOk) check.problems.push(`evidence bytes ${bytes.length} ≠ DB byteSize ${row.byteSize}`)
    const digest = sha256(bytes)
    check.hashOk = digest === row.sha256
    if (!check.hashOk) check.problems.push(`evidence sha256 ${digest.slice(0, 12)}… ≠ DB sha256 ${row.sha256.slice(0, 12)}…`)
  } catch (err) {
    check.problems.push(`evidence access through the app's resolution logic failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return check
}

async function main(): Promise<number> {
  const mode = process.env.BEAN_PROBE_MODE ?? 'unspecified'
  const result: ProbeResult = {
    ok: false,
    mode,
    documentsChecked: 0,
    evidenceChecked: 0,
    rangeChecks: 0,
    documents: [],
    evidence: [],
    problems: [],
  }

  try {
    const docs = await db.studyDocument.findMany({
      select: { id: true, guestId: true, storedPath: true, fileSize: true, contentHash: true },
      orderBy: { id: 'asc' },
    })
    for (const doc of docs) {
      const check = await checkDocument(doc)
      result.documents.push(check)
      if (check.problems.length === 0 && check.hashOk) result.documentsChecked += 1
      if (check.rangeOk) result.rangeChecks += 1
    }

    const evidenceRows = await db.expertCredentialEvidence.findMany({
      where: { retentionState: 'ACTIVE' },
      select: { id: true, storagePath: true, byteSize: true, sha256: true },
      orderBy: { id: 'asc' },
    })
    for (const row of evidenceRows) {
      const check = await checkEvidence(row)
      result.evidence.push(check)
      if (check.problems.length === 0 && check.hashOk) result.evidenceChecked += 1
    }

    result.ok =
      result.documentsChecked === docs.length &&
      result.evidenceChecked === evidenceRows.length &&
      result.rangeChecks === docs.length
    if (!result.ok) {
      for (const d of result.documents) for (const p of d.problems) result.problems.push(`document ${d.id}: ${p}`)
      for (const e of result.evidence) for (const p of e.problems) result.problems.push(`evidence ${e.id}: ${p}`)
      if (docs.length === 0) result.problems.push('no StudyDocument rows found in the restored database')
    }
  } catch (err) {
    result.problems.push(`probe setup failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await db.$disconnect().catch(() => undefined)
  }

  process.stdout.write(`BEAN_PROBE_RESULT: ${JSON.stringify(result)}\n`)
  return result.ok ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`[portability-probe] fatal: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  },
)

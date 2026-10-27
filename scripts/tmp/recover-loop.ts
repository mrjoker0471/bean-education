// Patient recovery loop: waits for the provider throttle window to clear, then
// retries the document analysis (partial for READY-partial, full for FAILED)
// until coverage is complete or rounds are exhausted. Honest at every step.
import { PrismaClient } from '@prisma/client'
import { processDocument } from '../../src/lib/riishe/pipeline'
const db = new PrismaClient()
const doc0 = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const id = doc0!.id

function cov(doc: { analysisJson: string | null } | null) {
  if (!doc?.analysisJson) return null
  try { return JSON.parse(doc.analysisJson).coverage ?? null } catch { return null }
}

for (let round = 1; round <= 12; round++) {
  const before = await db.studyDocument.findUnique({ where: { id } })
  const c = cov(before)
  const last = before!.statusDetail?.slice(0, 110) ?? ''
  console.log(`round ${round}: status=${before!.status} ok=${c?.unitsOk}/${c?.unitsTotal} failed=${c?.unitsFailed} skipped=${c?.unitsSkipped ?? 0} | ${last}`)
  if (c?.complete) { console.log('COMPLETE'); break }
  const t0 = Date.now()
  await processDocument(id) // partial for READY+incomplete; full for FAILED
  const after = await db.studyDocument.findUnique({ where: { id } })
  const c2 = cov(after)
  console.log(`  → ${Math.round((Date.now() - t0) / 1000)}s status=${after!.status} ok=${c2?.unitsOk}/${c2?.unitsTotal} failed=${c2?.unitsFailed} skipped=${c2?.unitsSkipped ?? 0}`)
  if (c2?.complete) { console.log('COMPLETE'); break }
  await new Promise(r => setTimeout(r, 120_000)) // 2 min between rounds
}
await db.$disconnect()

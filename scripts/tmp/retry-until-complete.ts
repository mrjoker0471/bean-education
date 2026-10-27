import { PrismaClient } from '@prisma/client'
import { processDocument } from '../../src/lib/riishe/pipeline'
const db = new PrismaClient()
const doc0 = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const id = doc0!.id
for (let round = 1; round <= 6; round++) {
  const before = await db.studyDocument.findUnique({ where: { id } })
  const cov = before!.analysisJson ? JSON.parse(before!.analysisJson).coverage : null
  console.log(`round ${round}: status=${before!.status} ok=${cov?.unitsOk}/${cov?.unitsTotal} failed=${cov?.unitsFailed} skipped=${cov?.unitsSkipped ?? 0}`)
  if (cov?.complete) { console.log('COMPLETE'); break }
  const t0 = Date.now()
  await processDocument(id) // no force → partial retry (keeps OK sections + carried skips)
  const after = await db.studyDocument.findUnique({ where: { id } })
  const cov2 = JSON.parse(after!.analysisJson!).coverage
  console.log(`  → ${Math.round((Date.now() - t0) / 1000)}s ok=${cov2.unitsOk}/${cov2.unitsTotal} failed=${cov2.unitsFailed} skipped=${cov2.unitsSkipped} complete=${cov2.complete}`)
  if (cov2.complete) { console.log('COMPLETE'); break }
  await new Promise(r => setTimeout(r, 30_000)) // breathe for the rate limiter
}
await db.$disconnect()

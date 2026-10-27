import { PrismaClient } from '@prisma/client'
import { processDocument } from '../../src/lib/riishe/pipeline'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
console.log('re-analysing (force):', doc!.id, doc!.title)
const t0 = Date.now()
await processDocument(doc!.id, { force: true })
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`)
const after = await db.studyDocument.findUnique({ where: { id: doc!.id } })
console.log('status:', after!.status)
console.log('statusDetail:', after!.statusDetail)
await db.$disconnect()

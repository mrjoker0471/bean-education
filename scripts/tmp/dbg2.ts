import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const d = await db.studyDocument.findFirst({ where: { guestId: 'e2e-retry-test-guest' } })
if (d) { const a = JSON.parse(d.analysisJson!); console.log('keys:', Object.keys(a)); console.log('outcomes:', a.sectionOutcomes?.length, 'parts:', a._parts?.length, 'coverage:', JSON.stringify(a.coverage)) }
await db.$disconnect()

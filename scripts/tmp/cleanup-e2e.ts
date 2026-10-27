import { PrismaClient } from '@prisma/client'
import { rmSync } from 'node:fs'
const db = new PrismaClient()
const GUEST = 'e2e-structure-test-guest'
const docs = await db.studyDocument.findMany({ where: { guestId: GUEST } })
for (const d of docs) { try { rmSync(d.storedPath) } catch {} }
await db.studyDocument.deleteMany({ where: { guestId: GUEST } })
console.log('cleaned', docs.length, 'e2e docs')
const left = await db.studyDocument.findMany()
for (const d of left) console.log('remaining:', d.id, d.status, d.title)
await db.$disconnect()

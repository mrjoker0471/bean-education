import { PrismaClient } from '@prisma/client'
import { rmSync } from 'node:fs'
const db = new PrismaClient()
const doc = await db.studyDocument.findUnique({ where: { id: 'cmvqd70vg0000t2c9zsnaij9b' } })
if (doc) { try { rmSync(doc.storedPath) } catch {} await db.studyDocument.delete({ where: { id: doc.id } }); console.log('removed synthetic doc') } else console.log('not found')
const left = await db.studyDocument.count()
console.log('docs left:', left)
await db.$disconnect()

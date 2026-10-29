import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findUnique({ where: { id: 'cmvt43wu7000nqf5b4swj43zs' } })
console.log('status:', doc?.status, '|', doc?.statusDetail?.slice(0, 120))
await db.$disconnect()

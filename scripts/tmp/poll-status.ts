import { PrismaClient } from '@prisma/client'
async function main() {
  const db = new PrismaClient()
  const doc = await db.studyDocument.findUnique({ where: { id: 'cmvq6rfxg0001t2vh9m6m4cu8' } })
  console.log('status:', doc?.status, '|', doc?.statusDetail)
  await db.$disconnect()
}
main()

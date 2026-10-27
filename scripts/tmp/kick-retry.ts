import { PrismaClient } from '@prisma/client'
async function main() {
  const db = new PrismaClient()
  const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
  if (!doc) { console.log('NO DOC'); return }
  console.log(JSON.stringify({ id: doc.id, guestId: doc.guestId, status: doc.status }))
  const res = await fetch(`http://localhost:3000/api/materials/${doc.id}/retry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guestId: doc.guestId, force: true }),
  })
  console.log('retry status:', res.status, await res.text())
  await db.$disconnect()
}
main()

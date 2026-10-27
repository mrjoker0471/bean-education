import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
// 1. partial retry on a COMPLETE doc → 409 honest refusal
const r1 = await fetch(`http://localhost:3000/api/materials/${doc!.id}/retry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ guestId: doc!.guestId }),
})
console.log('partial retry on complete doc:', r1.status, (await r1.text()).slice(0, 100))
// 2. stranger access → 404
const r2 = await fetch(`http://localhost:3000/api/materials/${doc!.id}?guestId=stranger-guest-0001`)
console.log('stranger GET material:', r2.status)
// 3. re-analysis idempotency: processDocument without force on READY is a no-op (verified in e2e); here confirm retry with force on READY is allowed
const r3 = await fetch(`http://localhost:3000/api/materials/${doc!.id}/retry`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ guestId: doc!.guestId, force: true }),
})
console.log('force re-analyse accepted:', r3.status, (await r3.text()).slice(0, 80))
await db.$disconnect()

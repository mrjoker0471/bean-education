import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const docs = await db.studyDocument.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: { id: true, title: true, originalName: true, status: true, statusDetail: true, pageCount: true, guestId: true, createdAt: true }
});
console.log(JSON.stringify(docs, null, 2));
console.log({ docs: await db.studyDocument.count(), tests: await db.riisheTest.count(), questions: await db.riisheQuestion.count() });
await db.$disconnect();

import { PrismaClient } from '@prisma/client';
async function main() {
  const db = new PrismaClient();
  const docs = await db.studyDocument.findMany({
    select: { id: true, originalName: true, title: true, status: true, statusDetail: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log('DOC COUNT:', docs.length);
  for (const d of docs) {
    const full = await db.studyDocument.findUnique({ where: { id: d.id }, select: { analysisJson: true, extractionJson: true } });
    console.log('===', d.id, '|', d.originalName, '|', d.status, '|', (d.statusDetail||'').slice(0,80));
    console.log('extraction len:', full?.extractionJson?.length ?? 0, 'analysis len:', full?.analysisJson?.length ?? 0);
    if (full?.analysisJson) {
      const a = JSON.parse(full.analysisJson);
      console.log('analysis keys:', Object.keys(a).join(','));
      if (a.sections) {
        console.log('sections:', a.sections.length);
        for (const s of a.sections.slice(0, 20)) {
          console.log('  -', JSON.stringify({ title: s.title, number: s.number, level: s.level, source: s.sourceType || s.source, pages: s.pages || s.pageNumbers, topics: s.topics ? s.topics.length : 0 }));
        }
      }
      if (a.topics) {
        console.log('topics:', a.topics.length);
        for (const t of a.topics.slice(0, 20)) console.log('  *', JSON.stringify(t).slice(0, 220));
      }
    }
  }
  await db.$disconnect();
}
main();

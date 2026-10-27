import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } });
if (!doc) { console.log('no doc'); process.exit(0); }
const analysis = JSON.parse(doc.analysisJson || 'null');
console.log('=== ANALYSIS KEYS ===', Object.keys(analysis || {}));
console.log('=== TOPICS (' + analysis?.topics?.length + ') ===');
for (const t of analysis?.topics || []) {
  console.log(`- [${t.id}] "${t.title}" | level=${t.level} | parent=${t.parentId ?? '-'} | pages=${JSON.stringify(t.pageRefs ?? t.pages ?? '-')} | keywords=${(t.keywords||[]).slice(0,4).join(',')}`);
}
console.log('=== COVERAGE ===', JSON.stringify(analysis?.coverage ?? analysis?.coverageNote ?? '-', null, 2).slice(0, 1500));
console.log('=== SUMMARY ===', (analysis?.summary||'').slice(0, 800));
await db.$disconnect();

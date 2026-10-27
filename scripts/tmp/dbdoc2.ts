import { PrismaClient } from '@prisma/client';
async function main() {
  const db = new PrismaClient();
  const doc = await db.studyDocument.findUnique({ where: { id: 'cmvq6rfxg0001t2vh9m6m4cu8' } });
  if (!doc) { console.log('no doc'); return; }
  const a = JSON.parse(doc.analysisJson!);
  console.log('--- STRUCTURE ---');
  console.log(JSON.stringify(a.structure, null, 1).slice(0, 4000));
  console.log('--- COVERAGE ---');
  console.log(JSON.stringify(a.coverage, null, 1).slice(0, 2000));
  console.log('--- SECTION OUTCOMES (first 40) ---');
  if (a.sectionOutcomes) console.log(JSON.stringify(a.sectionOutcomes.slice(0, 40), null, 0).slice(0, 2500));
  console.log('--- ALL 117 TOPICS (name, level, parentId, pages) ---');
  for (const t of a.topics) {
    console.log(`${t.id} L${t.level} parent=${t.parentId} pages=[${(t.pages||[]).join(',')}] printed=[${(t.printedPages||[]).join(',')}] v=${t.pageVerified} :: ${t.name} :: subs=[${(t.subtopics||[]).join(' | ')}]`);
  }
  await db.$disconnect();
}
main();

import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  const counts = {
    exams: await db.exam.count(), stages: await db.stage.count(), subjects: await db.subject.count(),
    units: await db.unit.count(), topics: await db.topic.count(), notes: await db.note.count(),
    questions: await db.question.count(), resources: await db.resource.count(),
    templates: await db.testTemplate.count(), categories: await db.category.count(),
  }
  console.log('PASS2', JSON.stringify(counts))
  const dupTopics = await db.$queryRawUnsafe<{ c: number }>('SELECT COUNT(*) as c FROM (SELECT unitId, slug FROM Topic GROUP BY unitId, slug HAVING COUNT(*) > 1)')
  const dupExams = await db.$queryRawUnsafe<{ c: number }>('SELECT COUNT(*) as c FROM (SELECT slug FROM Exam GROUP BY slug HAVING COUNT(*) > 1)')
  const orphanQ = await db.$queryRawUnsafe<{ c: number }>('SELECT COUNT(*) as c FROM Question q LEFT JOIN Exam e ON q.examId = e.id WHERE e.id IS NULL')
  const dupRes = await db.$queryRawUnsafe<{ c: number }>('SELECT COUNT(*) as c FROM (SELECT id FROM Resource GROUP BY id HAVING COUNT(*) > 1)')
  const dupQ = await db.$queryRawUnsafe<{ c: number }>('SELECT COUNT(*) as c FROM (SELECT id FROM Question GROUP BY id HAVING COUNT(*) > 1)')
  console.log('INTEGRITY dupTopics=%d dupExams=%d dupQ=%d dupRes=%d orphanQ=%d',
    Number(dupTopics[0].c), Number(dupExams[0].c), Number(dupQ[0].c), Number(dupRes[0].c), Number(orphanQ[0].c))
  const g1 = await db.exam.findFirst({ where: { slug: 'tnpsc-group-1' }, include: { _count: { select: { questions: true, resources: true, templates: true } } } })
  console.log('TNPSC-G1 counts', JSON.stringify(g1?._count))
  const upsc = await db.exam.findFirst({ where: { slug: 'upsc-cse' }, include: { _count: { select: { questions: true, templates: true } } } })
  console.log('UPSC-CSE counts', JSON.stringify(upsc?._count))
  await db.$disconnect()
}
main()

// ─────────────────────────────────────────────────────────────────────────────
// BEAN EXAMS — Idempotent database seeder.
// Run: bun prisma/seed.ts   (safe to run repeatedly; upserts by stable ids)
// Deterministic ids guarantee duplicate-free reruns (verified by running twice).
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { EXAMS, CATEGORIES } from '../src/data/exams'
import { NOTES_GS } from '../src/data/notes-gs'
import { NOTES_APT } from '../src/data/notes-apt'
import { NOTES_CUET } from '../src/data/notes-cuet'
import { QUESTIONS } from '../src/data/questions'
import { QUESTIONS_CUET } from '../src/data/questions-cuet'
import { RESOURCES, EXAM_RESOURCES } from '../src/data/resources'
import { OFFICIAL_DOCS } from '../src/data/official-docs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const db = new PrismaClient()

const hash8 = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 10)

type Verification = Record<string, { status: string; code: number; checkedAt: string }>
const verification: Verification = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/data/resource-verification.json'), 'utf8')
)

async function main() {
  const noteLib = new Map<string, (typeof NOTES_GS)[number]>()
  for (const n of [...NOTES_GS, ...NOTES_APT, ...NOTES_CUET]) noteLib.set(n.canonical, n)
  const questionsByCanonical = new Map<string, (typeof QUESTIONS)[number][]>()
  for (const q of [...QUESTIONS, ...QUESTIONS_CUET]) {
    const list = questionsByCanonical.get(q.canonical) ?? []
    list.push(q)
    questionsByCanonical.set(q.canonical, list)
  }
  const resourcesByCanonical = new Map<string, (typeof RESOURCES)[number][]>()
  for (const r of [...RESOURCES, ...OFFICIAL_DOCS.filter(od => od.canonical)]) {
    if (!r.canonical) continue
    const list = resourcesByCanonical.get(r.canonical) ?? []
    list.push(r)
    resourcesByCanonical.set(r.canonical, list)
  }

  let stats = { categories: 0, exams: 0, stages: 0, subjects: 0, units: 0, topics: 0, notes: 0, questions: 0, resources: 0, templates: 0 }

  // 1. Categories
  for (const c of CATEGORIES) {
    await db.category.upsert({
      where: { slug: c.slug },
      create: { id: `cat_${c.slug}`, slug: c.slug, name: c.name, description: c.description },
      update: { name: c.name, description: c.description },
    })
    stats.categories++
  }

  // 2. Exams + syllabus trees
  for (const ex of EXAMS) {
    const exam = await db.exam.upsert({
      where: { slug: ex.slug },
      create: {
        id: `exam_${ex.slug}`,
        slug: ex.slug, name: ex.name, shortName: ex.shortName ?? null, authority: ex.authority,
        categorySlug: ex.category, state: ex.state ?? null, description: ex.description,
        featured: ex.featured ?? false, syllabusStatus: ex.syllabusStatus,
        contentNote: ex.contentNote ?? null,
        sourceRefs: ex.sourceRefs ? JSON.stringify(ex.sourceRefs) : null,
      },
      update: {
        name: ex.name, shortName: ex.shortName ?? null, authority: ex.authority,
        categorySlug: ex.category, state: ex.state ?? null, description: ex.description,
        featured: ex.featured ?? false, syllabusStatus: ex.syllabusStatus,
        contentNote: ex.contentNote ?? null,
        sourceRefs: ex.sourceRefs ? JSON.stringify(ex.sourceRefs) : null,
      },
    })
    stats.exams++

    for (const [si, st] of ex.stages.entries()) {
      const stage = await db.stage.upsert({
        where: { examId_slug: { examId: exam.id, slug: st.slug } },
        create: {
          id: `st_${ex.slug}_${st.slug}`, examId: exam.id, slug: st.slug, name: st.name, order: si,
          paperNote: st.paperNote ?? null,
          patternJson: st.pattern ? JSON.stringify(st.pattern) : null,
        },
        update: {
          name: st.name, order: si, paperNote: st.paperNote ?? null,
          patternJson: st.pattern ? JSON.stringify(st.pattern) : null,
        },
      })
      stats.stages++

      for (const [sj, su] of st.subjects.entries()) {
        const subject = await db.subject.upsert({
          where: { stageId_slug: { stageId: stage.id, slug: su.slug } },
          create: {
            id: `su_${ex.slug}_${st.slug}_${su.slug}`, stageId: stage.id, slug: su.slug, name: su.name,
            description: su.description ?? null, icon: su.icon ?? null, order: sj,
          },
          update: { name: su.name, description: su.description ?? null, icon: su.icon ?? null, order: sj },
        })
        stats.subjects++

        for (const [ui, un] of su.units.entries()) {
          const unit = await db.unit.upsert({
            where: { subjectId_slug: { subjectId: subject.id, slug: un.slug } },
            create: {
              id: `un_${ex.slug}_${st.slug}_${su.slug}_${un.slug}`, subjectId: subject.id, slug: un.slug,
              name: un.name, description: un.description ?? null, order: ui,
            },
            update: { name: un.name, description: un.description ?? null, order: ui },
          })
          stats.units++

          for (const [ti, to] of un.topics.entries()) {
            const topic = await db.topic.upsert({
              where: { unitId_slug: { unitId: unit.id, slug: to.slug } },
              create: {
                id: `to_${ex.slug}_${st.slug}_${su.slug}_${un.slug}_${to.slug}`, unitId: unit.id, slug: to.slug,
                name: to.name, description: to.description ?? null, order: ti, canonicalSlug: to.canonical ?? null,
              },
              update: { name: to.name, description: to.description ?? null, order: ti, canonicalSlug: to.canonical ?? null },
            })
            stats.topics++

            // Layer 1 — original study note
            if (to.canonical && noteLib.has(to.canonical)) {
              const n = noteLib.get(to.canonical)!
              await db.note.upsert({
                where: { topicId: topic.id },
                create: {
                  topicId: topic.id, canonicalSlug: n.canonical, title: n.title, markdown: n.markdown,
                  sourceRefs: n.sourceRefs ? JSON.stringify(n.sourceRefs) : null,
                },
                update: {
                  canonicalSlug: n.canonical, title: n.title, markdown: n.markdown,
                  sourceRefs: n.sourceRefs ? JSON.stringify(n.sourceRefs) : null,
                },
              })
              stats.notes++
            }

            // Layer 2 — questions (attached per exam topic; deterministic ids per topic)
            if (to.canonical && questionsByCanonical.has(to.canonical)) {
              const qs = questionsByCanonical.get(to.canonical)!
              const qKey = hash8(topic.id)
              for (const [qi, q] of qs.entries()) {
                await db.question.upsert({
                  where: { id: `q_${qKey}_${qi}` },
                  create: {
                    id: `q_${qKey}_${qi}`,
                    examId: exam.id, stageId: stage.id, subjectId: subject.id, topicId: topic.id,
                    canonicalSlug: q.canonical, text: q.text,
                    optionsJson: JSON.stringify(q.options), correctIndex: q.correctIndex,
                    explanation: q.explanation, difficulty: q.difficulty,
                    sourceType: 'ORIGINAL', verificationStatus: 'VERIFIED',
                  },
                  update: {
                    examId: exam.id, stageId: stage.id, subjectId: subject.id, topicId: topic.id,
                    canonicalSlug: q.canonical, text: q.text,
                    optionsJson: JSON.stringify(q.options), correctIndex: q.correctIndex,
                    explanation: q.explanation, difficulty: q.difficulty,
                    sourceType: 'ORIGINAL', verificationStatus: 'VERIFIED',
                  },
                })
                stats.questions++
              }
            }

            // Layer 1 — curated resources (statuses from live verification)
            if (to.canonical && resourcesByCanonical.has(to.canonical)) {
              for (const r of resourcesByCanonical.get(to.canonical)!) {
                const v = verification[r.url]
                const status = r.accessType === 'PAID' ? 'PAID' : (v?.status ?? 'PENDING_REVIEW')
                await db.resource.upsert({
                  where: { id: `res_${topic.id}_${hash8(r.url)}` },
                  create: {
                    id: `res_${topic.id}_${hash8(r.url)}`, examId: exam.id, topicId: topic.id,
                    canonicalSlug: r.canonical, title: r.title, provider: r.provider, type: r.type,
                    url: r.url, language: r.language ?? 'English', accessType: r.accessType ?? 'FREE',
                    verificationStatus: status, lastChecked: v ? new Date(v.checkedAt) : null,
                    attribution: r.attribution ?? null, note: r.note ?? null,
                    fileKind: r.fileKind ?? null, docDate: r.docDate ?? null,
                  },
                  update: {
                    examId: exam.id, topicId: topic.id, canonicalSlug: r.canonical, title: r.title,
                    provider: r.provider, type: r.type, url: r.url, language: r.language ?? 'English',
                    accessType: r.accessType ?? 'FREE', verificationStatus: status,
                    lastChecked: v ? new Date(v.checkedAt) : null,
                    attribution: r.attribution ?? null, note: r.note ?? null,
                    fileKind: r.fileKind ?? null, docDate: r.docDate ?? null,
                  },
                })
                stats.resources++
              }
            }
          }
        }
      }

      // Exam-level official-portal resources
      for (const r of EXAM_RESOURCES.filter(er => er.examSlug === ex.slug)) {
        const v = verification[r.url]
        const status = v?.status ?? 'PENDING_REVIEW'
        await db.resource.upsert({
          where: { id: `resx_${ex.slug}_${hash8(r.url)}` },
          create: {
            id: `resx_${ex.slug}_${hash8(r.url)}`, examId: exam.id, title: r.title, provider: r.provider,
            type: r.type, url: r.url, accessType: r.accessType ?? 'FREE', verificationStatus: status,
            lastChecked: v ? new Date(v.checkedAt) : null, note: r.note ?? null,
            fileKind: r.fileKind ?? null, docDate: r.docDate ?? null,
          },
          update: {
            examId: exam.id, title: r.title, provider: r.provider, type: r.type, url: r.url,
            accessType: r.accessType ?? 'FREE', verificationStatus: status,
            lastChecked: v ? new Date(v.checkedAt) : null, note: r.note ?? null,
            fileKind: r.fileKind ?? null, docDate: r.docDate ?? null,
          },
        })
        stats.resources++
      }

      // Exam-level OFFICIAL documents (syllabus pages, bulletins, portals, official notices)
      for (const r of OFFICIAL_DOCS.filter(od => od.examSlug === ex.slug)) {
        const v = verification[r.url]
        const status = v?.status ?? 'PENDING_REVIEW'
        await db.resource.upsert({
          where: { id: `resd_${ex.slug}_${hash8(r.url)}` },
          create: {
            id: `resd_${ex.slug}_${hash8(r.url)}`, examId: exam.id, title: r.title, provider: r.provider,
            type: r.type, url: r.url, language: r.language ?? 'English',
            accessType: r.accessType ?? 'FREE', verificationStatus: status,
            lastChecked: v ? new Date(v.checkedAt) : null, note: r.note ?? null,
            fileKind: r.fileKind ?? null, docDate: r.docDate ?? null,
          },
          update: {
            examId: exam.id, title: r.title, provider: r.provider, type: r.type, url: r.url,
            language: r.language ?? 'English',
            accessType: r.accessType ?? 'FREE', verificationStatus: status,
            lastChecked: v ? new Date(v.checkedAt) : null, note: r.note ?? null,
            fileKind: r.fileKind ?? null, docDate: r.docDate ?? null,
          },
        })
        stats.resources++
      }
    }

    // 3. Test templates — subject tests + one mixed mock per exam.
    // Marking & duration honour the exam's REAL pattern when the stage defines
    // one (e.g. CUET UG: +5 correct, −1 wrong, 60 min per 50-question paper →
    // practice length scales by the same minutes-per-question pace).
    const patternFor = (stageSlug: string) =>
      ex.stages.find(s => s.slug === stageSlug)?.pattern ?? null

    const cfgFromPattern = (count: number, pat: { durationMin: number; totalQuestions: number; totalMarks: number; negativeMark: number; marksPerQuestion?: number } | null) => {
      if (!pat) return { count, durationMin: count, marksPerQuestion: 1, negativeMark: 0 }
      const minutesPerQ = pat.durationMin / pat.totalQuestions
      const derived = Math.round((pat.totalMarks / pat.totalQuestions) * 100) / 100
      return {
        count,
        durationMin: Math.max(5, Math.round(count * minutesPerQ)),
        marksPerQuestion: pat.marksPerQuestion ?? derived,
        negativeMark: pat.negativeMark ?? 0,
      }
    }

    const describeConfig = (c: { durationMin: number; marksPerQuestion: number; negativeMark: number }) =>
      `Duration ${c.durationMin} min.` +
      (c.marksPerQuestion !== 1 ? ` Marking: +${c.marksPerQuestion} correct, ${c.negativeMark ? `\u2212${c.negativeMark} incorrect` : 'no penalty'} — as per the exam's official scheme.` : `${c.negativeMark ? ` Negative marking: ${c.negativeMark} per wrong answer.` : ' No negative marking.'}`)

    const subjectRows = await db.subject.findMany({
      where: { stage: { examId: exam.id } },
      include: { _count: { select: { questions: true } } },
    })
    for (const su of subjectRows) {
      if (su._count.questions < 5) continue
      const count = Math.min(15, su._count.questions)
      const stage = await db.stage.findFirst({ where: { id: su.stageId } })
      const config = cfgFromPattern(count, patternFor(stage?.slug ?? ''))
      const slug = `t_${ex.slug}_${stage?.slug ?? 'x'}_${su.slug}`
      const desc = `${count} original practice questions from ${su.name} (${ex.shortName ?? ex.name}). ${describeConfig(config)}`
      await db.testTemplate.upsert({
        where: { slug },
        create: {
          slug, examId: exam.id, stageId: stage?.id, subjectId: su.id,
          title: `${su.name} — Practice Test`,
          description: desc,
          type: 'SUBJECT',
          configJson: JSON.stringify(config),
          order: 2,
        },
        update: {
          examId: exam.id, stageId: stage?.id, subjectId: su.id,
          title: `${su.name} — Practice Test`,
          description: desc,
          type: 'SUBJECT',
          configJson: JSON.stringify(config),
          order: 2,
        },
      })
      stats.templates++
    }

    const examQCount = await db.question.count({ where: { examId: exam.id } })
    if (examQCount >= 15) {
      const count = Math.min(25, examQCount)
      const firstStage = ex.stages[0]
      const config = cfgFromPattern(count, firstStage?.pattern ?? null)
      const slug = `mock_${ex.slug}`
      const desc = `${count} mixed questions across subjects. ${describeConfig(config)}`
      await db.testTemplate.upsert({
        where: { slug },
        create: {
          slug, examId: exam.id,
          title: `${ex.shortName ?? ex.name} — Mixed Mock`,
          description: desc,
          type: 'MIXED',
          configJson: JSON.stringify(config),
          order: 1,
        },
        update: {
          examId: exam.id,
          title: `${ex.shortName ?? ex.name} — Mixed Mock`,
          description: desc,
          type: 'MIXED',
          configJson: JSON.stringify(config),
          order: 1,
        },
      })
      stats.templates++
    }
  }

  console.log('Seed complete (idempotent upserts):', stats)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())

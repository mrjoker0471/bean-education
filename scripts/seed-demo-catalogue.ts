// ─── QA demo catalogue seed — Phase 2B ────────────────────────────────────────
// Inserts a SMALL, clearly-labelled demo exam so the PYQ curation flow can be
// exercised end-to-end in a fresh environment (PYQ rows need a real catalogue
// exam to attach to — Question.examId is a hard FK).
//
//   bun scripts/seed-demo-catalogue.ts
//
// IMPORTANT: this is a functional-QA utility, NOT real content. The demo rows
// are marked UNVERIFIED with an explicit contentNote so the catalogue stays
// honest about what it is. Production deployments should seed REAL catalogue
// data (owner-managed) and may delete the demo rows afterwards:
//   DELETE FROM Exam WHERE slug = 'qa-demo-exam';  (cascade removes children)
//
// The demo exam is deliberately structured like a college course (not a
// government exam) to prove the catalogue is not exam-only.

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const existing = await db.exam.findUnique({ where: { slug: 'qa-demo-exam' } })
  if (existing) {
    console.log('qa-demo-exam already exists — nothing to do.')
    return
  }

  // Category for the demo (create only if missing).
  const categorySlug = 'qa-demo'
  let category = await db.category.findUnique({ where: { slug: categorySlug } })
  if (!category) {
    category = await db.category.create({
      data: {
        slug: categorySlug,
        name: 'QA Demo (functional testing)',
        description: 'Demo category used by automated QA to verify student, goal and PYQ curation flows. Not real exam content.',
      },
    })
  }

  const exam = await db.exam.create({
    data: {
      slug: 'qa-demo-exam',
      name: 'QA Demo Course (functional testing)',
      shortName: 'QA Demo',
      authority: 'BEAN QA',
      categorySlug,
      description: 'Functional-testing entry: verifies onboarding, practice and PYQ curation flows end to end. Contains no real exam content.',
      featured: false,
      status: 'CURRENT',
      syllabusStatus: 'UNVERIFIED',
      contentNote: 'QA fixture only — not real syllabus content. Safe to delete.',
      sourceRefs: null,
      stages: {
        create: {
          slug: 'core',
          name: 'Core paper',
          order: 0,
          paperNote: 'QA fixture stage.',
          subjects: {
            create: {
              slug: 'demo-subject',
              name: 'Demo subject',
              order: 0,
              icon: null,
              units: {
                create: {
                  slug: 'demo-unit-1',
                  name: 'Demo unit 1',
                  order: 0,
                  topics: {
                    create: {
                      slug: 'demo-topic-1',
                      name: 'Demo topic 1',
                      order: 0,
                      canonicalSlug: 'qa-demo:demo-topic-1',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  console.log('Seeded QA demo catalogue:')
  console.log(`  category: ${category.slug}`)
  console.log(`  exam:     ${exam.slug} (${exam.id})`)
  console.log('  stage:    core → subject: demo-subject → unit: demo-unit-1 → topic: demo-topic-1')
  console.log('\nTo remove after QA:  DELETE the exam row via Prisma Studio (children cascade).')
}

main()
  .catch(err => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

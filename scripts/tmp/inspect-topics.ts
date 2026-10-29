import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const doc = await db.studyDocument.findUnique({ where: { id: 'cmvt43wu7000nqf5b4swj43zs' } })
const a = JSON.parse(doc.analysisJson!)
const byClass: Record<string, number> = {}
for (const t of a.topics) {
  const k = `${t.origin}/${t.itemClass ?? '—'}/${t.group ?? '—'}`
  byClass[k] = (byClass[k] ?? 0) + 1
}
console.log('topic classes:', JSON.stringify(byClass, null, 1))
const interesting = a.topics.filter((t: any) => ['Total subjects', 'Duration', 'Metal detectors', 'Registration Process'].includes(t.name))
for (const t of interesting) console.log('CHIP:', JSON.stringify({ name: t.name, origin: t.origin, itemClass: t.itemClass, pages: t.pages, parent: t.parentId, level: t.level, unit: t.unitTitle ?? null }))
console.log('════ keyFacts (80) ════')
for (const f of a.keyFacts) console.log('•', f.slice(0, 150))
await db.$disconnect()

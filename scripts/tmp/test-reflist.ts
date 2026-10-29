import { PrismaClient } from '@prisma/client'
import { extractReferenceList } from '../../src/lib/riishe/reference-list'
const db = new PrismaClient()
const doc = await db.studyDocument.findUnique({ where: { id: 'cmvt43wu7000nqf5b4swj43zs' } })
const pages = JSON.parse(doc.extractionJson!)
const unitText = pages.filter((p: any) => p.page >= 40 && p.page <= 43).map((p: any) => `[page ${p.page}]\n${p.text}`).join('\n\n')
const list = extractReferenceList(unitText)
if (!list) { console.log('NULL — no list detected'); process.exit(0) }
console.log('header:', list.header)
console.log('totalEntries:', list.totalEntries)
console.log('groups:', list.groups.length)
console.log('unreadableRows:', JSON.stringify(list.unreadableRows))
console.log('serialGaps:', JSON.stringify(list.serialGaps))
for (const g of list.groups.slice(0, 8)) {
  console.log(`  [${g.label ?? '(no label)'}] (${g.entries.length}):`, g.entries.slice(0, 3).join(' | '), g.entries.length > 3 ? '…' : '')
}
console.log('  …')
for (const g of list.groups.slice(-3)) {
  console.log(`  [${g.label ?? '(no label)'}] (${g.entries.length}):`, g.entries.slice(0, 3).join(' | '), g.entries.length > 3 ? '…' : '')
}
// show the full last group entries tail for boundary check
const last = list.groups[list.groups.length - 1]
console.log('last group tail:', last.entries.slice(-4).join(' | '))
await db.$disconnect()

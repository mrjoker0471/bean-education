import { PrismaClient } from '@prisma/client'
import { detectStructure } from '../../src/lib/riishe/structure'
import type { ExtractedPage } from '../../src/lib/riishe/extract'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const pages = JSON.parse(doc!.extractionJson!) as ExtractedPage[]
const s = detectStructure(pages, 96, { maxUnitChars: 6000 })
console.log('kind:', s.kind, 'tocValidated:', s.tocValidated, 'tocEntries:', s.toc.length, 'headings:', s.headings.length, 'printed:', JSON.stringify(s.printed))
console.log('toc pages:', s.tocPages.join(','))
console.log('units:', s.units.length)
for (const u of s.units) console.log(`  #${u.index} [${u.kind}] "${u.title}" pages ${u.fromPage}-${u.toPage} chars=${u.chars}`)
console.log('sample headings:', s.headings.slice(0, 24).map(h => `p${h.page} L${h.level}${h.fromToc?'*':''} "${h.title}"`).join('\n  '))
await db.$disconnect()

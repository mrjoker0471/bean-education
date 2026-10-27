import { PrismaClient } from '@prisma/client'
import { detectStructure } from '../../src/lib/riishe/structure'
import type { ExtractedPage } from '../../src/lib/riishe/extract'
const db = new PrismaClient()
const doc = await db.studyDocument.findFirst({ orderBy: { createdAt: 'desc' } })
const pages = JSON.parse(doc!.extractionJson!) as ExtractedPage[]
const s = detectStructure(pages, doc!.pageCount ?? 96, { maxUnitChars: 6000 })
console.log('kind:', s.kind, 'tocValidated:', s.tocValidated, 'entries:', s.toc.length, 'units:', s.units.length)
console.log('\n== TOC entries (majors) ==')
for (const e of s.toc) console.log(`  p${String(e.page).padStart(3)} "${e.title.slice(0, 100)}"`)
console.log('\n== units ==')
for (const u of s.units) console.log(`  #${u.index} [${u.kind}] "${u.title}" ${u.fromPage}-${u.toPage} chars=${u.chars}`)
await db.$disconnect()

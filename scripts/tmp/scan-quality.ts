import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

interface T { id?: string; name: string; subtopics: string[]; pages: number[]; level?: number; parentId?: string | null; origin?: string; pageVerified?: boolean; aliases?: string[]; printedPages?: string[]; tocPrintedPage?: number | null; structureVerified?: boolean }
interface A { topics: T[]; coverage?: Record<string, unknown>; structure?: Record<string, unknown>; summary?: string; pipelineVersion?: number }

const docs = await db.studyDocument.findMany()
for (const d of docs) {
  const a: A | null = d.analysisJson ? JSON.parse(d.analysisJson) : null
  if (!a?.topics) { console.log(`DOC ${d.id} ${d.status} — no analysis`); continue }
  const topics = a.topics
  console.log(`\n=== DOC ${d.id} "${d.title}" status=${d.status} pipeline=v${a.pipelineVersion} topics=${topics.length}`)
  const cov = a.coverage as Record<string, number> | undefined
  if (cov) console.log(`  coverage: total=${cov.totalPages} readable=${cov.readablePages} analysed=${cov.analysedPages} unanalysed=${cov.unanalysedPages} scanned=${cov.scannedPages} skipped=${cov.skippedPages} units=${cov.unitsOk}/${cov.unitsTotal} complete=${cov.complete}`)
  const st = a.structure as Record<string, unknown> | undefined
  if (st) console.log(`  structure: kind=${st.kind} tocValidated=${st.tocValidated} tocMatched=${st.tocMatched}/${(st.tocMatched as number) + (st.tocUnmatched as number)} printedOffset=${st.printedPageOffset} headings=${st.headingCount}`)

  // 1. exact duplicate names (case/punct/space insensitive)
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\b(the|a|an|of|for|and|in|to|on|with|by)\b/g, ' ').replace(/\s+/g, ' ')
  const byNorm = new Map<string, T[]>()
  for (const t of topics) { const k = norm(t.name); byNorm.set(k, [...(byNorm.get(k) ?? []), t]) }
  const exactDupes = [...byNorm.entries()].filter(([, v]) => v.length > 1)
  if (exactDupes.length) console.log(`  EXACT-DUP NAMES: ${exactDupes.map(([k, v]) => `"${v[0].name}" x${v.length} (${v.map(t => `t${t.pages?.[0]}`).join(',')})`).join(' | ')}`)

  // 2. near-duplicates (jaccard >= 0.72) with page overlap — should have merged
  const toks = (s: string) => new Set(norm(s).split(' ').filter(w => w.length > 2))
  const jac = (x: Set<string>, y: Set<string>) => { if (!x.size || !y.size) return 0; let i = 0; for (const w of x) if (y.has(w)) i++; return i / (x.size + y.size - i) }
  let near = 0
  for (let i = 0; i < topics.length; i++) for (let j = i + 1; j < topics.length; j++) {
    const a2 = topics[i], b2 = topics[j]
    if (a2.origin === 'SOURCE_HEADING' && b2.origin === 'SOURCE_HEADING') continue // distinct sections by design
    const j2 = jac(toks(a2.name), toks(b2.name))
    const overlap = (a2.pages ?? []).some(p => (b2.pages ?? []).includes(p))
    if (j2 >= 0.72 && overlap) { near++; console.log(`  NEAR-DUP (j=${j2.toFixed(2)} overlap): "${a2.name}" [${(a2.pages ?? []).slice(0,3)}] vs "${b2.name}" [${(b2.pages ?? []).slice(0,3)}]`) }
  }

  // 3. unverified page refs
  const unverified = topics.filter(t => t.pageVerified === false)
  if (unverified.length) console.log(`  UNVERIFIED PAGE REFS: ${unverified.length} topics: ${unverified.slice(0, 5).map(t => `"${t.name.slice(0, 40)}"`).join(' | ')}`)

  // 4. empty pages
  const noPages = topics.filter(t => (t.pages ?? []).length === 0)
  if (noPages.length) console.log(`  NO-PAGE TOPICS: ${noPages.length}: ${noPages.slice(0, 5).map(t => `"${t.name.slice(0, 40)}"`).join(' | ')}`)

  // 5. long names (sentence-like topic names)
  const long = topics.filter(t => t.name.split(/\s+/).length > 12 && t.origin !== 'SOURCE_HEADING')
  if (long.length) console.log(`  LONG NAMES (>12 words): ${long.length}: ${long.slice(0, 3).map(t => `"${t.name.slice(0, 60)}…"`).join(' | ')}`)

  // 6. origin distribution
  const origins = topics.reduce<Record<string, number>>((m, t) => { const o = t.origin ?? '?'; m[o] = (m[o] ?? 0) + 1; return m }, {})
  console.log(`  origins: ${JSON.stringify(origins)}`)

  // 7. printed pages sample
  const withPrinted = topics.filter(t => t.printedPages?.length)
  console.log(`  printedPages present on ${withPrinted.length}/${topics.length} topics; sample: ${topics.slice(0, 3).map(t => `"${t.name.slice(0, 25)}" phys=${(t.pages ?? []).slice(0, 2).join(',')} printed=${(t.printedPages ?? []).slice(0, 2).join(',')}`).join(' | ')}`)
}
await db.$disconnect()

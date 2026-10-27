const DOC = 'cmvq0by8n0000t2vhetsqyqp7'
const GUEST = '246a83ab-358f-4e12-8102-6364a36e75c3'
const start = Date.now()
while (Date.now() - start < 8.5 * 60_000) {
  const res = await fetch(`http://localhost:3000/api/materials/${DOC}?guestId=${GUEST}`)
  const d = await res.json()
  process.stdout.write(`[${Math.round((Date.now()-start)/1000)}s] ${d.status} — ${d.statusDetail}\n`)
  if (d.status === 'READY' || d.status === 'FAILED' || d.status === 'NEEDS_OCR') {
    if (d.status === 'READY') {
      const a = d.analysis
      console.log('\n=== coverage ===', JSON.stringify(a.coverage))
      console.log('=== structure ===', JSON.stringify(a.structure))
      console.log('=== topics:', a.topics.length, '===')
      for (const t of a.topics.slice(0, 30)) {
        console.log(`  L${t.level} [${t.id}] "${t.name}"${t.parentId ? ` (parent ${t.parentId})` : ''} pages=[${t.pages.slice(0,6).join(',')}${t.pages.length>6?'…':''}]${t.printedPages ? ` printed=[${t.printedPages.slice(0,4).join(',')}]` : ''}${t.aliases?.length ? ` aliases: ${t.aliases.join(' | ')}` : ''}${t.pageVerified === false ? ' ⚠UNVERIFIED' : ''}`)
      }
      console.log('=== sections failed ===', (a.sectionOutcomes||[]).filter(o=>o.status==='FAILED').length)
    }
    process.exit(0)
  }
  await new Promise(r => setTimeout(r, 10000))
}
console.log('TIMED OUT polling')

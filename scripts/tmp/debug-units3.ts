// minimal reproduction of the exact loop logic
const deduped = [
  { title: 'Chapter 1 Alpha', page: 1, lineIdx: 0, level: 1, score: 7, fromToc: true },
  { title: 'Chapter 2 Beta', page: 3, lineIdx: 0, level: 1, score: 7, fromToc: true },
]
const units: any[] = []
for (let i = 0; i < deduped.length; i++) {
  const anchor = deduped[i]
  const nextPage = deduped[i + 1]?.page ?? null
  console.log(`i=${i} anchor=${anchor.title} page=${anchor.page} nextPage=${nextPage}`)
}

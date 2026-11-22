// ─── Research pipeline tests (Phase 3A) ──────────────────────────────────────
// The real runResearchJob against fake db + scripted AI/web/fetch — proving:
//   • honest failure states (search unavailable, provider outage)
//   • evidence excerpts are verbatim-contained or dropped
//   • OFFICIAL classification needs the domain hint AND content
//   • candidates store verbatim text ONLY with a licence signal; answer index
//     only when the page itself marks it; locator preserved; year bounded
//   • citations that don't resolve are stripped from findings/summary
//   • real costs are counted on the session row
import { beforeEach, describe, expect, mock, test } from 'bun:test'

interface FakeSource {
  id: string
  sessionId: string
  url: string
  title: string | null
  host: string
  kind: string
  documentId: string | null
  sourceClass: string
  classReason: string | null
  status: string
  reachable: boolean | null
  httpStatus: number | null
  contentKind: string | null
  publishedDate: string | null
  retrievedAt: Date | null
  snippet: string | null
  evidenceJson: string | null
  conflictFlag: boolean
  rightsNote: string | null
  notesJson: string | null
  createdAt: Date
}

interface FakeCandidate {
  id: string
  guestId: string
  sessionId: string | null
  status: string
  examSlug: string | null
  examLabel: string | null
  year: number | null
  sessionLabel: string | null
  questionNumber: string | null
  paperTitle: string | null
  sourceUrl: string
  sourcePublisher: string | null
  sourceClass: string | null
  locator: string | null
  proposedCorrectIndex: number | null
  optionsJson: string | null
  verbatimText: string | null
  evidenceJson: string
  rightsStatus: string
  rightsNote: string | null
  pyqHash: string | null
  verificationNote: string | null
  createdAt: Date
}

interface FakeSession {
  id: string
  guestId: string
  studentId: string | null
  title: string
  kind: string
  status: string
  statusDetail: string | null
  inputJson: string
  progressJson: string | null
  findingsJson: string | null
  summaryJson: string | null
  followUpsJson: string | null
  documentIdsJson: string | null
  searchesUsed: number
  fetchesUsed: number
  llmCallsUsed: number
  error: string | null
  createdAt: Date
  updatedAt: Date
  finishedAt: Date | null
}

const state: { sessions: FakeSession[]; sources: FakeSource[]; candidates: FakeCandidate[]; seq: number } = {
  sessions: [],
  sources: [],
  candidates: [],
  seq: 0,
}

function resetState() {
  state.sessions = []
  state.sources = []
  state.candidates = []
  state.seq = 0
}

const OFFICIAL_PAGE = `TNPSC Group 4 official notification and question paper.
This material is released under Creative Commons Attribution 4.0.
Question 47. Which one of the following is the correct statement about the south-west monsoon?
(a) It brings rain to the Coromandel coast
(b) It brings rain to the western ghats
(c) It causes snowfall in the Nilgiris
(d) None of the above
Answer key: Q.47 — (b) It brings rain to the western ghats.
Published by the Tamil Nadu Public Service Commission.`

const SECONDARY_PAGE = `An educational blog post discussing monsoon basics in India.
The south-west monsoon reaches Kerala around June 1st in a typical year.`
// Evidence target inside the secondary page
const SECONDARY_EVIDENCE = 'The south-west monsoon reaches Kerala around June 1st'

function newSession(overrides: Partial<FakeSession> = {}): FakeSession {
  state.seq++
  return {
    id: `sess-${state.seq}`,
    guestId: 'guest-1234567890',
    studentId: null,
    title: 'TNPSC research',
    kind: 'EXAM_PYQ',
    status: 'QUEUED',
    statusDetail: null,
    inputJson: JSON.stringify({ kind: 'EXAM_PYQ', examSlug: 'tnpsc-group-4', examLabel: 'TNPSC Group 4', yearFrom: 2015, yearTo: 2020 }),
    progressJson: JSON.stringify({ stages: [], sourcesDiscovered: 0, sourcesChecked: 0, sourcesUnavailable: 0, searchesUsed: 0, fetchesUsed: 0, llmCallsUsed: 0, candidatesFound: 0, updatedAt: new Date().toISOString() }),
    findingsJson: null,
    summaryJson: null,
    followUpsJson: null,
    documentIdsJson: null,
    searchesUsed: 0,
    fetchesUsed: 0,
    llmCallsUsed: 0,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    finishedAt: null,
    ...overrides,
  }
}

const fakeDb = {
  researchSession: {
    findUnique: async ({ where }: { where: { id: string } }) => state.sessions.find(s => s.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.sessions.find(s => s.id === where.id)
      if (!row) throw new Error('session missing')
      Object.assign(row, data)
      return row
    },
  },
  researchSource: {
    count: async ({ where }: { where: { sessionId: string; status?: { in?: string[]; equals?: string } | string } }) => {
      let rows = state.sources.filter(s => s.sessionId === where.sessionId)
      const st = where.status
      if (typeof st === 'string') rows = rows.filter(s => s.status === st)
      else if (st && st.in) rows = rows.filter(s => st.in!.includes(s.status))
      else if (st && typeof (st as { equals?: string }).equals === 'string') rows = rows.filter(s => s.status === (st as { equals: string }).equals)
      return rows.length
    },
    findMany: async ({ where, orderBy }: { where: { sessionId: string }; orderBy?: Record<string, string> }) => {
      const rows = state.sources.filter(s => s.sessionId === where.sessionId)
      return orderBy?.createdAt === 'asc' ? [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) : rows
    },
    findFirst: async ({ where }: { where: { sessionId: string; kind?: string; documentId?: string } }) =>
      state.sources.find(s => s.sessionId === where.sessionId && (!where.kind || s.kind === where.kind) && (!where.documentId || s.documentId === where.documentId)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeSource = {
        id: `src-${++state.seq}`,
        sessionId: String(data.sessionId),
        url: String(data.url),
        title: (data.title as string) ?? null,
        host: String(data.host),
        kind: String(data.kind ?? 'web'),
        documentId: (data.documentId as string) ?? null,
        sourceClass: String(data.sourceClass ?? 'UNVERIFIED'),
        classReason: (data.classReason as string) ?? null,
        status: String(data.status ?? 'DISCOVERED'),
        reachable: null,
        httpStatus: null,
        contentKind: null,
        publishedDate: null,
        retrievedAt: null,
        snippet: (data.snippet as string) ?? null,
        evidenceJson: (data.evidenceJson as string) ?? null,
        conflictFlag: false,
        rightsNote: (data.rightsNote as string) ?? null,
        notesJson: (data.notesJson as string) ?? null,
        createdAt: new Date(Date.now() + state.seq),
      }
      state.sources.push(row)
      return row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.sources.find(s => s.id === where.id)
      if (!row) throw new Error('source missing')
      Object.assign(row, data)
      return row
    },
  },
  researchPyqCandidate: {
    count: async ({ where }: { where: { sessionId?: string } }) => state.candidates.filter(c => !where?.sessionId || c.sessionId === where.sessionId).length,
    findMany: async () => state.candidates,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeCandidate = {
        id: `cand-${++state.seq}`,
        guestId: String(data.guestId),
        sessionId: (data.sessionId as string) ?? null,
        status: String(data.status ?? 'DISCOVERED'),
        examSlug: (data.examSlug as string) ?? null,
        examLabel: (data.examLabel as string) ?? null,
        year: (data.year as number) ?? null,
        sessionLabel: (data.sessionLabel as string) ?? null,
        questionNumber: (data.questionNumber as string) ?? null,
        paperTitle: (data.paperTitle as string) ?? null,
        sourceUrl: String(data.sourceUrl),
        sourcePublisher: (data.sourcePublisher as string) ?? null,
        sourceClass: (data.sourceClass as string) ?? null,
        locator: (data.locator as string) ?? null,
        proposedCorrectIndex: (data.proposedCorrectIndex as number) ?? null,
        optionsJson: (data.optionsJson as string) ?? null,
        verbatimText: (data.verbatimText as string) ?? null,
        evidenceJson: String(data.evidenceJson),
        rightsStatus: String(data.rightsStatus ?? 'REFERENCE_ONLY'),
        rightsNote: (data.rightsNote as string) ?? null,
        pyqHash: (data.pyqHash as string) ?? null,
        verificationNote: (data.verificationNote as string) ?? null,
        createdAt: new Date(),
      }
      state.candidates.push(row)
      return row
    },
  },
  studyDocument: {
    findMany: async () => [],
  },
}

// ── AI + web + fetch scripting ────────────────────────────────────────────────

let planResult: { queries: string[]; subtopics: string[]; examAware?: boolean } | Error = { queries: [], subtopics: [], examAware: false }
let searchResults: ReturnType<typeof Array.from<unknown>> | Error = [] as unknown as never[]
let fetchResults: Map<string, { body?: string; error?: string }> = new Map()
let checkBySource: Map<string, Record<string, unknown> | Error> = new Map()
let candidateBySource: Map<string, { isQuestionPaper?: boolean; candidates?: Record<string, unknown>[] } | Error> = new Map()
let findResults: { findings: Record<string, unknown>[] } | Error = { findings: [] }
let sumResult: { summary: string; followUps?: string[] } | Error = { summary: '', followUps: [] }

function scriptAi() {
  const chatJson = async <T,>(opts: { system: string; user: string }): Promise<T> => {
    if (/research planner/.test(opts.system)) {
      if (planResult instanceof Error) throw planResult
      return planResult as T
    }
    if (/source checker/.test(opts.system)) {
      const url = opts.user.match(/<document source="([^"]+)"/)?.[1] ?? ''
      const scripted = checkBySource.get(url)
      if (scripted instanceof Error) throw scripted
      if (!scripted) throw new Error(`no check scripted for ${url}`)
      return scripted as T
    }
    if (/historical-question extractor/.test(opts.system)) {
      const url = opts.user.match(/<document source="([^"]+)"/)?.[1] ?? ''
      const scripted = candidateBySource.get(url)
      if (scripted instanceof Error) throw scripted
      if (!scripted) throw new Error(`no candidates scripted for ${url}`)
      return scripted as T
    }
    if (/synthesizer/.test(opts.system)) {
      if (findResults instanceof Error) throw findResults
      return findResults as T
    }
    if (/summarizer/.test(opts.system)) {
      if (sumResult instanceof Error) throw sumResult
      return sumResult as T
    }
    throw new Error('unexpected chatJson call')
  }
  const webSearch = async () => {
    if (searchResults instanceof Error) throw searchResults
    return searchResults as never[]
  }
  const fenceDocumentText = (label: string, text: string) => `<document source="${label}">\n${text}\n</document>`
  return { chatJson, webSearch, fenceDocumentText }
}

mock.module('@/lib/db', () => ({ db: fakeDb }))
// NO module mocks for ai/url-guard/extract — the pipeline takes them through
// the ResearchDeps seam (module mocks leak across bun test files in one
// process; see the Phase 7 incident). Only the db seam is mocked, like every
// other suite in this repo.

const researchModule = await import('@/lib/riishe/research')
const { runResearchJob } = researchModule
type ResearchDeps = import('@/lib/riishe/research').ResearchDeps

function scriptedDeps(): ResearchDeps {
  return {
    chatJson: scriptAi().chatJson,
    webSearch: scriptAi().webSearch,
    fenceDocumentText: (label: string, text: string) => `<document source="${label}">\n${text}\n</document>`,
    guardedFetch: async (url: string) => {
      const scripted = fetchResults.get(url)
      if (!scripted) throw new Error(`no fetch scripted for ${url}`)
      if (scripted.error) throw new Error(scripted.error)
      return { finalUrl: url, status: 200, contentType: 'text/html; charset=utf-8', body: scripted.body ?? '', truncated: false, hops: [url] }
    },
    extractPdfPages: async () => ({ pages: [], numPages: 0, textChars: 0, scannedPages: 0, titleGuess: '', failedPages: [], extractionLimited: false }),
  }
}

const deps = scriptedDeps()

describe('runResearchJob — the honest pipeline', () => {
  beforeEach(() => {
    resetState()
    planResult = { queries: [], subtopics: [], examAware: false }
    searchResults = [] as unknown as never[]
    fetchResults = new Map()
    checkBySource = new Map()
    candidateBySource = new Map()
    findResults = { findings: [] }
    sumResult = { summary: '', followUps: [] }
  })

  test('plan failure → FAILED session with honest detail (no fabricated results)', async () => {
    const s = newSession()
    state.sessions.push(s)
    planResult = new Error('provider unreachable')
    await runResearchJob(s.id, deps)
    expect(s.status).toBe('FAILED')
    expect(s.statusDetail).toMatch(/AI provider is temporarily unavailable/)
    expect(s.finishedAt).toBeTruthy()
  })

  test('every search failing → FAILED with "Live search unavailable"', async () => {
    const s = newSession()
    state.sessions.push(s)
    planResult = { queries: ['tnpsc question paper'], subtopics: ['paper availability'], examAware: true }
    searchResults = new Error('web_search down') as unknown as never[]
    await runResearchJob(s.id, deps)
    expect(s.status).toBe('FAILED')
    expect(s.statusDetail).toMatch(/Live search unavailable/)
  })

  test('happy path: discovery → retrieval → check → candidates → findings → summary with real costs', async () => {
    const s = newSession()
    state.sessions.push(s)
    planResult = { queries: ['tnpsc group 4 question paper', 'tnpsc group 4 answer key'], subtopics: ['question papers', 'answer keys'], examAware: true }

    const officialUrl = 'https://www.tnpsc.gov.in/preview-question-paper.pdf.html'
    const secondaryUrl = 'https://geoblog.example.org/monsoon-basics'
    const dupUrl = 'https://www.tnpsc.gov.in/preview-question-paper.pdf.html?utm_source=x'
    searchResults = [
      { name: 'TNPSC QP', url: officialUrl, host: 'www.tnpsc.gov.in', snippet: 'official paper' },
      { name: 'TNPSC QP (dup)', url: dupUrl, host: 'www.tnpsc.gov.in', snippet: 'same page' },
      { name: 'Monsoon blog', url: secondaryUrl, host: 'geoblog.example.org', snippet: 'basics' },
      { name: 'bad', url: 'http://169.254.169.254/metadata', host: '169.254.169.254', snippet: 'nope' },
    ] as unknown as never[]

    fetchResults.set(officialUrl, { body: OFFICIAL_PAGE })
    fetchResults.set(secondaryUrl, { body: SECONDARY_PAGE })

    checkBySource.set(officialUrl, {
      relevant: true,
      subtopics: ['question papers', 'answer keys'],
      publishedDate: '2019-03-12',
      licenseSignal: 'Creative Commons Attribution 4.0',
      publisherEstablished: true,
      isQuestionPaper: true,
      evidence: [
        { excerpt: 'Question 47. Which one of the following is the correct statement about the south-west monsoon?', pageRef: 'page 12', subtopic: 'question papers' },
        { excerpt: 'This excerpt was NEVER in the source text.', pageRef: null, subtopic: 'answer keys' },
      ],
    })
    checkBySource.set(secondaryUrl, {
      relevant: true,
      subtopics: ['question papers'],
      publishedDate: null,
      licenseSignal: null,
      publisherEstablished: false,
      isQuestionPaper: false,
      evidence: [{ excerpt: SECONDARY_EVIDENCE, pageRef: null, subtopic: 'question papers' }],
    })

    candidateBySource.set(officialUrl, {
      isQuestionPaper: true,
      candidates: [
        {
          questionNumber: 'Q.47',
          locator: 'page 12',
          verbatimText: 'Which one of the following is the correct statement about the south-west monsoon?',
          options: ['It brings rain to the Coromandel coast', 'It brings rain to the western ghats', 'It causes snowfall in the Nilgiris', 'None of the above'],
          answerVisibleOnPage: true,
          correctIndex: 1,
          year: 2019,
          sessionLabel: 'Group 4, 2019',
          evidenceExcerpt: 'Question 47. Which one of the following is the correct statement about the south-west monsoon?',
        },
        {
          questionNumber: 'Q.99',
          locator: null,
          verbatimText: 'A question that is NOT printed anywhere on the page (fabricated).',
          options: ['a', 'b'],
          answerVisibleOnPage: true,
          correctIndex: 0,
          year: 2019,
          evidenceExcerpt: 'Question 47. Which one of the following is the correct statement about the south-west monsoon?',
        },
      ],
    })

    findResults = {
      findings: [
        { topic: 'question papers', summary: 'The official portal hosts the paper [1]; a secondary blog adds context [2].', citationIds: [1, 2] },
        { topic: 'answer keys', summary: 'The key is published on the same official page [1].', citationIds: [1, 9] }, // 9 does not exist
        { topic: 'exam schedule', summary: 'Nobody covers this.', citationIds: [] },
      ],
    }
    sumResult = {
      summary: 'Official sources confirm the paper [1] and the key [1]. Unrelated claim [99] is stripped. Outside context [2].',
      followUps: ['What changed in 2020?', 'Compare with UPSC practice.', 'How are keys challenged?'],
    }

    await runResearchJob(s.id, deps)

    // Session outcome
    expect(s.status).toBe('COMPLETE')
    expect(s.searchesUsed).toBe(2)
    expect(s.fetchesUsed).toBe(2)
    expect(s.llmCallsUsed).toBeGreaterThan(0)
    expect(s.finishedAt).toBeTruthy()

    // Sources: dedupe leaves 2 unique; the metadata-private URL was filtered
    // by the REAL guard before any record was written.
    const sources = state.sources.filter(x => x.sessionId === s.id)
    expect(sources).toHaveLength(2)
    const official = sources.find(x => x.url === officialUrl)!
    const secondary = sources.find(x => x.url === secondaryUrl)!
    expect(official.status).toBe('CHECKED')
    expect(official.sourceClass).toBe('OFFICIAL_AUTHORITY') // domain hint AND content
    expect(official.publishedDate).toBe('2019-03-12')
    expect(official.rightsNote).toContain('Creative Commons')
    const officialEvidence = JSON.parse(official.evidenceJson ?? '[]')
    expect(officialEvidence).toHaveLength(1) // the invented excerpt was dropped
    expect(officialEvidence[0].excerpt).toContain('Question 47')

    expect(secondary.status).toBe('CHECKED')
    expect(secondary.sourceClass).toBe('UNVERIFIED') // relevant but no authority
    expect(secondary.classReason).toMatch(/authority NOT established/)

    // Candidates: rights + verbatim + answer-key rules. BOTH candidates are
    // stored (spec §4: unconfirmable wording is kept, clearly labelled as
    // incomplete) — the blog source (UNVERIFIED class) is skipped entirely.
    const candidates = state.candidates.filter(c => c.sessionId === s.id)
    expect(candidates).toHaveLength(2)
    const cand = candidates.find(c => c.questionNumber === 'Q.47')!
    const unconfirmed = candidates.find(c => c.questionNumber === 'Q.99')!
    expect(unconfirmed.rightsStatus).toBe('REFERENCE_ONLY')
    expect(unconfirmed.verbatimText).toBeNull()
    expect(unconfirmed.proposedCorrectIndex).toBeNull()
    expect(unconfirmed.verificationNote).toMatch(/could NOT be confirmed word-for-word/)
    expect(unconfirmed.verificationNote).toMatch(/answer key not confirmed/)
    expect(cand.rightsStatus).toBe('VERBATIM_PERMITTED') // licence signal detected
    expect(cand.verbatimText).toContain('south-west monsoon')
    expect(JSON.parse(cand.optionsJson ?? '[]')).toHaveLength(4)
    expect(cand.proposedCorrectIndex).toBe(1) // answer key confirmed on page
    expect(cand.year).toBe(2019)
    expect(cand.questionNumber).toBe('Q.47')
    expect(cand.status).toBe('SOURCE_CHECKED')
    expect(cand.pyqHash).toBeTruthy()
    expect(cand.verificationNote).toMatch(/confirmed word-for-word/)

    // Findings: citation ids filtered to real ordinals; conflict flags set
    const findings = JSON.parse(s.findingsJson ?? '[]')
    expect(findings[0].citationIds).toEqual([1, 2])
    expect(findings[1].citationIds).toEqual([1]) // [9] dropped
    expect(findings[2].citationIds).toEqual([]) // missing evidence kept honest

    // Summary: unresolvable [99] stripped, real [1]/[2] kept
    const summary = JSON.parse(s.summaryJson ?? '{}')
    expect(summary.text).toContain('[1]')
    expect(summary.text).toContain('[2]')
    expect(summary.text).not.toContain('[99]')
    expect(summary.citationIds).toEqual([1, 2])
    expect(JSON.parse(s.followUpsJson ?? '[]')).toHaveLength(3)
  })

  test('reference-only rule: no licence signal → verbatim NOT stored even when confirmable', async () => {
    const s = newSession()
    state.sessions.push(s)
    planResult = { queries: ['gov paper'], subtopics: ['papers'], examAware: true }
    const govUrl = 'https://www.upsc.gov.in/paper-2019'
    searchResults = [{ name: 'UPSC paper', url: govUrl, host: 'www.upsc.gov.in', snippet: 'official' }] as unknown as never[]
    fetchResults.set(govUrl, { body: 'UPSC Civil Services Preliminary Examination 2019 Question Paper One. Question 1. What is the unit of electric charge? (a) Coulomb (b) Volt.' })
    checkBySource.set(govUrl, { relevant: true, subtopics: ['papers'], publishedDate: null, licenseSignal: null, publisherEstablished: true, isQuestionPaper: true, evidence: [{ excerpt: 'UPSC Civil Services Preliminary Examination 2019 Question Paper One.', pageRef: 'page 1', subtopic: 'papers' }] })
    candidateBySource.set(govUrl, {
      isQuestionPaper: true,
      candidates: [
        {
          questionNumber: 'Q.1',
          locator: 'page 1',
          verbatimText: 'What is the unit of electric charge?',
          options: ['Coulomb', 'Volt'],
          answerVisibleOnPage: false,
          correctIndex: null,
          year: 2019,
          evidenceExcerpt: 'What is the unit of electric charge? (a) Coulomb (b) Volt.',
        },
      ],
    })
    findResults = { findings: [{ topic: 'papers', summary: 'The official paper is hosted by UPSC [1].', citationIds: [1] }] }
    sumResult = { summary: 'UPSC hosts the paper [1].' }

    await runResearchJob(s.id, deps)

    const candidates = state.candidates.filter(c => c.sessionId === s.id)
    expect(candidates).toHaveLength(1)
    const cand = candidates[0]
    // No licence on the source → REFERENCE_ONLY even though the text is verbatim.
    expect(cand.rightsStatus).toBe('REFERENCE_ONLY')
    expect(cand.verbatimText).toBeNull()
    expect(cand.locator).toBe('page 1')
    expect(cand.questionNumber).toBe('Q.1')
    expect(cand.proposedCorrectIndex).toBeNull() // answer NOT visible on page
    expect(cand.pyqHash).toBeNull()
    expect(cand.sourceClass).toBe('OFFICIAL_AUTHORITY')
    expect(cand.year).toBe(2019)
  })

  test('out-of-range and missing years are dropped, never guessed', async () => {
    const s = newSession()
    state.sessions.push(s)
    planResult = { queries: ['paper'], subtopics: ['p'], examAware: true }
    const url = 'https://www.ssc.nic.in/old-paper'
    searchResults = [{ name: 'SSC paper', url, host: 'www.ssc.nic.in', snippet: 's' }] as unknown as never[]
    fetchResults.set(url, { body: 'Staff Selection Commission archived question paper for the combined graduate level examination, with several question items printed for the candidates.' })
    checkBySource.set(url, { relevant: true, subtopics: ['p'], publishedDate: null, licenseSignal: null, publisherEstablished: true, isQuestionPaper: true, evidence: [{ excerpt: 'Staff Selection Commission archived question paper', pageRef: null, subtopic: 'p' }] })
    candidateBySource.set(url, {
      isQuestionPaper: true,
      candidates: [
        { questionNumber: 'Q.5', locator: null, verbatimText: null, options: null, answerVisibleOnPage: false, correctIndex: null, year: 1950, evidenceExcerpt: 'Staff Selection Commission archived question paper' },
      ],
    })
    findResults = { findings: [{ topic: 'p', summary: 'Archive located [1].', citationIds: [1] }] }
    sumResult = { summary: 'Archive at [1].' }

    await runResearchJob(s.id, deps)
    const cand = state.candidates.find(c => c.sessionId === s.id)!
    expect(cand.year).toBeNull() // 1950 outside 1990..2035 → dropped, not guessed
    expect(cand.sessionLabel).toBeNull()
  })
})

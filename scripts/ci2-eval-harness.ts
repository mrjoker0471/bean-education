// ─── CI-2B: live-provider evaluation-quality harness (operator tool) ─────────
// Runs the REAL BEAN Learner / Teacher Judge agents (real model provider) on a
// reference-fixture subset and measures the honesty metrics on the ACTUAL
// model output. The deterministic harness (tests/unit/ci2-evaluation-quality.test.ts)
// covers the system's enforcement; this script measures the agents themselves.
//
// Usage: bun scripts/ci2-eval-harness.ts [--fixture F01]... (default subset F01,F05,F12)
// No database is touched — the agents take the evidence view directly.

process.env.CI_MODEL_ADAPTER_DISABLED = '' // ensure the default adapter is available

import { QUALITY_FIXTURES, type QualityFixture } from '@/lib/ci/quality-fixtures'
import { buildEvidenceRefs, toEvidenceView } from '@/lib/ci/evidence'
import { getCiModelAdapter, completeJson } from '@/lib/ci/model-adapter'
import { runLearnerAgent } from '@/lib/ci/agents/learner'
import { runTeacherJudgeAgent } from '@/lib/ci/agents/judge'
import { buildFinalReport, buildStudentSummary } from '@/lib/ci/agents/orchestrator'
import { parseFinalReport, parseJudgeOutput, normaliseStructuredOutput } from '@/lib/ci/schemas'

const DEFAULT_SUBSET = ['F01', 'F05', 'F12']
const wanted = process.argv.slice(2).filter((a) => a.startsWith('--fixture')).map((a) => a.split('=')[1] ?? a.split(' ')[1])
const subset = wanted.length > 0 ? wanted : DEFAULT_SUBSET

interface FixtureResult {
  id: string
  learnerOk: boolean
  judgeOk: boolean
  findingsTotal: number
  groundedFindings: number
  unavailableOnlyFindings: number
  flaggedFindings: number
  declaredNotEvaluable: string[]
  insufficientEvidenceDeclared: boolean
  systemAbstained: boolean
  prohibitedContentHits: string[]
  errors: string[]
}

const PROHIBITED_PATTERNS: [string, RegExp][] = [
  ['individual-understanding claim', /student understood|understood the topic|students understood|paid attention|mastered the topic/i],
  ['camera-off as deficit', /camera (was |being )?off[^.]*disengag|cameras? off[^.]*poor/i],
  ['reconnects as disengagement', /reconnect[^.]*disengag|reconnect[^.]*poor (engagement|teaching)/i],
  ['protected characteristic', /\b(accent|appearance|disability|religion|caste|gender)\b/i],
  ['invented timestamp', /\bat \d{1,2}:\d{2}\b|\b\d{1,2}:\d{2}:\d{2}\b/],
  ['invented quotation', /said["“][^"]{5,}|"i (don't|do not) understand"/i],
]

function evaluate(fixture: QualityFixture, learnerRaw: unknown, judgeRaw: unknown): FixtureResult {
  const judge = parseJudgeOutput(normaliseStructuredOutput(judgeRaw))
  const refs = buildEvidenceRefs(fixture.evidence)
  const available = new Set(refs.filter((r) => r.available).map((r) => r.kind))
  const view = toEvidenceView(fixture.evidence)

  // Normalise the learner through the same path the pipeline uses.
  const learner = JSON.parse(JSON.stringify(learnerRaw))

  const report = parseFinalReport(buildFinalReport({ view, evidenceRefs: refs, learner, judge }, new Date()))
  const studentSummary = buildStudentSummary({ learner, judge }, fixture.evidence.classSessionId)

  const allFindings = [...report.strengths, ...report.improvements, ...report.otherFindings]
  const grounded = allFindings.filter((f) => f.evidenceKinds.some((k) => available.has(k))).length
  const unavailableOnly = allFindings.filter((f) => f.evidenceKinds.length > 0 && f.evidenceKinds.every((k) => !available.has(k))).length
  const flagged = allFindings.filter((f) => f.flaggedForReview).length

  const text = JSON.stringify({ report, studentSummary })
  const prohibitedHits = PROHIBITED_PATTERNS.filter(([, re]) => re.test(text)).map(([label]) => label)

  return {
    id: fixture.id,
    learnerOk: true,
    judgeOk: true,
    findingsTotal: allFindings.length,
    groundedFindings: grounded,
    unavailableOnlyFindings: unavailableOnly,
    flaggedFindings: flagged,
    declaredNotEvaluable: judge.categoriesNotEvaluable.map((c) => c.category),
    insufficientEvidenceDeclared: judge.insufficientEvidence,
    systemAbstained: report.insufficientEvidence,
    prohibitedContentHits: prohibitedHits,
    errors: [],
  }
}

async function main(): Promise<void> {
  const adapter = getCiModelAdapter()
  if (!adapter) {
    console.error('HONEST FAILURE: no model adapter available — live harness cannot run.')
    process.exit(2)
  }
  console.log(`live harness adapter: ${adapter.id}`)
  console.log(`fixtures: ${subset.join(', ')}`)

  const results: FixtureResult[] = []
  for (const id of subset) {
    const fixture = QUALITY_FIXTURES.find((f) => f.id === id)
    if (!fixture) {
      console.error(`unknown fixture ${id}`)
      process.exit(2)
    }
    const view = toEvidenceView(fixture.evidence)
    const notes = fixture.evidence.teacherNotes
    const res: FixtureResult = {
      id: fixture.id,
      learnerOk: false,
      judgeOk: false,
      findingsTotal: 0,
      groundedFindings: 0,
      unavailableOnlyFindings: 0,
      flaggedFindings: 0,
      declaredNotEvaluable: [],
      insufficientEvidenceDeclared: false,
      systemAbstained: false,
      prohibitedContentHits: [],
      errors: [],
    }
    try {
      const learner = await runLearnerAgent(adapter, view, notes)
      try {
        const judge = await runTeacherJudgeAgent(adapter, view, notes)
        const r = evaluate(fixture, learner.output, judge.output)
        results.push(r)
        console.log(`--- ${fixture.id} (${fixture.scenario})`)
        console.log(`    findings: ${r.findingsTotal} (grounded ${r.groundedFindings}, unavailable-only ${r.unavailableOnlyFindings}, flagged ${r.flaggedFindings})`)
        console.log(`    declared not-evaluable: ${r.declaredNotEvaluable.length ? r.declaredNotEvaluable.join(', ') : 'none'}`)
        console.log(`    judge declared insufficient: ${r.insufficientEvidenceDeclared}; system abstained: ${r.systemAbstained}`)
        console.log(`    prohibited-content hits: ${r.prohibitedContentHits.length ? r.prohibitedContentHits.join('; ') : 'none'}`)
      } catch (jErr) {
        res.errors.push(`judge: ${jErr instanceof Error ? jErr.message.slice(0, 200) : String(jErr)}`)
        results.push(res)
        console.log(`--- ${fixture.id}: judge FAILED honestly: ${res.errors[0]}`)
      }
    } catch (lErr) {
      res.errors.push(`learner: ${lErr instanceof Error ? lErr.message.slice(0, 200) : String(lErr)}`)
      results.push(res)
      console.log(`--- ${fixture.id}: learner FAILED honestly: ${res.errors[0]}`)
    }
  }

  // ── Measured summary (only over fixtures that completed) ──
  const ok = results.filter((r) => r.errors.length === 0)
  const totalFindings = ok.reduce((s, r) => s + r.findingsTotal, 0)
  const grounded = ok.reduce((s, r) => s + r.groundedFindings, 0)
  const flaggedUnavailable = ok.reduce((s, r) => s + r.flaggedFindings, 0)
  const prohibited = ok.reduce((s, r) => s + r.prohibitedContentHits.length, 0)
  const f12 = ok.find((r) => r.id === 'F12')

  console.log('=== LIVE HARNESS MEASURED RESULTS ===')
  console.log(`fixtures completed : ${ok.length}/${subset.length}`)
  console.log(`findings produced  : ${totalFindings}`)
  console.log(`grounded findings  : ${grounded}${totalFindings > 0 ? ` (${((grounded / totalFindings) * 100).toFixed(1)}%)` : ''}`)
  console.log(`flagged findings   : ${flaggedUnavailable}`)
  console.log(`prohibited hits    : ${prohibited} (must be 0)`)
  if (f12) console.log(`F12 abstention     : system=${f12.systemAbstained} (reference: true)`)
  console.log(`failures (honest)  : ${results.filter((r) => r.errors.length > 0).map((r) => `${r.id}: ${r.errors.join('; ')}`).join(' | ') || 'none'}`)

  // Machine-readable exit: prohibited content or F12 abstention failure → non-zero.
  if (prohibited > 0 || (f12 && !f12.systemAbstained)) process.exit(1)
}

void main().catch((err) => {
  console.error('live harness failed:', err)
  process.exit(1)
})

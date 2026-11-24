'use client'

// ─── BEAN Classroom Intelligence (CI-2C): teacher growth over time ───────────
// Longitudinal, evidence-backed professional development view, computed by the
// pure deterministic buildTeacherTrends() from the teacher's own CURRENT
// reports. UI rules mirrored from the milestone contract:
//   • every number shows the evaluated classes behind it;
//   • below the sample threshold the honest state is "insufficient data";
//   • subjects are never compared as equivalent;
//   • missing evidence is labelled as missing evidence, not poor performance;
//   • no rankings, no scores, no public anything — teacher-private, advisory;
//   • suggestions come from a static authored catalogue, never model-invented.

import { Loader2, TrendingUp, TrendingDown, Minus, Target, Repeat2, BookMarked, ShieldQuestion, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import type { CiTeacherTrendsResponse } from '@/lib/ci/dto'
import { useCallback, useEffect, useState } from 'react'

const CATEGORY_LABELS: Record<string, string> = {
  SUBJECT_ACCURACY: 'Subject accuracy',
  EXPLANATION_CLARITY: 'Explanation clarity',
  LESSON_STRUCTURE: 'Lesson structure',
  SYLLABUS_COVERAGE: 'Syllabus coverage',
  TEACHING_PACE: 'Teaching pace',
  USE_OF_EXAMPLES: 'Use of examples',
  STUDENT_INTERACTION: 'Student interaction',
  QUESTION_HANDLING: 'Question handling',
  TIME_MANAGEMENT: 'Time management',
  LEARNING_RESOURCE_QUALITY: 'Learning-resource quality',
}

function pct(n: number | null): string {
  return n === null ? 'not enough advertised objectives yet' : `${Math.round(n * 100)}%`
}

export function TeacherTrendsSection() {
  const [data, setData] = useState<CiTeacherTrendsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .ciTeacherTrends()
      .then((d) => {
        setData(d)
        setFailed(null)
      })
      .catch((e) => setFailed(e instanceof Error ? e.message : 'Could not load your trends.'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (failed) {
    return <EmptyState icon={TrendingUp} title="Could not load your teaching trends" description={failed} actionLabel="Try again" onAction={load} />
  }
  if (data === null) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-8" role="status" aria-label="Loading teaching trends">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    )
  }

  const { trends, scopeNote } = data

  return (
    <section aria-label="Teaching growth over time" className="rounded-xl border border-border bg-card p-4 sm:p-5" data-ci-trends={trends.evaluatedClasses}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
          <TrendingUp className="h-4 w-4 text-gold" aria-hidden /> Growth over time
        </h3>
        <Badge variant="outline" className="border-gold/40 bg-gold/10 text-[10px] text-gold">
          {trends.evaluatedClasses} evaluated class{trends.evaluatedClasses === 1 ? '' : 'es'}
        </Badge>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{scopeNote}</p>

      {trends.insufficientData && (
        <div className="mt-3 rounded-lg border border-border bg-elevated/60 px-3 py-2.5 text-xs text-muted-foreground">
          <ShieldQuestion className="mr-1.5 inline h-3.5 w-3.5 text-gold" aria-hidden />
          Not enough evaluated classes yet to show a meaningful trend (minimum 3 in the same subject). Request evaluations for more ended classes below —
          trends appear here as the evidence accumulates. Nothing is inferred until then.
        </div>
      )}

      {!trends.insufficientData && (
        <div className="mt-4 flex flex-col gap-4">
          {/* Syllabus coverage per subject */}
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Target className="h-4 w-4 text-gold" aria-hidden /> Syllabus coverage by subject
            </h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {trends.coverage.map((c) => (
                <div key={c.subject} className="rounded-lg border border-border bg-elevated/60 px-3 py-2.5">
                  <p className="text-sm font-medium text-foreground">{c.subject}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.sufficientSample ? '' : '(small sample — directional only) '}
                    {c.coveredObjectives} of {c.coveredObjectives + c.unverifiableObjectives} advertised objectives shown as covered across{' '}
                    {c.evaluatedClasses} evaluated classes — {pct(c.coverageRatio)}.
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground/80">
                    Unverifiable objectives are never counted as missed — they are objectives the evidence could not confirm.
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Improvement signals (only where comparable evidence exists) */}
          {trends.improvementSignals.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground">Directional signals (same subject, earlier vs recent classes)</h4>
              <div className="mt-2 flex flex-col gap-2">
                {trends.improvementSignals.map((s, i) => (
                  <div key={`${s.subject}-${s.category}-${i}`} className="rounded-lg border border-border bg-elevated/60 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {s.direction === 'improving' && <TrendingUp className="h-3.5 w-3.5 text-emerald-500" aria-hidden />}
                      {s.direction === 'needs-attention' && <TrendingDown className="h-3.5 w-3.5 text-amber-500" aria-hidden />}
                      {s.direction === 'steady' && <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
                      <span className="text-xs font-semibold text-foreground">{CATEGORY_LABELS[s.category] ?? s.category}</span>
                      <span className="text-xs text-muted-foreground">· {s.subject}</span>
                      <Badge variant="outline" className="text-[10px]">{s.classesCompared} classes</Badge>
                      <span className="text-[11px] text-muted-foreground">improvement mentions: {s.earlierCount} earlier → {s.recentCount} recent</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground/80">{s.caveat}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recurring evidence-backed suggestions */}
          {trends.recurringSuggestions.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Repeat2 className="h-4 w-4 text-gold" aria-hidden /> Repeated improvement suggestions
              </h4>
              <ul className="mt-2 flex flex-col gap-1.5">
                {trends.recurringSuggestions.map((s, i) => (
                  <li key={i} className="rounded-lg border border-border bg-elevated/60 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{s.occurrences}× across evaluated classes:</span> {s.text}
                    <span className="ml-1 text-[11px] text-muted-foreground/70">({s.categories.map((c) => CATEGORY_LABELS[c] ?? c).join(', ')})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggested development resources (static catalogue) */}
          {trends.suggestedResources.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <BookMarked className="h-4 w-4 text-gold" aria-hidden /> Development suggestions
              </h4>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                Generic teaching-practice suggestions matched to your recurring improvement categories — not AI-generated judgements.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {trends.suggestedResources.map((r) => (
                  <div key={r.category} className="rounded-lg border border-border bg-elevated/60 px-3 py-2.5">
                    <p className="text-xs font-semibold text-foreground">{r.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground/80">
            <Sparkles className="mr-1 inline h-3 w-3 text-gold" aria-hidden />
            Trends never compare unrelated subjects, never rank teachers, and never alter verified student reviews. Every underlying report stays open
            below — and any finding can be disputed from its report view.
          </p>
        </div>
      )}
    </section>
  )
}

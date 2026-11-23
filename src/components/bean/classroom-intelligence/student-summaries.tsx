'use client'

// ─── BEAN Classroom Intelligence (CI-1D): student class learning summaries ──
// Rendered inside "My bookings" for the signed-in student. Each card is the
// CLASS-LEVEL learning summary for a class the student attended — the same
// content for every attendee, with a fixed, visible scope note. It is never a
// personal assessment, never a score, never a ranking.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, GraduationCap, ChevronDown, ChevronUp, BookOpenCheck, RotateCcw, PencilRuler } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { CiStudentSummaryDTO, CiStudentSummariesResponse } from '@/lib/ci/dto'
import { formatClassInZone } from '@/components/bean/teach-format'

function SummaryCard({ item }: { item: CiStudentSummaryDTO }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.subject} · {formatClassInZone(item.startsAt, item.timeZone)}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground hover:bg-elevated" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          {open ? 'Close' : 'Open summary'}
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-4">
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <BookOpenCheck className="h-4 w-4 text-gold" aria-hidden /> What this class covered
            </h4>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.summary.lessonSummary}</p>
          </div>
          {item.summary.conceptsCovered.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground">Concepts covered</h4>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {item.summary.conceptsCovered.map((c) => (
                  <Badge key={c} variant="outline" className="border-border text-[11px] font-normal text-muted-foreground">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {item.summary.revisionRecommendations.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <RotateCcw className="h-4 w-4 text-gold" aria-hidden /> Worth revisiting
              </h4>
              <ul className="mt-1.5 list-disc pl-5 text-sm text-muted-foreground">
                {item.summary.revisionRecommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {item.summary.suggestedPractice.length > 0 && (
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <PencilRuler className="h-4 w-4 text-gold" aria-hidden /> Suggested practice
              </h4>
              <ul className="mt-1.5 list-disc pl-5 text-sm text-muted-foreground">
                {item.summary.suggestedPractice.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] italic text-muted-foreground/80">{item.summary.scopeNote}</p>
        </div>
      )}
    </div>
  )
}

export function StudentClassSummaries() {
  const [data, setData] = useState<CiStudentSummariesResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .ciStudentSummaries()
      .then((d) => {
        setData(d)
        setFailed(null)
      })
      .catch((e) => setFailed(e instanceof Error ? e.message : 'Could not load your class summaries.'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (failed) return null // the bookings panel remains fully usable — summaries are additive
  if (data === null) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-6" role="status" aria-label="Loading class summaries">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    )
  }
  if (data.summaries.length === 0) return null

  return (
    <section aria-label="Class learning summaries" className="rounded-xl border border-border bg-card p-4" data-ci-summaries={data.summaries.length}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <GraduationCap className="h-4 w-4 text-gold" aria-hidden /> Class learning summaries
        <span className="font-normal text-muted-foreground">({data.summaries.length})</span>
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Lesson summaries generated after each class ends — the same class-level material for everyone who attended, never an assessment of you.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {data.summaries.slice(0, 6).map((item) => (
          <SummaryCard key={item.bookingId} item={item} />
        ))}
      </div>
    </section>
  )
}

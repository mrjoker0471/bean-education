'use client'

// ─── BEAN Classroom Intelligence (CI-1D + CI-2D): student learning summaries ─
// Rendered inside "My bookings" for the signed-in student. Each card is the
// CLASS-LEVEL learning summary for a class the student attended — the same
// content for every attendee, with a fixed, visible scope note. It is never a
// personal assessment, never a score, never a ranking.
//
// CI-2D additions: each card links onward to the learning surfaces that
// ALREADY exist on BEAN (syllabus topics, exam practice, the personal
// Revision planner, curated official resources). Links are computed by the
// deterministic matcher in src/lib/ci/learning-links.ts — they are
// navigation, never a judgement about the individual student, and the card
// says so. The list keeps the full review history (expandable) with each
// summary's generated-at date.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, GraduationCap, ChevronDown, ChevronUp, BookOpenCheck, RotateCcw, PencilRuler, ExternalLink, ListChecks, Compass, Library, Link2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { CiStudentSummaryDTO, CiStudentSummariesResponse } from '@/lib/ci/dto'
import { formatClassInZone } from '@/components/bean/teach-format'
import { useAppStore, parseHash } from '@/lib/store'

const VISIBLE_CARDS = 6

function LinkRow({ href, label, detail, icon, external }: { href: string; label: string; detail: string; icon: React.ReactNode; external?: boolean }) {
  const navigate = useAppStore((s) => s.navigate)
  return external ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-2 rounded-lg border border-border bg-elevated/60 px-2.5 py-2 text-xs transition-colors hover:border-gold/40 hover:bg-gold/5"
    >
      <span className="mt-0.5 shrink-0 text-gold">{icon}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-medium text-foreground">
          {label} <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </a>
  ) : (
    <button
      type="button"
      onClick={() => navigate(parseHash(href))}
      className="flex w-full items-start gap-2 rounded-lg border border-border bg-elevated/60 px-2.5 py-2 text-left text-xs transition-colors hover:border-gold/40 hover:bg-gold/5"
    >
      <span className="mt-0.5 shrink-0 text-gold">{icon}</span>
      <span className="min-w-0">
        <span className="font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </button>
  )
}

function SummaryCard({ item }: { item: CiStudentSummaryDTO }) {
  const [open, setOpen] = useState(false)
  const links = item.learningLinks
  const hasLinks = links.syllabusTopics.length > 0 || links.practice.length > 0 || links.resources.length > 0
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.subject} · {formatClassInZone(item.startsAt, item.timeZone)} · summary generated {new Date(item.generatedAt).toLocaleDateString()}
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

          {hasLinks && (
            <div>
              <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Link2 className="h-4 w-4 text-gold" aria-hidden /> Continue learning on BEAN
              </h4>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                Navigation to existing BEAN study and practice pages matched to this class&apos;s concepts — for everyone who attended, not an
                assessment of you.
              </p>
              <div className="mt-2 flex flex-col gap-3">
                {links.syllabusTopics.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Library className="h-3 w-3" aria-hidden /> Related syllabus topics
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {links.syllabusTopics.map((t) => (
                        <LinkRow key={t.href + t.label} href={t.href} label={t.label} detail={t.detail} icon={<Library className="h-3.5 w-3.5" aria-hidden />} />
                      ))}
                    </div>
                  </div>
                )}
                {links.practice.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <ListChecks className="h-3 w-3" aria-hidden /> Practice &amp; revision
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {links.practice.map((p) => (
                        <LinkRow key={p.href + p.label} href={p.href} label={p.label} detail={p.detail} icon={p.href === '#/learning' ? <Compass className="h-3.5 w-3.5" aria-hidden /> : <ListChecks className="h-3.5 w-3.5" aria-hidden />} />
                      ))}
                    </div>
                  </div>
                )}
                {links.resources.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <ExternalLink className="h-3 w-3" aria-hidden /> Official resources
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {links.resources.map((r) => (
                        <LinkRow key={r.url + r.title} href={r.url} label={r.title} detail={`${r.provider} · ${r.accessType.toLowerCase()}`} icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden />} external />
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
  const [showAll, setShowAll] = useState(false)

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

  const visible = showAll ? data.summaries : data.summaries.slice(0, VISIBLE_CARDS)

  return (
    <section aria-label="Class learning summaries" className="rounded-xl border border-border bg-card p-4" data-ci-summaries={data.summaries.length}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <GraduationCap className="h-4 w-4 text-gold" aria-hidden /> Class learning summaries
        <span className="font-normal text-muted-foreground">({data.summaries.length})</span>
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Lesson summaries generated after each class ends — the same class-level material for everyone who attended, never an assessment of you. This
        list is your review history for attended classes.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {visible.map((item) => (
          <SummaryCard key={item.bookingId} item={item} />
        ))}
      </div>
      {data.summaries.length > VISIBLE_CARDS && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3 border-border text-muted-foreground hover:bg-elevated"
          onClick={() => setShowAll(!showAll)}
          aria-expanded={showAll}
        >
          {showAll ? 'Show recent summaries' : `Show all ${data.summaries.length} summaries`}
        </Button>
      )}
    </section>
  )
}

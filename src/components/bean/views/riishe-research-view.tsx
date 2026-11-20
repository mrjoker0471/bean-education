'use client'

// ─── Riishe Deep Research (Phase 3A) ─────────────────────────────────────────
// A persistent research workspace: the student describes WHAT to research
// (an examination, subject, topic, concept or specific question), optionally
// attaching their own analysed materials as context. Riishe plans searches,
// retrieves guarded external sources, checks them, and produces an organised,
// cited dossier — findings, source cards, conflict warnings, an honest
// missing-evidence trail, and (for examination runs) historical-question
// candidates that only a curator can carry into the question bank.
//
// Every number here comes from the session's real API record (searches used,
// fetches used, model calls). No fabricated progress, no fake confidence.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type {
  ExamListItem,
  MaterialListItemDTO,
  ResearchCandidateDTO,
  ResearchFindingDTO,
  ResearchSessionDetailDTO,
  ResearchSessionListItemDTO,
  ResearchSourceDTO,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RiisheChatPanel } from '@/components/bean/riishe-chat'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  ChevronRight,
  CircleAlert,
  Compass,
  FileText,
  Globe,
  History,
  Landmark,
  Loader2,
  ScrollText,
  ShieldQuestion,
  Sparkles,
  Trash2,
} from 'lucide-react'

const KINDS = [
  { value: 'EXAM_PYQ', label: 'Previous-year questions', hint: 'Discover real past questions, papers and answer keys for an examination.' },
  { value: 'TOPIC', label: 'Subject / topic', hint: 'Research a subject, chapter or topic across trustworthy sources.' },
  { value: 'QUESTION', label: 'Historical question', hint: 'Trace a specific known question to its source and context.' },
  { value: 'CONCEPT', label: 'Concept', hint: 'Explain a concept across multiple independent sources.' },
] as const

const SESSION_STATUS: Record<string, { label: string; cls: string }> = {
  QUEUED: { label: 'Queued', cls: 'border-border bg-elevated text-muted-foreground' },
  RESEARCHING: { label: 'Researching', cls: 'border-gold/40 bg-gold/10 text-gold' },
  COMPLETE: { label: 'Complete', cls: 'border-success/40 bg-success/10 text-success' },
  FAILED: { label: 'Failed', cls: 'border-destructive/40 bg-destructive/10 text-destructive' },
}

const SOURCE_CLASS: Record<string, { label: string; cls: string }> = {
  OFFICIAL_AUTHORITY: { label: 'Official authority', cls: 'border-success/40 bg-success/10 text-success' },
  GOV_INSTITUTIONAL: { label: 'Government / institutional', cls: 'border-gold/40 bg-gold/10 text-gold' },
  OPEN_LICENSED: { label: 'Open licence', cls: 'border-gold/25 bg-card text-foreground' },
  REPUTABLE_SECONDARY: { label: 'Reputable secondary', cls: 'border-gold/25 bg-card text-foreground' },
  UNVERIFIED: { label: 'Unverified', cls: 'border-border bg-elevated text-muted-foreground' },
}

const SOURCE_STATUS: Record<string, { label: string; cls: string }> = {
  DISCOVERED: { label: 'Discovered', cls: 'border-border bg-elevated text-muted-foreground' },
  RETRIEVED: { label: 'Retrieved', cls: 'border-gold/30 bg-gold/5 text-foreground' },
  CHECKED: { label: 'Content checked', cls: 'border-success/40 bg-success/10 text-success' },
  UNAVAILABLE: { label: 'Unavailable', cls: 'border-border bg-muted text-muted-foreground' },
}

const STAGE_STATE: Record<string, { icon: typeof Loader2; cls: string }> = {
  PENDING: { icon: CircleAlert, cls: 'text-muted-foreground' },
  RUNNING: { icon: Loader2, cls: 'text-gold animate-spin' },
  DONE: { icon: BadgeCheck, cls: 'text-success' },
  SKIPPED: { icon: CircleAlert, cls: 'text-muted-foreground' },
  FAILED: { icon: AlertTriangle, cls: 'text-destructive' },
}

function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    plan: 'Plan searches',
    search: 'Search sources',
    retrieve: 'Retrieve pages',
    documents: 'Your materials',
    check: 'Check content',
    candidates: 'Historical candidates',
    synthesize: 'Organise findings',
    summarize: 'Write summary',
    run: 'Run',
  }
  return map[stage] ?? stage
}

function classOf(cls: string | null | undefined) {
  return SOURCE_CLASS[cls ?? 'UNVERIFIED'] ?? SOURCE_CLASS.UNVERIFIED
}

function statusOf(s: string | null | undefined) {
  return SOURCE_STATUS[s ?? 'DISCOVERED'] ?? SOURCE_STATUS.DISCOVERED
}

/** Render [n] citation markers as gold chips (unresolvable markers stay plain). */
function CitationText({ text, maxOrdinal }: { text: string; maxOrdinal: number }) {
  const parts = useMemo(() => text.split(/(\[\d{1,2}\])/g), [text])
  return (
    <span className="whitespace-pre-wrap leading-relaxed">
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d{1,2})\]$/)
        if (m && Number(m[1]) >= 1 && Number(m[1]) <= maxOrdinal) {
          return (
            <span key={i} className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-gold/40 bg-gold/10 px-1 text-[10px] font-semibold text-gold">
              {m[1]}
            </span>
          )
        }
        return <span key={i}>{p}</span>
      })}
    </span>
  )
}

// ═══════════════════════════ HUB ═══════════════════════════

function ResearchHub() {
  const guestId = useAppStore(s => s.guestId)
  const navigate = useAppStore(s => s.navigate)
  const { toast } = useToast()

  const [exams, setExams] = useState<ExamListItem[] | null>(null)
  const [materials, setMaterials] = useState<MaterialListItemDTO[] | null>(null)
  const [sessions, setSessions] = useState<ResearchSessionListItemDTO[] | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [loadTick, setLoadTick] = useState(0)

  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('TOPIC')
  const [examSlug, setExamSlug] = useState('')
  const [subjectLabel, setSubjectLabel] = useState('')
  const [topicLabel, setTopicLabel] = useState('')
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')
  const [question, setQuestion] = useState('')
  const [focusNote, setFocusNote] = useState('')
  const [docIds, setDocIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!guestId) return
    let alive = true
    api.exams().then(d => alive && setExams(d.exams)).catch(() => alive && setExams([]))
    api.materials(guestId).then(d => alive && setMaterials(d.materials)).catch(() => alive && setMaterials([]))
    return () => {
      alive = false
    }
  }, [guestId])

  useEffect(() => {
    if (!guestId) return
    let alive = true
    api
      .researchSessions(guestId)
      .then(d => alive && setSessions(d.sessions))
      .catch((e: unknown) => {
        if (!alive) return
        setSessions([])
        setSessionsError(e instanceof Error ? e.message : 'Could not load research sessions.')
      })
    return () => {
      alive = false
    }
  }, [guestId, loadTick])

  const readyMaterials = (materials ?? []).filter(m => m.status === 'READY')

  const start = () => {
    if (!guestId || busy) return
    setFormError(null)
    const hasScope = examSlug || subjectLabel || topicLabel || question.trim()
    if (!hasScope) {
      setFormError('Describe what to research — pick an examination, or enter a subject/topic or your research question.')
      return
    }
    if ((kind === 'QUESTION' || kind === 'TOPIC' || kind === 'CONCEPT') && !question.trim() && !subjectLabel.trim() && !topicLabel.trim()) {
      setFormError('Enter the research question or the subject/topic to research.')
      return
    }
    setBusy(true)
    api
      .researchStart({
        guestId,
        kind,
        examSlug: examSlug || undefined,
        subjectLabel: subjectLabel.trim() || undefined,
        topicLabel: topicLabel.trim() || undefined,
        yearFrom: yearFrom ? Number(yearFrom) : undefined,
        yearTo: yearTo ? Number(yearTo) : undefined,
        question: question.trim() || undefined,
        focusNote: focusNote.trim() || undefined,
        documentIds: docIds.length ? docIds : undefined,
      })
      .then(r => {
        toast({ title: 'Research started', description: 'Riishe is planning searches now — this usually takes a couple of minutes.' })
        navigate({ view: 'riishe-research-session', sessionId: r.sessionId })
      })
      .catch((e: unknown) => {
        setFormError(e instanceof Error ? e.message : 'Could not start the research run.')
      })
      .finally(() => setBusy(false))
  }

  const remove = (id: string) => {
    if (!guestId) return
    setDeletingId(id)
    api
      .researchDelete(id, guestId)
      .then(() => {
        setSessions(prev => (prev ?? []).filter(s => s.id !== id))
        toast({ title: 'Research session removed' })
      })
      .catch((e: unknown) => toast({ title: 'Could not remove the session', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }))
      .finally(() => setDeletingId(null))
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <button
          onClick={() => navigate({ view: 'riishe' })}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground hover:text-gold"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Riishe AI
        </button>
        <h1 className="mt-3 flex items-center gap-3 font-display text-3xl font-bold text-foreground sm:text-4xl">
          <Compass className="h-7 w-7 text-gold" aria-hidden /> Deep Research
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Riishe plans searches, retrieves real sources, verifies what it can, and organises a cited research dossier in your
          workspace. Historical-question candidates always go through human curation before anything enters the question bank.
        </p>
      </header>

      {/* ── New research form ── */}
      <section aria-labelledby="new-research" className="mt-8 rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 id="new-research" className="font-display text-lg font-semibold text-foreground">
          Start a research run
        </h2>
        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Research type">
          {KINDS.map(k => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                kind === k.value ? 'border-gold/50 bg-gold/10 text-gold' : 'border-border bg-elevated text-muted-foreground hover:text-foreground',
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{KINDS.find(k => k.value === kind)?.hint}</p>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(kind === 'EXAM_PYQ' || kind === 'QUESTION') && (
            <div>
              <Label htmlFor="research-exam" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Examination {kind === 'EXAM_PYQ' ? '(required)' : '(if known)'}
              </Label>
              <select
                id="research-exam"
                value={examSlug}
                onChange={e => setExamSlug(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-elevated px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              >
                <option value="">Choose an examination…</option>
                {(exams ?? []).map(ex => (
                  <option key={ex.slug} value={ex.slug}>
                    {ex.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {kind === 'EXAM_PYQ' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="research-year-from" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Year from
                </Label>
                <Input
                  id="research-year-from"
                  type="number"
                  min={1990}
                  max={2035}
                  value={yearFrom}
                  onChange={e => setYearFrom(e.target.value)}
                  placeholder="e.g. 2015"
                  className="mt-1.5 bg-elevated"
                />
              </div>
              <div>
                <Label htmlFor="research-year-to" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Year to
                </Label>
                <Input
                  id="research-year-to"
                  type="number"
                  min={1990}
                  max={2035}
                  value={yearTo}
                  onChange={e => setYearTo(e.target.value)}
                  placeholder="e.g. 2024"
                  className="mt-1.5 bg-elevated"
                />
              </div>
            </div>
          )}
          {(kind === 'TOPIC' || kind === 'EXAM_PYQ') && (
            <div>
              <Label htmlFor="research-subject" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Subject (optional)
              </Label>
              <Input id="research-subject" value={subjectLabel} onChange={e => setSubjectLabel(e.target.value)} placeholder="e.g. General Studies" className="mt-1.5 bg-elevated" />
            </div>
          )}
          {kind === 'TOPIC' && (
            <div>
              <Label htmlFor="research-topic" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Chapter / topic (optional)
              </Label>
              <Input id="research-topic" value={topicLabel} onChange={e => setTopicLabel(e.target.value)} placeholder="e.g. Indian monsoon" className="mt-1.5 bg-elevated" />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="research-question" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Research question {kind === 'QUESTION' || kind === 'CONCEPT' ? '(required)' : '(optional focus)'}
            </Label>
            <Textarea
              id="research-question"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              maxLength={600}
              rows={2}
              placeholder={kind === 'CONCEPT' ? 'e.g. How do judicial reviews differ between UPSC and SSC examinations?' : 'What should this research establish?'}
              className="mt-1.5 bg-elevated"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="research-focus" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Anything specific to prioritise (optional)
            </Label>
            <Input id="research-focus" value={focusNote} onChange={e => setFocusNote(e.target.value)} maxLength={300} placeholder="e.g. focus on official answer keys" className="mt-1.5 bg-elevated" />
          </div>
        </div>

        {readyMaterials.length > 0 && (
          <fieldset className="mt-5">
            <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attach your analysed materials (optional, up to 3)</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {readyMaterials.slice(0, 8).map(m => {
                const active = docIds.includes(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDocIds(prev => (active ? prev.filter(id => id !== m.id) : prev.length >= 3 ? prev : [...prev, m.id]))}
                    className={cn(
                      'max-w-[260px] truncate rounded-full border px-3 py-1.5 text-xs',
                      active ? 'border-gold/50 bg-gold/10 text-gold' : 'border-border bg-elevated text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <FileText className="mr-1.5 inline h-3 w-3" aria-hidden />
                    {m.title}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}

        {formError && (
          <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={start} disabled={busy || !guestId} className="bg-gold text-primary-foreground hover:bg-gold-hover">
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Starting…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden /> Start research
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">Runs are limited to 6 per hour — each run plans real searches and retrieves real pages.</p>
        </div>
      </section>

      {/* ── Session history ── */}
      <section aria-labelledby="research-history" className="mt-8">
        <h2 id="research-history" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <History className="h-5 w-5 text-gold" aria-hidden /> Your research sessions
        </h2>
        {!guestId ? (
          <p className="mt-3 text-sm text-muted-foreground">Sign in or open Riishe from the same browser to keep a research history.</p>
        ) : sessionsError ? (
          <div role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {sessionsError}
          </div>
        ) : sessions === null ? (
          <div className="mt-3 space-y-2" aria-hidden>
            <div className="h-16 animate-pulse rounded-lg bg-elevated" />
            <div className="h-16 animate-pulse rounded-lg bg-elevated" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No research yet. Start your first run above — the dossier will stay in this workspace.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {sessions.map(s => {
              const st = SESSION_STATUS[s.status] ?? SESSION_STATUS.QUEUED
              const active = s.status === 'QUEUED' || s.status === 'RESEARCHING'
              return (
                <li key={s.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      onClick={() => navigate({ view: 'riishe-research-session', sessionId: s.id })}
                      className="min-w-0 flex-1 text-left"
                      aria-label={`Open research session: ${s.title}`}
                    >
                      <p className="truncate text-sm font-semibold text-foreground">{s.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(s.createdAt).toLocaleString()} · {s.sourcesCount} source{s.sourcesCount === 1 ? '' : 's'}
                        {s.candidatesCount > 0 ? ` · ${s.candidatesCount} candidate${s.candidatesCount === 1 ? '' : 's'}` : ''}
                        {s.progress ? ` · ${s.progress.searchesUsed} searches · ${s.progress.fetchesUsed} fetches` : ''}
                      </p>
                      {s.statusDetail && <p className="mt-1 text-xs text-destructive">{s.statusDetail}</p>}
                    </button>
                    <div className="flex items-center gap-2">
                      <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide', st.cls)}>
                        {active && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />}
                        {st.label}
                      </span>
                      {!active && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-border bg-card text-muted-foreground hover:bg-elevated hover:text-foreground"
                          onClick={() => remove(s.id)}
                          disabled={deletingId === s.id}
                          aria-label={`Delete research session: ${s.title}`}
                        >
                          {deletingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
                        </Button>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

// ═══════════════════════════ WORKSPACE ═══════════════════════════

function ResearchWorkspace({ sessionId }: { sessionId: string }) {
  const guestId = useAppStore(s => s.guestId)
  const navigate = useAppStore(s => s.navigate)
  const { toast } = useToast()
  const [detail, setDetail] = useState<ResearchSessionDetailDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [discardingId, setDiscardingId] = useState<string | null>(null)

  useEffect(() => {
    if (!guestId || !sessionId) return
    let alive = true
    api
      .researchSession(sessionId, guestId)
      .then(d => {
        if (!alive) return
        setDetail(d)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not load the research session.')
        setDetail(null)
      })
    return () => {
      alive = false
    }
  }, [guestId, sessionId, tick])

  const status = detail?.session.status
  useEffect(() => {
    if (status !== 'QUEUED' && status !== 'RESEARCHING') return
    const t = setInterval(() => setTick(v => v + 1), 5000)
    return () => clearInterval(t)
  }, [status])

  const discardCandidate = useCallback(
    (candidate: ResearchCandidateDTO) => {
      if (!guestId) return
      setDiscardingId(candidate.id)
      api
        .pyqCandidateDiscard(candidate.id, { guestId })
        .then(() => {
          toast({ title: 'Candidate discarded' })
          setTick(v => v + 1)
        })
        .catch((e: unknown) => toast({ title: 'Could not discard', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }))
        .finally(() => setDiscardingId(null))
    },
    [guestId, toast],
  )

  if (!guestId) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Open Riishe from the same browser to view this research session.
        </p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-5 text-sm text-destructive">
          {error}
          <div className="mt-3">
            <Button variant="outline" size="sm" className="border-border bg-card text-muted-foreground" onClick={() => setTick(v => v + 1)}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    )
  }
  if (!detail) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-10 sm:px-6 lg:px-8" aria-hidden>
        <div className="h-8 w-1/3 animate-pulse rounded bg-elevated" />
        <div className="h-24 animate-pulse rounded-xl bg-elevated" />
        <div className="h-40 animate-pulse rounded-xl bg-elevated" />
      </div>
    )
  }

  const { session, sources, candidates } = detail
  const webSources = sources.filter(s => s.kind === 'web')
  const docSources = sources.filter(s => s.kind === 'document')
  const maxOrdinal = sources.length
  const running = session.status === 'QUEUED' || session.status === 'RESEARCHING'
  const st = SESSION_STATUS[session.status] ?? SESSION_STATUS.QUEUED

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <button
          onClick={() => navigate({ view: 'riishe-research' })}
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground hover:text-gold"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All research
        </button>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="min-w-0 font-display text-2xl font-bold text-foreground sm:text-3xl">{session.title}</h1>
          <span className={cn('rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide', st.cls)}>
            {running && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />}
            {st.label}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border bg-elevated px-2.5 py-1">{KINDS.find(k => k.value === session.kind)?.label ?? session.kind}</span>
          {session.input.examLabel && <span className="rounded-full border border-border bg-elevated px-2.5 py-1">{session.input.examLabel}</span>}
          {session.input.subjectLabel && <span className="rounded-full border border-border bg-elevated px-2.5 py-1">{session.input.subjectLabel}</span>}
          {(session.input.yearFrom || session.input.yearTo) && (
            <span className="rounded-full border border-border bg-elevated px-2.5 py-1">
              Years {session.input.yearFrom ?? 'any'}–{session.input.yearTo ?? 'any'}
            </span>
          )}
        </div>
        {session.statusDetail && (
          <p role="alert" className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {session.statusDetail}
          </p>
        )}
      </header>

      {/* ── Honest progress ── */}
      {session.progress && (
        <section aria-label="Research progress" className="mt-6 rounded-xl border border-border bg-card p-5">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {session.progress.stages.map(stage => {
              const meta = STAGE_STATE[stage.state] ?? STAGE_STATE.PENDING
              const Icon = meta.icon
              return (
                <li key={stage.stage} className="flex items-center gap-2.5 text-sm">
                  <Icon className={cn('h-4 w-4 shrink-0', meta.cls)} aria-hidden />
                  <span className="text-foreground">{stageLabel(stage.stage)}</span>
                  {stage.detail && <span className="min-w-0 truncate text-xs text-muted-foreground">— {stage.detail}</span>}
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Real work used: {session.searchesUsed} live search{session.searchesUsed === 1 ? '' : 'es'} · {session.fetchesUsed} page fetch{session.fetchesUsed === 1 ? '' : 'es'} ·{' '}
            {session.llmCallsUsed} model call{session.llmCallsUsed === 1 ? '' : 's'}
          </p>
        </section>
      )}

      {/* ── Missing-evidence notice (honest) ── */}
      {session.status === 'COMPLETE' && session.findings.some(f => f.citationIds.length === 0) && (
        <div role="status" className="mt-4 rounded-lg border border-gold/30 bg-gold/5 px-4 py-3 text-sm text-foreground">
          <AlertTriangle className="mr-2 inline h-4 w-4 text-gold" aria-hidden />
          Some parts of the scope had no retrieved evidence — they are marked plainly in the findings below. Treat those areas as unresearched, not as answered.
        </div>
      )}

      {/* ── Summary ── */}
      {session.summary && (
        <section aria-labelledby="research-summary" className="mt-6 rounded-xl border border-gold/30 bg-card p-5 sm:p-6">
          <h2 id="research-summary" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
            <ScrollText className="h-5 w-5 text-gold" aria-hidden /> Research summary
          </h2>
          <div className="mt-3 text-sm text-foreground">
            <CitationText text={session.summary.text} maxOrdinal={maxOrdinal} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Citations [n] refer to the numbered source cards below. Generated {new Date(session.summary.generatedAt).toLocaleString()}.
          </p>
        </section>
      )}

      {/* ── Findings ── */}
      {session.findings.length > 0 && (
        <section aria-labelledby="research-findings" className="mt-6">
          <h2 id="research-findings" className="font-display text-lg font-semibold text-foreground">
            Findings by topic
          </h2>
          <div className="mt-3 space-y-3">
            {session.findings.map((f: ResearchFindingDTO) => (
              <article key={f.topic} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <h3 className="text-sm font-semibold text-foreground">{f.topic}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  <CitationText text={f.summary} maxOrdinal={maxOrdinal} />
                </p>
                {f.conflict && (
                  <p className="mt-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-foreground">
                    <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-gold" aria-hidden />
                    <strong className="font-semibold">Conflicting sources (AI-flagged):</strong> {f.conflict}
                  </p>
                )}
                {f.citationIds.length === 0 && (
                  <p className="mt-3 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted-foreground">
                    No retrieved evidence addressed this — treated as unresearched.
                  </p>
                )}
                {f.citationIds.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Cites source{f.citationIds.length === 1 ? '' : 's'} {f.citationIds.map(n => `[${n}]`).join(' ')}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ── Sources ── */}
      {sources.length > 0 && (
        <section aria-labelledby="research-sources" className="mt-6">
          <h2 id="research-sources" className="font-display text-lg font-semibold text-foreground">
            Sources ({sources.length})
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your uploaded materials are kept separate from external web evidence. Classification needs BOTH the domain hint and a
            content check — a plausible-looking domain alone never makes a source official.
          </p>
          {webSources.length > 0 && (
            <>
              <h3 className="mt-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Globe className="h-3.5 w-3.5" aria-hidden /> External web sources
              </h3>
              <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {webSources.map(s => (
                  <SourceCard key={s.id} source={s} />
                ))}
              </div>
            </>
          )}
          {docSources.length > 0 && (
            <>
              <h3 className="mt-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <BookOpen className="h-3.5 w-3.5" aria-hidden /> Your uploaded materials
              </h3>
              <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {docSources.map(s => (
                  <SourceCard key={s.id} source={s} />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Historical-question candidates ── */}
      {(candidates.length > 0 || session.kind === 'EXAM_PYQ') && (
        <section aria-labelledby="research-candidates" className="mt-6">
          <h2 id="research-candidates" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
            <ShieldQuestion className="h-5 w-5 text-gold" aria-hidden /> Historical-question candidates
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Candidates are pointers, not verified questions. Nothing becomes a question-bank PYQ until a curator checks the source and
            reviews it in PYQ Studio — AI confidence is never verification.
          </p>
          {candidates.length === 0 ? (
            <p className="mt-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              {running
                ? 'Candidate discovery runs after the sources are checked.'
                : 'No candidates passed the source check for this run. Only sources classified as official, government, or open-licensed are mined for historical questions.'}
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {candidates.map(c => (
                <CandidateCard key={c.id} candidate={c} onDiscard={() => discardCandidate(c)} discarding={discardingId === c.id} canDiscard={c.status !== 'PROMOTED'} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Follow-up chat (completed runs only) ── */}
      {session.status === 'COMPLETE' && (
        <section aria-label="Research follow-up questions" className="mt-8">
          {session.followUps.length > 0 && (
            <div className="mb-3 rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Suggested follow-ups</p>
              <ul className="mt-2 space-y-1.5">
                {session.followUps.map(q => (
                  <li key={q} className="flex items-start gap-2 text-sm text-foreground">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden /> {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <RiisheChatPanel
            guestId={guestId}
            scope={{ researchSessionId: session.id }}
            greeting="Ask follow-up questions about this research — answers are grounded in the dossier."
            placeholder="Ask about this research…"
          />
        </section>
      )}
    </div>
  )
}

// ── Source card ───────────────────────────────────────────────────────────────

function SourceCard({ source: s }: { source: ResearchSourceDTO }) {
  const cls = classOf(s.sourceClass)
  const st = statusOf(s.status)
  return (
    <article className={cn('rounded-xl border bg-card p-4', s.conflictFlag ? 'border-gold/50' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cls.cls)}>{cls.label}</span>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', st.cls)}>{st.label}</span>
        {s.contentKind && <span className="rounded-full border border-border bg-elevated px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{s.contentKind}</span>}
        {s.conflictFlag && (
          <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
            <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden /> conflict flagged
          </span>
        )}
      </div>
      <h4 className="mt-2 text-sm font-semibold text-foreground">{s.title ?? s.url}</h4>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="truncate">{s.host}</span>
        {s.publishedDate && <span>published: {s.publishedDate}</span>}
        {s.retrievedAt && <span>retrieved: {new Date(s.retrievedAt).toLocaleDateString()}</span>}
        {s.httpStatus !== null && <span>HTTP {s.httpStatus}</span>}
      </p>
      {s.kind === 'web' ? (
        <a
          href={s.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-gold underline-offset-2 hover:underline"
        >
          <Landmark className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{s.url}</span>
        </a>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">Evidence from your own uploaded material — never shared with anyone else.</p>
      )}
      {s.classReason && <p className="mt-1.5 text-xs italic text-muted-foreground">{s.classReason}</p>}
      {s.evidence.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {s.evidence.map((e, i) => (
            <li key={i} className="rounded-lg border border-border bg-elevated px-3 py-2">
              <blockquote className="text-xs leading-relaxed text-foreground">&ldquo;{e.excerpt}&rdquo;</blockquote>
              {(e.pageRef || e.subtopic) && (
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {[e.pageRef, e.subtopic].filter(Boolean).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : s.status === 'UNAVAILABLE' ? (
        <p className="mt-3 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {typeof s.notes?.unavailableReason === 'string' ? `Could not retrieve: ${s.notes.unavailableReason}` : 'Could not retrieve this source.'}
        </p>
      ) : s.status !== 'CHECKED' ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {s.snippet ? `Search snippet: "${s.snippet.slice(0, 180)}"` : 'Content not retrieved — classified from search metadata only.'}
        </p>
      ) : null}
    </article>
  )
}

// ── Candidate card ────────────────────────────────────────────────────────────

function CandidateCard({
  candidate: c,
  onDiscard,
  discarding,
  canDiscard,
}: {
  candidate: ResearchCandidateDTO
  onDiscard: () => void
  discarding: boolean
  canDiscard: boolean
}) {
  return (
    <article className={cn('rounded-xl border bg-card p-4 sm:p-5', c.status === 'PROMOTED' ? 'border-success/40' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            c.status === 'PROMOTED' ? 'border-success/40 bg-success/10 text-success' : 'border-gold/40 bg-gold/10 text-gold',
          )}
        >
          {c.status === 'PROMOTED' ? 'In curator review' : 'Discovered candidate'}
        </span>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            c.rightsStatus === 'VERBATIM_PERMITTED' ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-elevated text-muted-foreground',
          )}
        >
          {c.rightsStatus === 'VERBATIM_PERMITTED' ? 'verbatim stored (licenced source)' : 'reference-only'}
        </span>
        {c.proposedCorrectIndex !== null && (
          <span className="rounded-full border border-gold/30 bg-gold/5 px-2 py-0.5 text-[10px] text-foreground">answer key supports option {c.proposedCorrectIndex + 1}</span>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {[
          c.examLabel,
          c.subjectLabel,
          c.year ? String(c.year) : null,
          c.sessionLabel,
          c.questionNumber ? `Q ${c.questionNumber}` : null,
          c.locator && !c.questionNumber ? c.locator : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'provenance incomplete — shown honestly'}
      </p>
      {c.paperTitle && <p className="mt-0.5 text-xs text-muted-foreground">Paper: {c.paperTitle}</p>}
      <p className="mt-0.5 text-xs text-muted-foreground">
        Source: {c.sourcePublisher ?? c.sourceUrl} · retrieved {c.retrievedAt ? new Date(c.retrievedAt).toLocaleDateString() : 'unknown'}
      </p>
      <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-gold underline-offset-2 hover:underline">
        <Landmark className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">{c.sourceUrl}</span>
      </a>

      {c.evidence.length > 0 && (
        <blockquote className="mt-3 rounded-lg border border-border bg-elevated px-3 py-2 text-xs leading-relaxed text-foreground">
          &ldquo;{c.evidence[0].excerpt}&rdquo;
          {c.evidence[0].pageRef && <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground">{c.evidence[0].pageRef}</span>}
        </blockquote>
      )}
      {c.verificationNote && <p className="mt-2 text-xs italic text-muted-foreground">{c.verificationNote}</p>}
      {c.conflictNote && (
        <p className="mt-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-gold" aria-hidden /> {c.conflictNote}
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {c.rightsStatus === 'VERBATIM_PERMITTED'
          ? 'The source carries an explicit reuse licence, so the verbatim text is stored for the curator.'
          : 'No reuse licence was detected, so only the locator and short evidence excerpts are stored — the curator reads the source directly.'}
        {c.rightsNote ? ` (${c.rightsNote})` : ''}
      </p>

      {canDiscard && (
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            className="border-border bg-card text-muted-foreground hover:bg-elevated hover:text-foreground"
            onClick={onDiscard}
            disabled={discarding}
            aria-label="Discard this candidate"
          >
            {discarding ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden />}
            Discard
          </Button>
        </div>
      )}
    </article>
  )
}

// ═══════════════════════════ Entry ═══════════════════════════

export function RiisheResearchView({ sessionId }: { sessionId?: string }) {
  return sessionId ? <ResearchWorkspace sessionId={sessionId} /> : <ResearchHub />
}

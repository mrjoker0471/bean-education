'use client'

// ─── PYQ Curation Studio (Phase 2B, Milestone F) ───────────────────────────────
// The curator/admin workspace over the Phase 2A PYQ APIs:
//   POST /api/pyq/import     — structured JSON import (curator-only)
//   GET  /api/pyq/batches    — import history (curator-only)
//   POST /api/pyq/review     — approve/reject with justification (curator-only)
//   GET  /api/pyq/questions  — provenance-complete listing (Phase 2B)
//
// Integrity rules the UI makes explicit (the server enforces them regardless):
//   • Imported questions stay UNVERIFIED until an authorised curator approves
//     them with a written justification (10..400 chars).
//   • Rejection requires an explicit confirmation; rejected rows never appear
//     in practice tests.
//   • AI-generated (ORIGINAL) rows are never shown here and can never be
//     relabelled as historical questions.
//   • Years and source references come from the file/batch — never invented.
//   • Honest zero state when no verified PYQs exist.
//
// KNOWN CATALOGUE LIMITATION (kept honest in the UI): the current PYQ database
// requires a catalogue `examSlug`, so every import must attach to an existing
// catalogue exam entry. College/university semester papers and generic course
// assessments cannot be represented yet — documented in docs/PHASE2B_PYQ_CURATOR.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/bean/empty-state'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import { formatDate } from '@/components/bean/format'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { optionLetter } from '@/components/bean/format'
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  History,
  Landmark,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react'
import type {
  ExamListItem,
  PyqBatchDTO,
  PyqCandidateRowDTO,
  PyqImportResult,
  PyqQuestionDTO,
  PyqCandidatesResponse,
  PyqVerificationStatus,
} from '@/lib/types'

// ─── Client-side pre-flight (mirror of the server row rules — a convenience,
// the server stays authoritative) ──────────────────────────────────────────────
interface PreflightError {
  row: number
  error: string
}

const YEAR_MIN = 1990
const YEAR_MAX = 2035

function preflightRow(item: unknown, row: number): string | null {
  const fail = (msg: string) => `row ${row}: ${msg}`
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return fail('not an object')
  const o = item as Record<string, unknown>
  if (typeof o.text !== 'string') return fail('text must be a string')
  const text = o.text.trim()
  if (text.length < 10 || text.length > 2000) return fail(`text must be 10..2000 chars (got ${text.length})`)
  if (!Array.isArray(o.options)) return fail('options must be an array')
  if (o.options.length < 2 || o.options.length > 6) return fail(`options must have 2..6 items (got ${(o.options as unknown[]).length})`)
  for (let i = 0; i < (o.options as unknown[]).length; i++) {
    const opt = (o.options as unknown[])[i]
    if (typeof opt !== 'string' || !opt.trim()) return fail(`option ${i} must be a non-empty string`)
  }
  const ci = o.correctIndex
  if (typeof ci !== 'number' || !Number.isInteger(ci) || ci < 0 || ci >= (o.options as unknown[]).length) {
    return fail(`correctIndex must be an integer in [0, ${(o.options as unknown[]).length - 1}]`)
  }
  if (o.difficulty !== undefined && o.difficulty !== null && !['EASY', 'MEDIUM', 'HARD'].includes(o.difficulty as string)) {
    return fail('difficulty must be EASY, MEDIUM or HARD')
  }
  if (o.year !== undefined && o.year !== null) {
    if (typeof o.year !== 'number' || !Number.isInteger(o.year) || o.year < YEAR_MIN || o.year > YEAR_MAX) {
      return fail(`year must be an integer ${YEAR_MIN}..${YEAR_MAX}`)
    }
  }
  return null
}

function StatusBadge({ status }: { status: PyqVerificationStatus }) {
  const meta =
    status === 'VERIFIED'
      ? { label: 'Verified', className: 'border-success/40 text-success bg-success/10', icon: <CheckCircle2 className="h-3 w-3" /> }
      : status === 'REJECTED'
        ? { label: 'Rejected', className: 'border-destructive/40 text-destructive bg-destructive/10', icon: <XCircle className="h-3 w-3" /> }
        : { label: 'Unverified', className: 'border-gold/40 text-gold bg-gold/10', icon: <AlertTriangle className="h-3 w-3" /> }
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.className)}>
      {meta.icon} {meta.label}
    </span>
  )
}

// ─── Gate: the studio is role-gated; the UI mirrors (never replaces) the server ─┐

export function PyqStudioView() {
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const navigate = useAppStore(s => s.navigate)

  if (!authChecked) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading PYQ studio">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <ShieldAlert className="mb-4 h-10 w-10 text-gold" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Curators only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          PYQ curation is restricted to authorised curator accounts. Sign in with a curator or admin role to continue.
        </p>
        <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>
          Sign in
        </Button>
      </div>
    )
  }
  const isCurator = authedStudent.role === 'PYQ_CURATOR' || authedStudent.role === 'ADMIN'
  if (!isCurator) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <ShieldAlert className="mb-4 h-10 w-10 text-gold" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Not authorised</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account ({authedStudent.email}) holds the <span className="text-foreground">{authedStudent.role}</span> role.
          PYQ curation requires PYQ_CURATOR or ADMIN — the server enforces this on every request, and roles can only be
          granted by BEAN operators through a secure CLI.
        </p>
        <Button variant="outline" className="mt-6 border-border text-muted-foreground hover:bg-elevated" onClick={() => navigate({ view: 'dashboard' })}>
          Back to dashboard
        </Button>
      </div>
    )
  }
  return <StudioPanel role={authedStudent.role} />
}

// ─── The studio itself ─────────────────────────────────────────────────────────

function StudioPanel({ role }: { role: string }) {
  const [tab, setTab] = useState<'import' | 'review' | 'candidates' | 'history'>('import')
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header>
        <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> PYQ curation studio · your role: {role}
        </p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">PYQ Studio</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Import structured previous-year question papers and review them into the verified bank. Every action here is
          attributed to your account and written to the audit trail.
        </p>
        <Alert className="mt-4 border-gold/30 bg-gold/5">
          <AlertDescription className="text-xs leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Catalogue limitation (honest):</strong> imports must attach to an
            existing catalogue exam entry (<code>examSlug</code>). College/university semester papers and generic course
            assessments cannot be represented in the PYQ database yet — that is documented future work, not something
            this workspace pretends to support.
          </AlertDescription>
        </Alert>
      </header>

      <Tabs value={tab} onValueChange={v => setTab(v === 'review' ? 'review' : v === 'candidates' ? 'candidates' : v === 'history' ? 'history' : 'import')} className="mt-6">
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="review">Review queue</TabsTrigger>
          <TabsTrigger value="candidates">Candidates</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'import' && <ImportTab onImported={() => setReloadKey(k => k + 1)} />}
      {tab === 'review' && <ReviewTab key={reloadKey} onChanged={() => setReloadKey(k => k + 1)} />}
      {tab === 'candidates' && <CandidatesTab key={reloadKey} onChanged={() => setReloadKey(k => k + 1)} />}
      {tab === 'history' && <HistoryTab />}
    </div>
  )
}

// ─── Import tab ────────────────────────────────────────────────────────────────

interface ParsedFile {
  fileName: string
  items: Record<string, unknown>[]
  payloadMeta: {
    paperTitle?: unknown
    examSlug?: unknown
    year?: unknown
    session?: unknown
    sourceCitation?: unknown
  }
}

function ImportTab({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<ParsedFile | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [exams, setExams] = useState<ExamListItem[]>([])
  const [examsLoaded, setExamsLoaded] = useState(false)

  const [paperTitle, setPaperTitle] = useState('')
  const [examSlug, setExamSlug] = useState('')
  const [year, setYear] = useState('')
  const [session, setSession] = useState('')
  const [stageLabel, setStageLabel] = useState('')
  const [subjectLabel, setSubjectLabel] = useState('')
  const [sourceCitation, setSourceCitation] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<PyqImportResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    api
      .exams()
      .then(res => !cancelled && setExams(res.exams))
      .catch(() => undefined)
      .finally(() => !cancelled && setExamsLoaded(true))
    return () => {
      cancelled = true
    }
  }, [])

  const preflightErrors: PreflightError[] = useMemo(() => {
    if (!file) return []
    const errors: PreflightError[] = []
    file.items.forEach((item, i) => {
      const err = preflightRow(item, i)
      if (err) errors.push({ row: i, error: err })
    })
    return errors
  }, [file])

  const onFilePicked = async (f: File) => {
    setParseError(null)
    setResult(null)
    setFile(null)
    try {
      const text = await f.text()
      const parsed: unknown = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The JSON root must be an object with an "items" array.')
      }
      const obj = parsed as Record<string, unknown>
      if (!Array.isArray(obj.items)) throw new Error('Missing "items" array — the file must contain { items: [...] }.')
      if (obj.items.length === 0) throw new Error('"items" is empty — there is nothing to import.')
      if (obj.items.length > 500) throw new Error(`"items" is capped at 500 rows per import (got ${obj.items.length}).`)
      setFile({
        fileName: f.name,
        items: obj.items as Record<string, unknown>[],
        payloadMeta: {
          paperTitle: obj.paperTitle,
          examSlug: obj.examSlug,
          year: obj.year,
          session: obj.session,
          sourceCitation: obj.sourceCitation,
        },
      })
      // Pre-fill metadata from the file when present (form stays authoritative).
      if (typeof obj.paperTitle === 'string' && !paperTitle) setPaperTitle(obj.paperTitle)
      if (typeof obj.examSlug === 'string' && !examSlug) setExamSlug(obj.examSlug)
      if (typeof obj.year === 'number' && !year) setYear(String(obj.year))
      if (typeof obj.session === 'string' && !session) setSession(obj.session)
      if (typeof obj.sourceCitation === 'string' && !sourceCitation) setSourceCitation(obj.sourceCitation)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Could not parse the file as JSON.')
    }
  }

  const submit = async () => {
    if (!file || submitting) return
    if (paperTitle.trim().length < 3) {
      setSubmitError('Paper title must be at least 3 characters.')
      return
    }
    if (!examSlug) {
      setSubmitError('Select the catalogue exam this paper belongs to — PYQ rows must attach to a real exam entry.')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await api.pyqImport({
        paperTitle: paperTitle.trim(),
        fileName: file.fileName,
        examSlug,
        year: year ? Number(year) : undefined,
        session: session.trim() || undefined,
        stageLabel: stageLabel.trim() || undefined,
        subjectLabel: subjectLabel.trim() || undefined,
        sourceCitation: sourceCitation.trim() || undefined,
        items: file.items,
      })
      setResult(res)
      onImported()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Import failed — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedExam = exams.find(e => e.slug === examSlug)

  return (
    <div className="mt-6 space-y-6">
      {/* File picker */}
      <section aria-label="Structured JSON file" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <FileJson className="h-4 w-4 text-gold" aria-hidden /> 1 · Structured JSON file
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The file must contain an <code>items</code> array (max 500 rows). Each row: <code>text</code>,
          <code> options</code> (2–6 strings), <code>correctIndex</code>, optionally <code>explanation</code>,
          <code> difficulty</code>, <code>year</code>, <code>sourceRef</code>. Only import papers you have the rights to
          use — never scrape copyrighted question papers.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Structured PYQ JSON file"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void onFilePicked(f)
            }}
          />
          <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" aria-hidden /> Choose JSON file
          </Button>
          {file && (
            <span className="text-sm text-muted-foreground">
              <span className="text-foreground">{file.fileName}</span> · {file.items.length} row{file.items.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {parseError && (
          <Alert variant="destructive" className="mt-4" role="alert">
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        )}
        {file && preflightErrors.length > 0 && (
          <Alert variant="destructive" className="mt-4" role="alert">
            <AlertDescription>
              <strong>{preflightErrors.length} row{preflightErrors.length === 1 ? '' : 's'} will fail validation:</strong>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs">
                {preflightErrors.slice(0, 20).map(e => (
                  <li key={e.row}>{e.error}</li>
                ))}
                {preflightErrors.length > 20 && <li>… and {preflightErrors.length - 20} more</li>}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        {file && preflightErrors.length === 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> All {file.items.length} rows pass the local sanity checks. The server re-validates everything.
          </p>
        )}
      </section>

      {/* Metadata */}
      <section aria-label="Paper metadata" className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">2 · Paper metadata</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Provenance is part of the record: never invent a year or a source citation — leave a field empty instead of
          guessing.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pyq-paper-title">Paper title</Label>
            <Input id="pyq-paper-title" value={paperTitle} onChange={e => setPaperTitle(e.target.value)} maxLength={200} placeholder="e.g. Group 2 Prelims 2019 — General Studies" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pyq-exam">
              Catalogue exam <span className="text-destructive">*</span>
            </Label>
            <select
              id="pyq-exam"
              value={examSlug}
              onChange={e => setExamSlug(e.target.value)}
              aria-label="Catalogue exam"
              className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
            >
              <option value="">{examsLoaded ? `Select an exam (${exams.length} in catalogue)` : 'Loading catalogue…'}</option>
              {exams.map(ex => (
                <option key={ex.slug} value={ex.slug}>
                  {ex.name} ({ex.slug})
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Required by the current PYQ database. No college/university semester papers exist in the catalogue yet —
              see the limitation note above.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pyq-year">Year</Label>
            <Input id="pyq-year" type="number" min={YEAR_MIN} max={YEAR_MAX} value={year} onChange={e => setYear(e.target.value)} placeholder={`e.g. 2019 (${YEAR_MIN}–${YEAR_MAX})`} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pyq-session">Session</Label>
            <Input id="pyq-session" value={session} onChange={e => setSession(e.target.value)} maxLength={100} placeholder="e.g. 2019, July shift 1" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pyq-stage">Stage label (optional)</Label>
            <Input id="pyq-stage" value={stageLabel} onChange={e => setStageLabel(e.target.value)} maxLength={200} placeholder="e.g. Prelims" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pyq-subject">Subject label (optional)</Label>
            <Input id="pyq-subject" value={subjectLabel} onChange={e => setSubjectLabel(e.target.value)} maxLength={200} placeholder="e.g. General Studies" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pyq-citation">Source citation</Label>
            <Input id="pyq-citation" value={sourceCitation} onChange={e => setSourceCitation(e.target.value)} maxLength={500} placeholder="e.g. Official preliminary answer key 2019, Q.101–150" />
          </div>
        </div>

        {submitError && (
          <Alert variant="destructive" className="mt-4" role="alert">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <div className="mt-5 flex items-center gap-3">
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={submit} disabled={!file || submitting || preflightErrors.length > 0}>
            {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden />}
            {submitting ? 'Importing…' : `Import as UNVERIFIED${file ? ` (${file.items.length} rows)` : ''}`}
          </Button>
          <span className="text-xs text-muted-foreground">
            {selectedExam ? `Attaching to ${selectedExam.name}` : 'Every imported row lands UNVERIFIED — review happens in the queue.'}
          </span>
        </div>
      </section>

      {/* Result */}
      {result && (
        <section aria-label="Import result" className="rounded-xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-display text-lg font-semibold text-foreground">Import result</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResultStat label="Total rows" value={result.totalRows} />
            <ResultStat label="Created" value={result.createdCount} tone="success" />
            <ResultStat label="Duplicates" value={result.duplicateCount} />
            <ResultStat label="Failed" value={result.failedCount} tone={result.failedCount > 0 ? 'destructive' : undefined} />
          </dl>
          {result.errors.length > 0 && (
            <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-xs font-medium text-destructive">Row errors (first {result.errors.length}):</p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                {result.errors.map(e => (
                  <li key={e.row}>
                    row {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Batch <span className="font-mono text-foreground">{result.batchId}</span> — all {result.createdCount} created rows are
            UNVERIFIED and invisible to students until a curator approves them in the review queue.
          </p>
        </section>
      )}
    </div>
  )
}

function ResultStat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'destructive' }) {
  return (
    <div className="rounded-lg border border-border bg-elevated px-4 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 font-display text-xl font-semibold',
          tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-foreground',
        )}
      >
        {value}
      </dd>
    </div>
  )
}

// ─── Review tab ────────────────────────────────────────────────────────────────

function ReviewTab({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<PyqVerificationStatus | ''>('UNVERIFIED')
  const [exam, setExam] = useState('')
  const [year, setYear] = useState('')
  const [batch, setBatch] = useState('')
  const [q, setQ] = useState('')
  const [exams, setExams] = useState<ExamListItem[]>([])
  const [batches, setBatches] = useState<PyqBatchDTO[]>([])
  const [data, setData] = useState<PyqQuestionDTO[] | null>(null)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<{ UNVERIFIED: number; VERIFIED: number; REJECTED: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Loading is DERIVED: a request is "in flight" until its completion callback
  // stamps `loadedFor` with the exact filter key it served (no sync setState in
  // the effect body — React's lint rules rightly warn about cascading renders).
  const fetchKey = `${status}|${exam}|${year}|${batch}|${q}|${reloadKey}`
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [failedFor, setFailedFor] = useState<{ key: string; message: string } | null>(null)
  const loading = loadedFor !== fetchKey

  useEffect(() => {
    let cancelled = false
    Promise.all([api.exams().catch(() => null), api.pyqBatches().catch(() => null)])
      .then(([exRes, bRes]) => {
        if (cancelled) return
        if (exRes) setExams(exRes.exams)
        if (bRes) setBatches(bRes.batches)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .pyqQuestions({
        status: status || undefined,
        exam: exam || undefined,
        year: year ? Number(year) : undefined,
        batch: batch || undefined,
        q: q || undefined,
        limit: 50,
      })
      .then(res => {
        if (cancelled) return
        setData(res.questions)
        setTotal(res.total)
        setCounts(res.counts)
        setLoadedFor(fetchKey)
      })
      .catch(e => {
        if (cancelled) return
        setFailedFor({ key: fetchKey, message: e instanceof Error ? e.message : 'Could not load the review queue.' })
        setLoadedFor(fetchKey)
      })
    return () => {
      cancelled = true
    }
  }, [fetchKey, status, exam, year, batch, q])

  const shownError = failedFor && failedFor.key === fetchKey ? failedFor.message : null

  const afterAction = () => {
    setReloadKey(k => k + 1)
    onChanged()
  }

  const reportCardError = (msg: string | null) => {
    // Card-level action errors are surfaced as a transient banner on the queue.
    setFailedFor(msg ? { key: fetchKey, message: msg } : null)
  }

  return (
    <div className="mt-6 space-y-5">
      {/* Filters */}
      <section aria-label="Review filters" className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Review status">
          {(['', 'UNVERIFIED', 'VERIFIED', 'REJECTED'] as const).map(s => (
            <button
              key={s || 'all'}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                'min-h-9 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                status === s ? 'border-gold/60 bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
              )}
            >
              {s === '' ? `All${counts ? ` (${counts.UNVERIFIED + counts.VERIFIED + counts.REJECTED})` : ''}` : undefined}
              {s === 'UNVERIFIED' && `Unverified${counts ? ` (${counts.UNVERIFIED})` : ''}`}
              {s === 'VERIFIED' && `Verified${counts ? ` (${counts.VERIFIED})` : ''}`}
              {s === 'REJECTED' && `Rejected${counts ? ` (${counts.REJECTED})` : ''}`}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <select
            aria-label="Filter by exam"
            value={exam}
            onChange={e => setExam(e.target.value)}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="">All exams</option>
            {exams.map(ex => (
              <option key={ex.slug} value={ex.slug}>
                {ex.shortName || ex.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by batch"
            value={batch}
            onChange={e => setBatch(e.target.value)}
            className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground"
          >
            <option value="">All batches</option>
            {batches.map(b => (
              <option key={b.id} value={b.id}>
                {b.paperTitle} {b.year ? `(${b.year})` : ''}
              </option>
            ))}
          </select>
          <Input aria-label="Filter by year" type="number" placeholder="Year" value={year} onChange={e => setYear(e.target.value)} className="border-border bg-card" />
          <Input aria-label="Search question text" placeholder="Search text…" value={q} onChange={e => setQ(e.target.value)} className="border-border bg-card" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {loading ? 'Loading…' : `${data?.length ?? 0} shown · ${total} match the filters`}
          {status === '' && ' · rejection of an already-verified row is not possible here (deliberate downgrades are a separate curation action)'}
        </p>
      </section>

      {shownError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{shownError}</AlertDescription>
        </Alert>
      )}

      {!loading && data && data.length === 0 && (
        <EmptyState
          icon={status === 'UNVERIFIED' ? CheckCircle2 : FileJson}
          title={status === 'UNVERIFIED' ? 'Nothing waiting for review' : status === 'REJECTED' ? 'No rejected rows' : 'No verified PYQs yet'}
          description={
            status === 'UNVERIFIED'
              ? 'Every imported row has been reviewed. New imports appear here and stay invisible to students until you approve them.'
              : 'This is the honest zero state — the bank contains zero records matching these filters until real imports and reviews happen.'
          }
        />
      )}

      <ul className="space-y-4">
        {(data ?? []).map(qq => (
          <QuestionReviewCard key={qq.id} question={qq} busy={busyId === qq.id} onBusy={setBusyId} onDone={afterAction} onError={reportCardError} />
        ))}
      </ul>
    </div>
  )
}

function QuestionReviewCard({
  question,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  question: PyqQuestionDTO
  busy: boolean
  onBusy: (id: string | null) => void
  onDone: () => void
  onError: (msg: string | null) => void
}) {
  const [justification, setJustification] = useState('')
  const [confirmingReject, setConfirmingReject] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  const approve = async () => {
    const note = justification.trim()
    if (note.length < 10) {
      onError('A verification needs a written justification of at least 10 characters — say WHAT you checked it against.')
      return
    }
    onBusy(question.id)
    onError(null)
    try {
      await api.pyqReview({ questionId: question.id, action: 'APPROVE', note })
      onDone()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Review failed — please try again.')
    } finally {
      onBusy(null)
    }
  }

  const reject = async () => {
    onBusy(question.id)
    onError(null)
    try {
      await api.pyqReview({ questionId: question.id, action: 'REJECT', note: rejectNote.trim() || undefined })
      setConfirmingReject(false)
      onDone()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Review failed — please try again.')
      setConfirmingReject(false)
    } finally {
      onBusy(null)
    }
  }

  return (
    <li className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">{question.text}</p>
        <StatusBadge status={question.verificationStatus} />
      </div>

      {/* Options with the keyed answer marked */}
      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {question.options.map((opt, i) => (
          <li
            key={i}
            className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
              i === question.correctIndex ? 'border-success/40 bg-success/5 text-foreground' : 'border-border bg-elevated text-muted-foreground',
            )}
          >
            <span className={cn('font-semibold', i === question.correctIndex ? 'text-success' : 'text-gold')}>{optionLetter(i)}.</span>
            <span>{opt}</span>
            {i === question.correctIndex && <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-success" aria-label="Keyed answer" />}
          </li>
        ))}
      </ol>

      {question.explanation && (
        <p className="mt-3 rounded-lg border border-border bg-elevated px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Explanation:</span> {question.explanation}
        </p>
      )}

      {/* Provenance */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        {question.sourcePaper && (
          <div>
            <dt className="sr-only">Source paper</dt>
            <dd>📄 {question.sourcePaper}</dd>
          </div>
        )}
        {question.year !== null && (
          <div>
            <dt className="sr-only">Year</dt>
            <dd>Year {question.year}</dd>
          </div>
        )}
        {question.batch?.session && (
          <div>
            <dt className="sr-only">Session</dt>
            <dd>Session: {question.batch.session}</dd>
          </div>
        )}
        {question.sourceRef && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="sr-only">Source reference</dt>
            <dd>Source ref: {question.sourceRef}</dd>
          </div>
        )}
        {question.batch && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="sr-only">Import batch</dt>
            <dd>
              Batch “{question.batch.paperTitle}” ({question.batch.fileName}) · imported {formatDate(question.batch.createdAt)}
              {question.batch.importedBy ? ` by ${question.batch.importedBy}` : ''}
            </dd>
          </div>
        )}
        <div className="col-span-2 sm:col-span-3">
          <dt className="sr-only">Review record</dt>
          <dd>
            {question.review.reviewer
              ? `Reviewed by ${question.review.reviewer.displayName || question.review.reviewer.email} (${question.review.reviewer.role})${question.review.reviewedAt ? ` on ${formatDate(question.review.reviewedAt)}` : ''}`
              : 'Not yet reviewed'}
          </dd>
        </div>
        {question.review.reviewNote && (
          <div className="col-span-2 sm:col-span-3">
            <dt className="sr-only">Review note</dt>
            <dd className="italic">“{question.review.reviewNote}”</dd>
          </div>
        )}
      </dl>

      {/* Actions */}
      {question.verificationStatus === 'UNVERIFIED' ? (
        <div className="mt-4 border-t border-border pt-4">
          <Label htmlFor={`just-${question.id}`} className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            Approval justification (required — what did you check this against?)
          </Label>
          <textarea
            id={`just-${question.id}`}
            value={justification}
            onChange={e => setJustification(e.target.value)}
            maxLength={400}
            rows={2}
            placeholder="e.g. Matches the official 2019 preliminary answer key, Q.44 (page 12 of the booklet)"
            className="mt-2 w-full rounded-md border border-border bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button className="bg-success text-primary-foreground hover:bg-success/90" onClick={approve} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="mr-1.5 h-4 w-4" aria-hidden />}
              Approve as PYQ_VERIFIED
            </Button>
            <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setConfirmingReject(true)} disabled={busy}>
              <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reject
            </Button>
            <span className={cn('text-xs', justification.trim().length >= 10 ? 'text-success' : 'text-muted-foreground')}>
              {justification.trim().length}/400 {justification.trim().length < 10 ? '(min 10 characters)' : ''}
            </span>
          </div>

          {confirmingReject && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3" role="alert">
              <p className="text-xs font-medium text-destructive">
                Reject this question? Rejected rows are excluded from every practice test. This needs your explicit confirmation.
              </p>
              <Input
                value={rejectNote}
                onChange={e => setRejectNote(e.target.value)}
                maxLength={400}
                placeholder="Reason (optional, recorded in the audit trail)"
                className="mt-2 border-destructive/30 bg-card"
                aria-label="Rejection reason"
              />
              <div className="mt-2 flex gap-2">
                <Button variant="destructive" size="sm" onClick={reject} disabled={busy}>
                  {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <XCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  Yes, reject this row
                </Button>
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setConfirmingReject(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          {question.verificationStatus === 'VERIFIED'
            ? 'Verified — re-confirmation is possible via the API; casual downgrades are deliberately not offered here.'
            : 'Rejected — excluded from all practice tests. It stays here for the audit record.'}
        </p>
      )}
    </li>
  )
}

// ─── History tab ───────────────────────────────────────────────────────────────

function HistoryTab() {
  const [data, setData] = useState<PyqBatchDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .pyqBatches()
      .then(res => !cancelled && setData(res.batches))
      .catch(e => !cancelled && setFailed(e instanceof Error ? e.message : 'Could not load import history.'))
    return () => {
      cancelled = true
    }
  }, [])

  if (!data && !failed) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading import history">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }
  if (failed) {
    return (
      <Alert variant="destructive" className="mt-6" role="alert">
        <AlertDescription>{failed}</AlertDescription>
      </Alert>
    )
  }
  if (!data || data.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={History}
          title="No PYQ imports recorded yet"
          description="The bank currently contains zero PYQ records — this stays truthful until a real, rights-cleared import happens."
        />
      </div>
    )
  }

  return (
    <section aria-label="Import history" className="mt-6 space-y-3">
      {data.map(b => (
        <article key={b.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-foreground">{b.paperTitle}</h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[b.examSlug, b.examLabel, b.stageLabel, b.subjectLabel, b.year !== null ? String(b.year) : null, b.session].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                File {b.fileName} · imported {formatDate(b.createdAt)}
                {b.sourceCitation ? ` · citation: ${b.sourceCitation}` : ''}
              </p>
            </div>
            <dl className="flex shrink-0 gap-3 text-center text-xs">
              <div>
                <dt className="text-muted-foreground">Rows</dt>
                <dd className="font-semibold text-foreground">{b.totalRows}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Created</dt>
                <dd className="font-semibold text-success">{b.createdCount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Dupes</dt>
                <dd className="font-semibold text-foreground">{b.duplicateCount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Failed</dt>
                <dd className={cn('font-semibold', b.failedCount > 0 ? 'text-destructive' : 'text-foreground')}>{b.failedCount}</dd>
              </div>
            </dl>
          </div>
          {b.errorCount > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-destructive">
                {b.errorCount} row error{b.errorCount === 1 ? '' : 's'}
              </summary>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                {b.errors.map(e => (
                  <li key={e.row}>
                    row {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </article>
      ))}
    </section>
  )
}

// ─── Candidates tab (Phase 3A) ────────────────────────────────────────────────
// The discovery queue: research-discovered historical-question candidates.
// Promotion here only ever creates PYQ_UNVERIFIED rows — the review queue
// (and its mandatory justification + audit trail) remains the sole authority.

const CAND_STATUS_META: Record<string, { label: string; cls: string }> = {
  DISCOVERED: { label: 'Discovered', cls: 'border-border bg-elevated text-muted-foreground' },
  SOURCE_CHECKED: { label: 'Source checked', cls: 'border-gold/40 bg-gold/10 text-gold' },
  PROMOTED: { label: 'Promoted to review', cls: 'border-success/40 bg-success/10 text-success' },
  DISCARDED: { label: 'Discarded', cls: 'border-border bg-muted text-muted-foreground' },
}

function CandidatesTab({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast()
  const [status, setStatus] = useState<'SOURCE_CHECKED' | 'PROMOTED' | 'DISCARDED' | undefined>('SOURCE_CHECKED')
  const [data, setData] = useState<PyqCandidatesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [promoting, setPromoting] = useState<PyqCandidateRowDTO | null>(null)
  const [exams, setExams] = useState<ExamListItem[]>([])

  useEffect(() => {
    let alive = true
    api.exams().then(d => alive && setExams(d.exams)).catch(() => alive && setExams([]))
    return () => {
      alive = false
    }
  }, [])

  const load = useCallback(() => {
    let alive = true
    api
      .pyqCandidates(status ? { status } : {})
      .then(d => {
        if (alive) {
          setData(d)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not load the candidate queue.')
        setData(null)
      })
    return () => {
      alive = false
    }
  }, [status])

  useEffect(load, [load])

  const discard = (c: PyqCandidateRowDTO) => {
    setBusyId(c.id)
    api
      .pyqCandidateDiscard(c.id)
      .then(() => {
        toast({ title: 'Candidate discarded' })
        load()
        onChanged()
      })
      .catch((e: unknown) => toast({ title: 'Could not discard', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }))
      .finally(() => setBusyId(null))
  }

  const counts = data?.counts

  return (
    <div className="mt-6">
      <Alert className="border-gold/30 bg-gold/5">
        <AlertDescription className="text-xs leading-relaxed text-muted-foreground">
          Candidates come from Riishe&apos;s web research — they are pointers with provenance, NOT verified questions. Promoting one
          creates an <strong className="text-foreground">UNVERIFIED</strong> row in the review queue (never a verified one). Rights:
          reference-only candidates require you to paste the verbatim text from the source you verified.
        </AlertDescription>
      </Alert>

      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Candidate status filter">
        {([
          ['SOURCE_CHECKED', 'Source checked'],
          ['PROMOTED', 'Promoted'],
          ['DISCARDED', 'Discarded'],
          [undefined, 'All active'],
        ] as const).map(([value, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={status === value}
            onClick={() => setStatus(value)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-semibold',
              status === value ? 'border-gold/50 bg-gold/10 text-gold' : 'border-border bg-elevated text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {value && counts ? ` (${counts[value]})` : ''}
          </button>
        ))}
      </div>

      {error ? (
        <div role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <div className="mt-2">
            <Button variant="outline" size="sm" className="border-border bg-card text-muted-foreground" onClick={load}>
              Try again
            </Button>
          </div>
        </div>
      ) : data === null ? (
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="h-24 animate-pulse rounded-xl bg-elevated" />
          <div className="h-24 animate-pulse rounded-xl bg-elevated" />
        </div>
      ) : data.candidates.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          No candidates in this queue yet. They appear here when students run exam-oriented Deep Research and a source passes the
          content check.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {data.candidates.map(c => (
            <CandidateRow key={c.id} candidate={c} exams={exams} busy={busyId === c.id} onDiscard={() => discard(c)} onPromote={() => setPromoting(c)} onChanged={onChanged} />
          ))}
        </div>
      )}

      {promoting && <PromoteDialog candidate={promoting} exams={exams} onClose={() => setPromoting(null)} onDone={() => { setPromoting(null); load(); onChanged() }} />}
    </div>
  )
}

function CandidateRow({
  candidate: c,
  exams,
  busy,
  onDiscard,
  onPromote,
  onChanged,
}: {
  candidate: PyqCandidateRowDTO
  exams: ExamListItem[]
  busy: boolean
  onDiscard: () => void
  onPromote: () => void
  onChanged: () => void
}) {
  const meta = CAND_STATUS_META[c.status] ?? CAND_STATUS_META.DISCOVERED
  const evidence = c.evidence[0]
  return (
    <article className={cn('rounded-xl border bg-card p-4 sm:p-5', c.status === 'PROMOTED' ? 'border-success/40' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', meta.cls)}>{meta.label}</span>
        {c.sourceClass && <span className="rounded-full border border-border bg-elevated px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{c.sourceClass}</span>}
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            c.rightsStatus === 'VERBATIM_PERMITTED' ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-elevated text-muted-foreground',
          )}
        >
          {c.rightsStatus === 'VERBATIM_PERMITTED' ? 'verbatim stored' : 'reference-only'}
        </span>
        {c.proposedCorrectIndex !== null && <span className="rounded-full border border-gold/30 bg-gold/5 px-2 py-0.5 text-[10px] text-foreground">key → option {c.proposedCorrectIndex + 1}</span>}
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Exam:</dt>
          <dd className="text-foreground">{c.examLabel ?? 'unknown'}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Year / session:</dt>
          <dd className="text-foreground">{c.year ?? 'unknown'}{c.sessionLabel ? ` · ${c.sessionLabel}` : ''}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Locator:</dt>
          <dd className="text-foreground">{[c.questionNumber, c.locator].filter(Boolean).join(' · ') || 'not captured'}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Retrieved:</dt>
          <dd className="text-foreground">{c.retrievedAt ? new Date(c.retrievedAt).toLocaleString() : 'unknown'}</dd>
        </div>
        <div className="flex gap-1.5 sm:col-span-2">
          <dt className="text-muted-foreground">Source:</dt>
          <dd className="min-w-0">
            <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex max-w-full items-center gap-1 truncate text-gold underline-offset-2 hover:underline">
              <Landmark className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{c.sourceTitle ?? c.sourceUrl}</span>
            </a>
          </dd>
        </div>
        {c.paperTitle && (
          <div className="flex gap-1.5 sm:col-span-2">
            <dt className="text-muted-foreground">Paper:</dt>
            <dd className="text-foreground">{c.paperTitle}</dd>
          </div>
        )}
      </dl>

      {evidence && (
        <blockquote className="mt-3 rounded-lg border border-border bg-elevated px-3 py-2 text-xs leading-relaxed text-foreground">
          &ldquo;{evidence.excerpt}&rdquo;
          {evidence.pageRef && <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground">{evidence.pageRef}</span>}
        </blockquote>
      )}
      {c.verificationNote && <p className="mt-2 text-xs italic text-muted-foreground">{c.verificationNote}</p>}

      {c.status === 'PROMOTED' ? (
        <p className="mt-3 text-xs text-success">Promoted to the review queue — verification continues there with the full contract.</p>
      ) : c.status === 'DISCARDED' ? (
        <p className="mt-3 text-xs text-muted-foreground">Discarded.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={onPromote} disabled={busy}>
            Promote to review queue
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-border bg-card text-muted-foreground hover:bg-elevated hover:text-foreground"
            onClick={onDiscard}
            disabled={busy}
          >
            Discard
          </Button>
        </div>
      )}
      {void exams}
      {void onChanged}
    </article>
  )
}

function PromoteDialog({ candidate: c, exams, onClose, onDone }: { candidate: PyqCandidateRowDTO; exams: ExamListItem[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast()
  const [examSlug, setExamSlug] = useState(c.examSlug ?? '')
  const [year, setYear] = useState(c.year ? String(c.year) : '')
  const [text, setText] = useState(c.verbatimText ?? '')
  const [optionsText, setOptionsText] = useState('')
  const [correctIndex, setCorrectIndex] = useState(c.proposedCorrectIndex !== null ? String(c.proposedCorrectIndex) : '')
  const [explanation, setExplanation] = useState('')
  const [difficulty, setDifficulty] = useState('MEDIUM')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    const options = optionsText
      .split('\n')
      .map(o => o.trim())
      .filter(Boolean)
    const payload = {
      examSlug: examSlug || undefined,
      year: year ? Number(year) : undefined,
      text: text.trim() || undefined,
      options: options.length ? options : undefined,
      correctIndex: correctIndex !== '' ? Number(correctIndex) : undefined,
      explanation: explanation.trim() || undefined,
      difficulty: difficulty as 'EASY' | 'MEDIUM' | 'HARD',
    }
    setBusy(true)
    api
      .pyqCandidatePromote(c.id, payload)
      .then(r => {
        toast({ title: 'Candidate promoted', description: `Question ${r.questionId} is now UNVERIFIED in the review queue — verify it there.` })
        onDone()
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not promote the candidate.'))
      .finally(() => setBusy(false))
  }

  const needsVerbatim = c.rightsStatus !== 'VERBATIM_PERMITTED' || !c.verbatimText

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Promote candidate">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 sm:p-6">
        <h3 className="font-display text-lg font-semibold text-foreground">Promote candidate to review queue</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The created question is <strong className="text-foreground">UNVERIFIED</strong> — verification happens only in the review
          queue with a written justification. {needsVerbatim ? 'This candidate is reference-only: paste the question text and options verbatim from the source (you are accountable for the rights).' : 'The stored verbatim text (licenced source) is pre-filled.'}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="promote-exam" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Examination
            </Label>
            <select
              id="promote-exam"
              value={examSlug}
              onChange={e => setExamSlug(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-elevated px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              <option value="">Choose…</option>
              {exams.map(ex => (
                <option key={ex.slug} value={ex.slug}>
                  {ex.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="promote-year" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Year
            </Label>
            <Input id="promote-year" type="number" min={1990} max={2035} value={year} onChange={e => setYear(e.target.value)} className="mt-1.5 bg-elevated" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="promote-text" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Question text (verbatim)
            </Label>
            <Textarea id="promote-text" value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={2000} className="mt-1.5 bg-elevated" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="promote-options" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Options — one per line, verbatim
            </Label>
            <Textarea
              id="promote-options"
              value={optionsText}
              onChange={e => setOptionsText(e.target.value)}
              rows={4}
              placeholder={'Option A\nOption B\nOption C\nOption D'}
              className="mt-1.5 bg-elevated"
            />
          </div>
          <div>
            <Label htmlFor="promote-answer" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Correct option
            </Label>
            <select
              id="promote-answer"
              value={correctIndex}
              onChange={e => setCorrectIndex(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-elevated px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              <option value="">Choose…</option>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <option key={i} value={String(i)}>
                  Option {optionLetter(i)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="promote-difficulty" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Difficulty
            </Label>
            <select
              id="promote-difficulty"
              value={difficulty}
              onChange={e => setDifficulty(e.target.value)}
              className="mt-1.5 h-10 w-full rounded-md border border-input bg-elevated px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              <option value="EASY">EASY</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HARD">HARD</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="promote-explanation" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Explanation (optional)
            </Label>
            <Textarea id="promote-explanation" value={explanation} onChange={e => setExplanation(e.target.value)} rows={2} maxLength={4000} className="mt-1.5 bg-elevated" />
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="border-border bg-card text-muted-foreground" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Promote as UNVERIFIED
          </Button>
        </div>
      </div>
    </div>
  )
}

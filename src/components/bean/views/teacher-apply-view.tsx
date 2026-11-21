'use client'

// ─── BEAN Teach (Phase 4A): teacher application ──────────────────────────────
// Any signed-in student can apply to teach — no second login, no separate
// password, no paid registration. States: NOT_APPLIED (form) → PENDING
// (under review) → APPROVED (dashboard CTA) | REJECTED (reason + correct +
// resubmit, preserving review history). Privacy: the form deliberately does
// NOT ask for date of birth, bank details or government IDs.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, GraduationCap, X, Plus, Pencil, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { TeachApplicationDTO } from '@/lib/types'
import { TEACH_LEVEL_OPTIONS, TEACH_LEVEL_LABELS } from '@/components/bean/teach-format'

interface ApplicationForm {
  teachingName: string
  headline: string
  bio: string
  subjects: string[]
  levels: string[]
  languages: string[]
  qualificationsText: string
  experienceYears: string
  portfolioUrl: string
}

const EMPTY_FORM: ApplicationForm = {
  teachingName: '',
  headline: '',
  bio: '',
  subjects: [],
  levels: [],
  languages: [],
  qualificationsText: '',
  experienceYears: '',
  portfolioUrl: '',
}

function formFromApplication(a: TeachApplicationDTO): ApplicationForm {
  return {
    teachingName: a.teachingName,
    headline: a.headline,
    bio: a.bio,
    subjects: a.subjects,
    levels: a.levels,
    languages: a.languages,
    qualificationsText: a.qualificationsText,
    experienceYears: String(a.experienceYears),
    portfolioUrl: a.portfolioUrl ?? '',
  }
}

export function TeacherApplyView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const [application, setApplication] = useState<TeachApplicationDTO | null | undefined>(undefined) // undefined = loading
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api.teachApplication()
      .then(res => { setApplication(res.application); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your application.'))
  }, [])

  useEffect(() => {
    if (authChecked && authedStudent) load()
  }, [authChecked, authedStudent, load])

  if (!authChecked) {
    return <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <GraduationCap className="mb-4 h-10 w-10 text-gold" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Become a BEAN Teacher</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in with your student account to apply — no second login is needed, and your student experience stays exactly the same.</p>
        <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>Sign in to apply</Button>
      </div>
    )
  }
  if (application === undefined && !failed) {
    return <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading application"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (failed && application === undefined) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyState icon={GraduationCap} title="Could not load your application" description={failed} actionLabel="Try again" onAction={load} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Teach</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Become a BEAN Teacher</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Share what you know with students across India. A BEAN administrator reviews every application — only approved teachers can create and publish classes.
      </p>
      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        BEAN Teach never asks for date of birth, bank details or government identity documents. Your email and review notes stay private.
      </p>

      {application && application.status === 'APPROVED' && (
        <ApprovedPanel application={application} onChanged={load} navigate={navigate} />
      )}
      {application && application.status === 'PENDING' && (
        <PendingPanel application={application} onEdit={() => setApplicationStatusView('edit')} />
      )}
      {application && application.status === 'REJECTED' && (
        <RejectedPanel application={application} />
      )}
      {!application && <ApplicationFormPanel mode="submit" initial={EMPTY_FORM} onDone={load} />}
      {application?.status === 'REJECTED' && (
        <div className="mt-6">
          <ApplicationFormPanel mode="resubmit" initial={formFromApplication(application)} onDone={load} />
        </div>
      )}
    </div>
  )
}

// Local UI state helper: PENDING panel can flip into edit mode by rendering the
// form pre-filled on top of the status panel.
function setApplicationStatusView(_mode: 'edit') {
  // Editing while pending is handled by the PendingPanel's inline form toggle.
  window.dispatchEvent(new CustomEvent('bean-teach-edit-application'))
}

function PendingPanel({ application, onEdit }: { application: TeachApplicationDTO; onEdit: () => void }) {
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    const handler = () => setEditing(true)
    window.addEventListener('bean-teach-edit-application', handler)
    return () => window.removeEventListener('bean-teach-edit-application', handler)
  }, [])
  return (
    <div className="mt-8">
      <div className="rounded-xl border border-gold/40 bg-gold/10 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Badge variant="outline" className="border-gold/40 bg-transparent text-gold">Under review</Badge>
            <p className="mt-3 text-sm text-foreground">
              Your application is with a BEAN administrator. You will see the decision here — and your teacher dashboard unlocks the moment you are approved.
            </p>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" className="border-gold/40 text-gold hover:bg-gold/10" onClick={onEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </div>
        {editing && (
          <div className="mt-4 border-t border-gold/20 pt-4">
            <ApplicationFormPanel mode="edit-pending" initial={formFromApplication(application)} onDone={() => { setEditing(false); window.location.reload() }} />
          </div>
        )}
      </div>
    </div>
  )
}

function ApprovedPanel({ application, onChanged, navigate }: { application: TeachApplicationDTO; onChanged: () => void; navigate: (route: ReturnType<typeof useAppStore.getState>['route']) => void }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="mt-8">
      <div className="rounded-xl border border-success/40 bg-success/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Badge variant="outline" className="border-success/40 bg-transparent text-success">Approved teacher</Badge>
            <p className="mt-3 text-sm text-foreground">You can create and publish free pilot classes. Public profile visibility: {application.isPublished ? 'published' : 'unpublished'}.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'teach-dashboard' })}>Teacher Dashboard</Button>
            {!editing && (
              <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setEditing(true)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit profile
              </Button>
            )}
          </div>
        </div>
        {editing && (
          <div className="mt-4 border-t border-success/20 pt-4">
            <p className="mb-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold">
              Heads-up: changing qualifications, experience, subjects, levels, languages or your biography returns your profile to review — your classes stay reserved but disappear from the marketplace until an administrator re-approves you.
            </p>
            <ApplicationFormPanel mode="edit-approved" initial={formFromApplication(application)} onDone={() => { setEditing(false); onChanged() }} />
          </div>
        )}
      </div>
    </div>
  )
}

function RejectedPanel({ application }: { application: TeachApplicationDTO }) {
  return (
    <div className="mt-8 rounded-xl border border-destructive/40 bg-destructive/10 p-5">
      <Badge variant="outline" className="border-destructive/40 bg-transparent text-destructive">Not approved</Badge>
      <p className="mt-3 text-sm text-foreground">The administrator's reason is shown below — correct your information and submit a new application. Your previous review history is preserved.</p>
      {application.reviewNote && (
        <blockquote className="mt-3 rounded-lg border border-destructive/30 bg-card px-3 py-2 text-sm text-muted-foreground">“{application.reviewNote}”</blockquote>
      )}
    </div>
  )
}

/** Tag-list input used for subjects and languages. */
function TagInput({ values, onChange, placeholder, ariaLabel }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; ariaLabel: string }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || values.includes(v) || values.length >= 8) return
    onChange([...values, v])
    setDraft('')
  }
  return (
    <div>
      <div className="flex gap-2">
        <Input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} placeholder={placeholder} aria-label={ariaLabel} />
        <Button type="button" variant="outline" size="icon" className="shrink-0 border-border text-muted-foreground hover:bg-elevated" onClick={add} aria-label={`Add ${ariaLabel}`}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map(v => (
            <Badge key={v} variant="outline" className="border-gold/40 text-gold">
              {v}
              <button type="button" className="ml-1 inline-flex" onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Remove ${v}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function ApplicationFormPanel({ mode, initial, onDone }: { mode: 'submit' | 'resubmit' | 'edit-pending' | 'edit-approved'; initial: ApplicationForm; onDone: () => void }) {
  const [form, setForm] = useState<ApplicationForm>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof ApplicationForm>(key: K, value: ApplicationForm[K]) => setForm(f => ({ ...f, [key]: value }))

  const submit = async () => {
    setBusy(true)
    setError(null)
    const years = Number.parseInt(form.experienceYears, 10)
    const payload = {
      teachingName: form.teachingName.trim(),
      headline: form.headline.trim(),
      bio: form.bio.trim(),
      subjects: form.subjects,
      levels: form.levels,
      languages: form.languages,
      qualificationsText: form.qualificationsText.trim(),
      experienceYears: Number.isNaN(years) ? -1 : years,
      portfolioUrl: form.portfolioUrl.trim() || null,
    }
    try {
      if (mode === 'submit' || mode === 'resubmit') {
        await api.teachSubmitApplication(payload)
      } else {
        await api.teachUpdateApplication(payload)
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the application.')
    } finally {
      setBusy(false)
    }
  }

  const title =
    mode === 'submit' ? 'Teacher application'
    : mode === 'resubmit' ? 'Submit a new application'
    : mode === 'edit-approved' ? 'Edit your teacher profile'
    : 'Edit your application'

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-4 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="teachingName">Public teaching name</Label>
            <Input id="teachingName" value={form.teachingName} onChange={e => set('teachingName', e.target.value)} placeholder="How students will know you" maxLength={60} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="headline">Professional headline</Label>
            <Input id="headline" value={form.headline} onChange={e => set('headline', e.target.value)} placeholder="e.g. Physics teacher, 8 years, JEE focus" maxLength={120} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bio">Short biography</Label>
          <Textarea id="bio" value={form.bio} onChange={e => set('bio', e.target.value)} placeholder="Who you teach, how you teach, and what students get out of your classes (50–2000 characters)" rows={4} maxLength={2000} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Teaching subjects</Label>
            <TagInput values={form.subjects} onChange={v => set('subjects', v)} placeholder="Add a subject and press Add" ariaLabel="Teaching subjects" />
          </div>
          <div className="grid gap-1.5">
            <Label>Languages you teach in</Label>
            <TagInput values={form.languages} onChange={v => set('languages', v)} placeholder="Add a language" ariaLabel="Teaching languages" />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Education levels served</Label>
          <div className="flex flex-wrap gap-1.5">
            {TEACH_LEVEL_OPTIONS.map(o => {
              const active = form.levels.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => set('levels', active ? form.levels.filter(l => l !== o.value) : [...form.levels, o.value])}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? 'border-gold/60 bg-gold/10 text-gold' : 'border-border text-muted-foreground hover:bg-elevated'}`}
                  aria-pressed={active}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="qualifications">Qualification details</Label>
          <Textarea id="qualifications" value={form.qualificationsText} onChange={e => set('qualificationsText', e.target.value)} placeholder="Degrees, certifications or professional experience administrators can verify (20–2000 characters)" rows={3} maxLength={2000} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="experienceYears">Years of teaching or professional experience</Label>
            <Input id="experienceYears" type="number" min={0} max={60} value={form.experienceYears} onChange={e => set('experienceYears', e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="portfolioUrl">Portfolio or professional profile URL (optional)</Label>
            <Input id="portfolioUrl" type="url" value={form.portfolioUrl} onChange={e => set('portfolioUrl', e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Selected levels</Label>
          <p className="text-xs text-muted-foreground">{form.levels.length === 0 ? 'Pick at least one level above.' : form.levels.map(l => TEACH_LEVEL_LABELS[l] ?? l).join(', ')}</p>
        </div>

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === 'submit' ? 'Submit application' : mode === 'resubmit' ? 'Submit corrected application' : 'Save changes'}
          </Button>
        </div>
      </div>
    </section>
  )
}

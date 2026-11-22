'use client'

// ─── Phase 7 — Career profile editor (#/career/profile) ──────────────────────
// The student's own career profile: headline, summary, preferences and the
// visibility control. The adult-eligibility state is shown truthfully — the
// review is performed by BEAN administrators, and until it is APPROVED the
// server blocks discovery and applications regardless of what the UI shows.
//
// Save flow guarantees: field values are held in state and are never reset on
// a failed save (recoverable failures preserve the user's work); errors are
// shown inline next to the save button; success feedback appears only after
// the server confirms; a dirty-state badge flags unconfirmed edits.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { CareerProfileResponse, CareerEligibilityClientDTO } from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import {
  careerProfileIsDirty, eligibilityHumanLabel, eligibilityBadgeClass,
  formatCareerDate, visibilityDescription,
} from '@/lib/career-ui'
import { ArrowLeft, Check, Copy, Eye, EyeOff, Loader2, PauseCircle, ShieldCheck } from 'lucide-react'

const VISIBILITY_OPTIONS = [
  { value: 'PRIVATE', label: 'Private — only you can see this' },
  { value: 'DISCOVERABLE', label: 'Discoverable — verified employers may find me' },
  { value: 'PAUSED', label: 'Paused — hidden from discovery, choice kept' },
]

interface SavedFormValues {
  headline: string
  summary: string
  preferredRoleTypes: string
  preferredSkills: string
  preferredLocations: string
  workModes: string
  visibility: string
  publicSlug: string
}

export function CareerProfileView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [data, setData] = useState<CareerProfileResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [preferredRoleTypes, setRoleTypes] = useState('')
  const [preferredSkills, setPreferredSkills] = useState('')
  const [preferredLocations, setLocations] = useState('')
  const [workModes, setWorkModes] = useState('')
  const [visibility, setVisibility] = useState('PRIVATE')
  const [publicSlug, setPublicSlug] = useState('')
  const [eligibility, setEligibility] = useState<CareerEligibilityClientDTO | null>(null)
  const [busy, setBusy] = useState(false)
  // Last server-confirmed form values — the baseline for the dirty indicator
  // and the source of truth preserved across recoverable failures.
  const [savedValues, setSavedValues] = useState<SavedFormValues | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [copiedSlug, setCopiedSlug] = useState(false)

  const readFormValues = (res: CareerProfileResponse): SavedFormValues => ({
    headline: res.profile.headline ?? '',
    summary: res.profile.summary ?? '',
    preferredRoleTypes: res.profile.preferredRoleTypes.join(', '),
    preferredSkills: res.profile.preferredSkills.join(', '),
    preferredLocations: res.profile.preferredLocations.join(', '),
    workModes: res.profile.workModes.join(', '),
    visibility: res.profile.visibility,
    publicSlug: res.profile.publicSlug ?? '',
  })

  const load = useCallback(() => {
    setData(null)
    api.careerProfile()
      .then(res => {
        setData(res)
        setFailed(null)
        setHeadline(res.profile.headline ?? '')
        setSummary(res.profile.summary ?? '')
        setRoleTypes(res.profile.preferredRoleTypes.join(', '))
        setPreferredSkills(res.profile.preferredSkills.join(', '))
        setLocations(res.profile.preferredLocations.join(', '))
        setWorkModes(res.profile.workModes.join(', '))
        setVisibility(res.profile.visibility)
        setPublicSlug(res.profile.publicSlug ?? '')
        setSavedValues(readFormValues(res))
        setSaveError(null)
        setEligibility(res.eligibility)
      })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your career profile.'))
  }, [])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

  const isDirty = useMemo(
    () => careerProfileIsDirty(
      { headline, summary, preferredRoleTypes, preferredSkills, preferredLocations, workModes, visibility, publicSlug },
      savedValues,
    ),
    [headline, summary, preferredRoleTypes, preferredSkills, preferredLocations, workModes, visibility, publicSlug, savedValues],
  )

  const save = async () => {
    setBusy(true)
    setSaveError(null)
    try {
      const res = await api.saveCareerProfile({
        headline: headline.trim() || undefined,
        summary: summary.trim() || undefined,
        preferredRoleTypes: preferredRoleTypes.split(',').map(s => s.trim()).filter(Boolean),
        preferredSkills: preferredSkills.split(',').map(s => s.trim()).filter(Boolean),
        preferredLocations: preferredLocations.split(',').map(s => s.trim()).filter(Boolean),
        workModes: workModes.split(',').map(s => s.trim()).filter(Boolean),
        publicSlug: publicSlug.trim() || null,
        visibility,
      })
      // Server confirmed — update the authoritative snapshot and feedback.
      setData(d => (d ? { ...d, profile: res.profile } : d))
      const confirmed: SavedFormValues = {
        headline: res.profile.headline ?? '',
        summary: res.profile.summary ?? '',
        preferredRoleTypes: res.profile.preferredRoleTypes.join(', '),
        preferredSkills: res.profile.preferredSkills.join(', '),
        preferredLocations: res.profile.preferredLocations.join(', '),
        workModes: res.profile.workModes.join(', '),
        visibility: res.profile.visibility,
        publicSlug: res.profile.publicSlug ?? '',
      }
      setSavedValues(confirmed)
      setSavedAt(new Date().toISOString())
      toast({ title: 'Career profile saved' })
    } catch (e) {
      // Recoverable failure: keep every field value exactly as typed.
      const message = e instanceof Error ? e.message : 'Please try again.'
      setSaveError(message)
      toast({ title: 'Could not save', description: message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const requestReview = async () => {
    setBusy(true)
    try {
      const res = await api.requestEligibilityReview()
      setEligibility(res.eligibility)
      toast({ title: 'Review requested — BEAN administrators will verify your adult eligibility.' })
    } catch (e) {
      toast({ title: 'Could not request review', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const copySlug = async () => {
    const slug = data?.profile.publicSlug
    if (!slug) return
    try {
      await navigator.clipboard.writeText(slug)
      setCopiedSlug(true)
      setTimeout(() => setCopiedSlug(false), 2000)
    } catch {
      toast({ title: 'Clipboard unavailable — select the slug and copy it manually.', variant: 'destructive' })
    }
  }

  if (!authChecked) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={EyeOff} title="Sign in required" description="Your career profile is private to your account." actionLabel="Sign in" onAction={() => navigate({ view: 'auth' })} />
      </div>
    )
  }

  const firstTime = !!data && !data.profile.headline && !data.profile.summary && data.profile.preferredSkills.length === 0

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Button variant="ghost" className="-ml-2 mb-3 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'career' })}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Career
      </Button>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Career</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Career profile</h1>
      <p className="mt-2 text-sm text-muted-foreground">Everything here is private by default. You choose when — and whether — employers ever see any of it.</p>

      {failed ? (
        <div className="mt-8"><EmptyState icon={EyeOff} title="Could not load your profile" description={failed} actionLabel="Try again" onAction={load} /></div>
      ) : !data ? (
        <div className="mt-8 flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading profile"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : (
        <div className="mt-8 space-y-6">
          {/* First-time onboarding — honest hints, no placeholder metrics */}
          {firstTime ? (
            <div className="rounded-xl border border-gold/30 bg-gold/5 p-5">
              <h2 className="font-display text-base font-semibold text-foreground">Welcome — this profile starts empty</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>1. Write a one-line headline that says what you are aiming for.</li>
                <li>2. Add your preferred roles, skills and locations so future applications are quick to assemble.</li>
                <li>3. Build your portfolio (skills, projects, credentials) on the portfolio page.</li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">Nothing is shared until you explicitly choose to — the profile is Private right now.</p>
            </div>
          ) : null}

          {/* Visibility + eligibility */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="grid w-full max-w-md gap-2">
                <Label htmlFor="career-visibility">Who can discover you</Label>
                <Select value={visibility} onValueChange={setVisibility}>
                  <SelectTrigger id="career-visibility" aria-label="Profile visibility"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {VISIBILITY_OPTIONS.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{visibilityDescription(visibility)}</p>
              </div>
              <div className="text-sm">
                <p className="text-xs text-muted-foreground">Adult-eligibility (safeguarding)</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="outline" className={eligibilityBadgeClass(eligibility?.status ?? 'NOT_ELIGIBLE')}>
                    {eligibilityHumanLabel(eligibility?.status ?? 'NOT_ELIGIBLE')}
                  </Badge>
                  {eligibility?.status === 'NOT_ELIGIBLE' || eligibility?.status === 'DENIED' ? (
                    <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" disabled={busy} onClick={requestReview}>
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden /> Request review
                    </Button>
                  ) : null}
                </div>
                {eligibility?.status === 'PENDING_REVIEW' && eligibility.requestedAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">Requested {formatCareerDate(eligibility.requestedAt) ?? ''} — a BEAN administrator decides.</p>
                ) : null}
                {eligibility?.status === 'DENIED' && eligibility.decisionReason ? (
                  <p className="mt-1 text-xs text-muted-foreground">Reason: {eligibility.decisionReason}</p>
                ) : null}
              </div>
            </div>
            {visibility === 'DISCOVERABLE' && eligibility?.status === 'NOT_ELIGIBLE' ? (
              <p className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-muted-foreground">
                <Eye className="mr-1 inline h-3.5 w-3.5 text-gold" aria-hidden />
                You have not requested an adult-eligibility review yet. Discovery stays off until BEAN approves one — a
                server-side safeguard, not a UI preference. Private planning and portfolio building remain fully available.
              </p>
            ) : null}
            {visibility === 'DISCOVERABLE' && eligibility?.status === 'PENDING_REVIEW' ? (
              <p className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-muted-foreground">
                <Eye className="mr-1 inline h-3.5 w-3.5 text-gold" aria-hidden />
                Your review is pending with BEAN administrators. Discovery stays off until it is approved — the server
                enforces this independently of this screen.
              </p>
            ) : null}
            {visibility === 'DISCOVERABLE' && eligibility?.status === 'DENIED' ? (
              <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-muted-foreground">
                <EyeOff className="mr-1 inline h-3.5 w-3.5 text-destructive" aria-hidden />
                Your adult-eligibility review was denied. Discovery stays off. You can request a new review at any time.
              </p>
            ) : null}
            {visibility === 'DISCOVERABLE' && eligibility?.status === 'APPROVED' ? (
              <p className="mt-3 rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-muted-foreground">
                <Eye className="mr-1 inline h-3.5 w-3.5 text-success" aria-hidden />
                Verified employers can find the fields you marked discoverable. Pausing hides you instantly at any time.
              </p>
            ) : null}
            {visibility === 'DISCOVERABLE' && data.profile.publicSlug ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2">
                <span className="text-xs text-muted-foreground">Public slug</span>
                <code className="break-all text-xs text-foreground">{data.profile.publicSlug}</code>
                <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => void copySlug()}>
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> {copiedSlug ? 'Copied' : 'Copy'}
                </Button>
              </div>
            ) : null}
            {/* Public slug — the shareable handle for the public portfolio preview.
                Settable at any visibility; only ever resolvable once the profile is
                discoverable AND adult-eligibility is approved (server-enforced). */}
            <div className="mt-4 grid gap-1.5">
              <Label htmlFor="career-public-slug">Public portfolio slug (optional)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="career-public-slug"
                  value={publicSlug}
                  onChange={e => setPublicSlug(e.target.value.toLowerCase())}
                  placeholder="e.g. cara-career"
                  maxLength={60}
                  autoComplete="off"
                  className="max-w-xs font-mono text-sm"
                />
                <span className="text-xs text-muted-foreground">
                  4–60 lowercase letters, digits or hyphens. Shared only when your profile is discoverable.
                </span>
              </div>
            </div>
          </div>

          {/* Fields */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="cp-headline">Headline</Label>
                <Input id="cp-headline" value={headline} onChange={e => setHeadline(e.target.value)} maxLength={120} placeholder="Aspiring CA with financial-analysis projects" />
                {!headline ? <p className="text-xs text-muted-foreground">Start with one line that says what you are aiming for — it is the first thing a discovered employer reads.</p> : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cp-summary">Summary</Label>
                <Textarea id="cp-summary" rows={4} value={summary} onChange={e => setSummary(e.target.value)} maxLength={2000} />
                {!summary ? <p className="text-xs text-muted-foreground">A short honest overview: what you are studying, what you have built, what you want next.</p> : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="cp-roles">Preferred role types (comma-separated)</Label>
                  <Input id="cp-roles" value={preferredRoleTypes} onChange={e => setRoleTypes(e.target.value)} placeholder="Accounting, Audit" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cp-skills">Preferred skills</Label>
                  <Input id="cp-skills" value={preferredSkills} onChange={e => setPreferredSkills(e.target.value)} placeholder="Tally, Excel, GST" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cp-locations">Preferred locations</Label>
                  <Input id="cp-locations" value={preferredLocations} onChange={e => setLocations(e.target.value)} placeholder="Kolkata, Remote" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cp-modes">Work modes</Label>
                  <Input id="cp-modes" value={workModes} onChange={e => setWorkModes(e.target.value)} placeholder="Onsite, Hybrid" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={save}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save profile
                </Button>
                {isDirty && !busy ? <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">Unsaved changes</Badge> : null}
                {!isDirty && savedAt && !busy ? (
                  <span className="flex items-center gap-1 text-xs text-success"><Check className="h-3.5 w-3.5" aria-hidden /> Saved {formatCareerDate(savedAt)}</span>
                ) : null}
              </div>
              {saveError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                  Could not save: {saveError} Your edits are still here — try again.
                </p>
              ) : null}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            <PauseCircle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Nothing here is shared automatically: applications send only a snapshot you assemble at submission time, and
            profile edits never silently rewrite an application you already sent. Riishe chats, documents, goals, notes
            and exam attempts are never part of your career data.
          </p>
        </div>
      )}
    </div>
  )
}

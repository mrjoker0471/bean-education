'use client'

// ─── Phase 7 — Career profile editor (#/career/profile) ──────────────────────
// The student's own career profile: headline, summary, preferences, public
// portfolio address, the visibility control and an employer-eye preview.
//
// Server contract honoured here (verified against src/lib/career.ts,
// src/lib/career-dto.ts and src/app/api/career/profile/route.ts):
//   • publicSlug is unique server-side (P2002 → HTTP 409 "That portfolio
//     address is already taken."); the client validates with the SAME regex
//     the server enforces: /^[a-z0-9](?:[a-z0-9-]{2,58}[a-z0-9])?$/ — so the
//     client never submits something the server would reject.
//   • No public profile page exists in Phase 7; the address is a reserved,
//     unique identifier. This is stated honestly in the UI.
//   • Employer discovery exposes ONLY what toDiscoverableCandidateDTO returns:
//     headline, a 240-character summary preview, the four preference lists,
//     ALL listed skills, projects with visibility=SHARED and status=ACTIVE,
//     credentials with status=ISSUED and portfolioShared=true, and an opaque
//     candidateRef. Never account ids, emails or contact details. The preview
//     below replicates exactly that field selection (documented in
//     replicatePublicSelection()).
//   • Discovery requires BOTH visibility=DISCOVERABLE AND an APPROVED
//     adult-eligibility review — both gates are server-side.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type {
  CareerCredentialClientDTO,
  CareerEligibilityClientDTO,
  CareerProfileResponse,
  CareerProjectClientDTO,
  CareerSkillClientDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  PauseCircle,
  ShieldCheck,
} from 'lucide-react'

/**
 * The exact regex the server enforces for publicSlug (careerProfileCreateSchema).
 * Deliberately NOT the looser ^[a-z0-9-]{3,60}$ — the server requires 4–60
 * characters that start AND end with a letter/digit, so client validation must
 * match to give accurate inline errors.
 */
const PUBLIC_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{2,58}[a-z0-9])?$/

/** Visibility options with the precise, server-verified meaning of each. */
const VISIBILITY_EXPLANATIONS = [
  {
    value: 'PRIVATE',
    label: 'Private',
    meaning: 'Only you can see this profile. It never appears in employer discovery, regardless of your eligibility status.',
  },
  {
    value: 'DISCOVERABLE',
    label: 'Discoverable',
    meaning: 'Eligible for employer discovery while your adult-eligibility review is APPROVED. Searching employers see: your headline, a 240-character summary preview, preferred roles/skills/locations/work modes, every listed skill, projects marked Shared and Active, and credentials marked Issued and Shared. Never your email or contact details.',
  },
  {
    value: 'PAUSED',
    label: 'Paused',
    meaning: 'Hidden from discovery immediately, without erasing your DISCOVERABLE choice or any portfolio data. Switch back to Discoverable to resume.',
  },
] as const

interface PortfolioBundle {
  skills: CareerSkillClientDTO[] | null
  projects: CareerProjectClientDTO[] | null
  credentials: CareerCredentialClientDTO[] | null
  failed: boolean
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

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
  const [slugInput, setSlugInput] = useState('')
  const [eligibility, setEligibility] = useState<CareerEligibilityClientDTO | null>(null)

  // Save-state machine: idle → saving → saved|error. `savedSnapshot` is the
  // canonical server state; dirty = current form differs from it.
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [slugConflict, setSlugConflict] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Portfolio data for the employer-eye preview (non-fatal if it fails).
  const [bundle, setBundle] = useState<PortfolioBundle>({ skills: null, projects: null, credentials: null, failed: false })
  const [previewOpen, setPreviewOpen] = useState(false)

  const load = useCallback(() => {
    setData(null)
    setFailed(null)
    Promise.allSettled([api.careerProfile(), api.careerSkills(), api.careerProjects(), api.careerCredentials()])
      .then(([profile, skills, projects, credentials]) => {
        if (profile.status === 'rejected') {
          setFailed(profile.reason instanceof Error ? profile.reason.message : 'Could not load your career profile.')
          return
        }
        const res = profile.value
        const snap = JSON.stringify([
          res.profile.headline ?? '',
          res.profile.summary ?? '',
          res.profile.preferredRoleTypes.join(', '),
          res.profile.preferredSkills.join(', '),
          res.profile.preferredLocations.join(', '),
          res.profile.workModes.join(', '),
          res.profile.visibility,
          res.profile.publicSlug ?? '',
        ])
        setData(res)
        setFailed(null)
        setHeadline(res.profile.headline ?? '')
        setSummary(res.profile.summary ?? '')
        setRoleTypes(res.profile.preferredRoleTypes.join(', '))
        setPreferredSkills(res.profile.preferredSkills.join(', '))
        setLocations(res.profile.preferredLocations.join(', '))
        setWorkModes(res.profile.workModes.join(', '))
        setVisibility(res.profile.visibility)
        setSlugInput(res.profile.publicSlug ?? '')
        setSavedSnapshot(snap)
        setSaveState('idle')
        setSaveError(null)
        setSlugConflict(false)
        setEligibility(res.eligibility)
        setBundle({
          skills: skills.status === 'fulfilled' ? skills.value.skills : null,
          projects: projects.status === 'fulfilled' ? projects.value.projects : null,
          credentials: credentials.status === 'fulfilled' ? credentials.value.credentials : null,
          failed: skills.status === 'rejected' || projects.status === 'rejected' || credentials.status === 'rejected',
        })
      })
  }, [])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify([
        headline,
        summary,
        preferredRoleTypes,
        preferredSkills,
        preferredLocations,
        workModes,
        visibility,
        slugInput,
      ]),
    [headline, summary, preferredRoleTypes, preferredSkills, preferredLocations, workModes, visibility, slugInput],
  )
  const dirty = currentSnapshot !== savedSnapshot

  const trimmedSlug = slugInput.trim()
  const slugChanged = trimmedSlug !== '' && trimmedSlug !== (data?.profile.publicSlug ?? '')
  const slugInvalid = slugChanged && !PUBLIC_SLUG_PATTERN.test(trimmedSlug)
  const slugValidNow = slugChanged && !slugInvalid

  const requestReview = async () => {
    try {
      const res = await api.requestEligibilityReview()
      setEligibility(res.eligibility)
      toast({ title: 'Review requested — BEAN administrators will verify your adult eligibility.' })
    } catch (e) {
      toast({ title: 'Could not request review', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    }
  }

  const save = async () => {
    if (saveState === 'saving' || !data) return // no duplicate submits
    if (slugInvalid) {
      setSlugConflict(false)
      return
    }
    setSaveState('saving')
    setSaveError(null)
    setSlugConflict(false)
    try {
      const res = await api.saveCareerProfile({
        headline: headline.trim() || undefined,
        summary: summary.trim() || undefined,
        preferredRoleTypes: preferredRoleTypes.split(',').map(s => s.trim()).filter(Boolean),
        preferredSkills: preferredSkills.split(',').map(s => s.trim()).filter(Boolean),
        preferredLocations: preferredLocations.split(',').map(s => s.trim()).filter(Boolean),
        workModes: workModes.split(',').map(s => s.trim()).filter(Boolean),
        visibility,
        // Empty input = keep the current address (the client type cannot send
        // null to clear; the server treats an omitted field as no change).
        ...(slugValidNow ? { publicSlug: trimmedSlug } : {}),
      })
      const updated = res.profile
      // Merge into the loaded profile while preserving eligibility + slug.
      setData(d => (d ? { ...d, profile: { ...d.profile, ...updated } } : d))
      setSlugInput(updated.publicSlug ?? slugInput)
      setSavedSnapshot(
        JSON.stringify([
          updated.headline ?? '',
          updated.summary ?? '',
          updated.preferredRoleTypes.join(', '),
          updated.preferredSkills.join(', '),
          updated.preferredLocations.join(', '),
          updated.workModes.join(', '),
          updated.visibility,
          updated.publicSlug ?? '',
        ]),
      )
      setSaveState('saved')
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 3000)
      toast({ title: 'Career profile saved' })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Please try again.'
      // Server 409 on slug uniqueness: Prisma P2002 → "That portfolio address
      // is already taken." Surface it inline next to the address field. Typed
      // content is preserved — nothing is reset on failure.
      if (message.toLowerCase().includes('already taken')) {
        setSlugConflict(true)
        setSaveError('This address is taken. Choose another portfolio address, then save again.')
      } else {
        setSaveError(message)
      }
      setSaveState('error')
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

  const eligibilityBadge = (status: string) =>
    status === 'APPROVED' ? 'border-success/40 bg-success/10 text-success'
      : status === 'PENDING_REVIEW' ? 'border-gold/40 bg-gold/10 text-gold'
        : status === 'DENIED' ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-elevated text-muted-foreground'

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
          {/* ── Visibility panel: precise, server-verified explanations ── */}
          <section aria-labelledby="visibility-heading" className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="visibility-heading" className="font-display text-base font-semibold text-foreground">Who can discover you</h2>
              <div className="text-sm">
                <span className="mr-2 text-xs text-muted-foreground">Adult-eligibility (safeguarding):</span>
                <Badge variant="outline" className={eligibilityBadge(eligibility?.status ?? 'NOT_ELIGIBLE')}>
                  {(eligibility?.status ?? 'NOT_ELIGIBLE').replace('_', ' ').toLowerCase()}
                </Badge>
                {eligibility?.status === 'NOT_ELIGIBLE' || eligibility?.status === 'DENIED' ? (
                  <Button size="sm" variant="outline" className="ml-2 border-gold/40 text-gold hover:bg-gold/10" onClick={requestReview}>
                    <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden /> Request review
                  </Button>
                ) : null}
                {eligibility?.status === 'DENIED' && eligibility.decisionReason ? (
                  <p className="mt-1 text-xs text-muted-foreground">Reason: {eligibility.decisionReason}</p>
                ) : null}
              </div>
            </div>
            <div role="radiogroup" aria-label="Profile visibility" className="mt-4 grid gap-2">
              {VISIBILITY_EXPLANATIONS.map(v => {
                const selected = visibility === v.value
                return (
                  <button
                    key={v.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`rounded-lg border p-3 text-left transition-colors ${selected ? 'border-gold/60 bg-gold/10' : 'border-border bg-elevated hover:border-gold/30'}`}
                    onClick={() => setVisibility(v.value)}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`h-3.5 w-3.5 rounded-full border ${selected ? 'border-gold bg-gold' : 'border-muted-foreground/50'}`} aria-hidden />
                      <span className={`text-sm font-medium ${selected ? 'text-gold' : 'text-foreground'}`}>{v.label}</span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{v.meaning}</span>
                  </button>
                )
              })}
            </div>
            {visibility === 'DISCOVERABLE' && eligibility?.status !== 'APPROVED' ? (
              <p className="mt-3 rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-muted-foreground">
                <Eye className="mr-1 inline h-3.5 w-3.5 text-gold" aria-hidden />
                Discovery stays off until your adult-eligibility review is approved — a server-side safeguard, not a UI
                preference. Private planning and portfolio building remain fully available.
              </p>
            ) : null}
            {visibility === 'DISCOVERABLE' && eligibility?.status === 'APPROVED' ? (
              <p className="mt-3 rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-muted-foreground">
                <Eye className="mr-1 inline h-3.5 w-3.5 text-success" aria-hidden />
                Verified employers can find the fields listed above — exactly those and nothing more. Pausing hides you
                instantly at any time.
              </p>
            ) : null}
          </section>

          {/* ── Fields + save-state ── */}
          <section aria-labelledby="profile-fields-heading" className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="profile-fields-heading" className="font-display text-base font-semibold text-foreground">Profile details</h2>
              {/* Save-state machine indicator */}
              <div aria-live="polite">
                {saveState === 'saving' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" aria-hidden /> Saving…
                  </span>
                ) : saveState === 'saved' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Saved
                  </span>
                ) : saveState === 'error' ? (
                  <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Save failed</Badge>
                ) : dirty ? (
                  <Badge variant="outline" className="border-gold/40 bg-gold/10 text-gold">Unsaved changes</Badge>
                ) : null}
              </div>
            </div>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="cp-headline">Headline</Label>
                <Input id="cp-headline" value={headline} onChange={e => setHeadline(e.target.value)} maxLength={120} placeholder="Aspiring CA with financial-analysis projects" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cp-summary">Summary</Label>
                <Textarea id="cp-summary" rows={4} value={summary} onChange={e => setSummary(e.target.value)} maxLength={2000} />
                <p className="text-xs text-muted-foreground">Discovery shows employers only the first 240 characters.</p>
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

              {/* ── Public portfolio address ── */}
              <div className="grid gap-2">
                <Label htmlFor="cp-slug">Portfolio address (optional, public identifier)</Label>
                <Input
                  id="cp-slug"
                  value={slugInput}
                  onChange={e => { setSlugInput(e.target.value); setSlugConflict(false) }}
                  maxLength={60}
                  placeholder="e.g. riya-financials"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={slugInvalid || slugConflict}
                  aria-describedby="cp-slug-help cp-slug-error"
                  className={slugInvalid || slugConflict ? 'border-destructive focus-visible:ring-destructive/40' : undefined}
                />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p id="cp-slug-help" className="text-xs text-muted-foreground">
                    Lowercase letters, digits and hyphens — must start and end with a letter or digit (4–60 characters).
                    Leave empty to keep your current address.
                  </p>
                  {trimmedSlug !== '' && !slugInvalid ? (
                    <p className="text-xs text-muted-foreground">
                      Format preview: <span className="font-mono text-gold">bean.education/p/{trimmedSlug}</span>
                    </p>
                  ) : null}
                </div>
                {slugInvalid ? (
                  <p id="cp-slug-error" role="alert" className="text-xs text-destructive">
                    Use 4–60 lowercase letters, digits or hyphens, starting and ending with a letter or digit.
                  </p>
                ) : null}
                {slugConflict ? (
                  <p id="cp-slug-error" role="alert" className="text-xs text-destructive">This address is taken. Try another one.</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Honest note: public profile pages are not part of Phase 7 yet — this address is a unique identifier
                  reserved for you (uniqueness enforced server-side). Today, employers reach your portfolio through
                  candidate discovery and applications.
                </p>
              </div>

              {saveError ? (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{saveError}</p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={!dirty || saveState === 'saving' || slugInvalid} onClick={save}>
                  {saveState === 'saving' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save profile
                </Button>
                {!dirty && saveState !== 'saving' ? <span className="text-xs text-muted-foreground">All changes saved.</span> : null}
              </div>
            </div>
          </section>

          {/* ── Employer-eye preview ── */}
          <PreviewSection
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            visibility={visibility}
            eligibilityStatus={eligibility?.status ?? 'NOT_ELIGIBLE'}
            headline={headline}
            summary={summary}
            preferredRoleTypes={preferredRoleTypes.split(',').map(s => s.trim()).filter(Boolean)}
            preferredSkills={preferredSkills.split(',').map(s => s.trim()).filter(Boolean)}
            preferredLocations={preferredLocations.split(',').map(s => s.trim()).filter(Boolean)}
            workModes={workModes.split(',').map(s => s.trim()).filter(Boolean)}
            bundle={bundle}
          />

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

// ─── Employer-eye preview (privacy-safe) ─────────────────────────────────────

/**
 * Client-side replica of the server's discovery field selection
 * (toDiscoverableCandidateDTO in src/lib/career-dto.ts + the candidates route
 * query): headline, 240-char summary preview, preference lists, ALL skills,
 * projects (SHARED + ACTIVE only), credentials (ISSUED + portfolioShared only).
 * This function exists because the server mapper imports Prisma types and the
 * db client and cannot be imported from client code — the field selection here
 * is kept in lockstep with that server contract.
 */
function replicatePublicSelection(
  summary: string,
  projects: CareerProjectClientDTO[] | null,
  credentials: CareerCredentialClientDTO[] | null,
) {
  return {
    summaryPreview: summary ? summary.slice(0, 240) : null,
    sharedProjects: (projects ?? []).filter(p => p.visibility === 'SHARED' && p.status === 'ACTIVE'),
    sharedCredentials: (credentials ?? []).filter(c => c.status === 'ISSUED' && c.portfolioShared),
  }
}

function PreviewSection({
  open,
  onOpenChange,
  visibility,
  eligibilityStatus,
  headline,
  summary,
  preferredRoleTypes,
  preferredSkills,
  preferredLocations,
  workModes,
  bundle,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  visibility: string
  eligibilityStatus: string
  headline: string
  summary: string
  preferredRoleTypes: string[]
  preferredSkills: string[]
  preferredLocations: string[]
  workModes: string[]
  bundle: PortfolioBundle
}) {
  const { summaryPreview, sharedProjects, sharedCredentials } = replicatePublicSelection(summary, bundle.projects, bundle.credentials)
  const hidden = visibility !== 'DISCOVERABLE'

  return (
    <section aria-labelledby="preview-heading" className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="preview-heading" className="font-display text-base font-semibold text-foreground">Employer-eye preview</h2>
        <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" aria-expanded={open} onClick={() => onOpenChange(!open)}>
          <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {open ? 'Hide preview' : 'Preview as employers see it'}
        </Button>
      </div>
      {open ? (
        <div className="mt-4">
          {hidden ? (
            <p className="rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-muted-foreground">
              <EyeOff className="mr-1 inline h-3.5 w-3.5 text-gold" aria-hidden />
              Your profile is currently hidden from discovery ({visibility.toLowerCase()}). The preview below is the
              neutral view of what WOULD be exposed if you switch to Discoverable — right now employers cannot see any
              of it.
            </p>
          ) : eligibilityStatus !== 'APPROVED' ? (
            <p className="rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-muted-foreground">
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-gold" aria-hidden />
              Truthful status: you chose DISCOVERABLE, but discovery also requires an APPROVED adult-eligibility review —
              until then employers cannot find you, and the preview below is what they will see once approved.
            </p>
          ) : (
            <p className="rounded-lg border border-success/30 bg-success/5 p-3 text-xs text-muted-foreground">
              <Eye className="mr-1 inline h-3.5 w-3.5 text-success" aria-hidden />
              This is what verified employers see in candidate discovery — exactly these fields and nothing more.
            </p>
          )}

          <div className="mt-4 rounded-lg border border-border bg-elevated p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Candidate</p>
            <h3 className="mt-1 font-display text-base font-semibold text-foreground">{headline.trim() || 'No headline yet'}</h3>
            {summaryPreview ? (
              <p className="mt-1 text-sm text-muted-foreground">{summaryPreview}{(summary ?? '').length > 240 ? '…' : ''}</p>
            ) : null}

            <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
              {preferredRoleTypes.length > 0 ? <p><span className="font-medium text-foreground">Roles:</span> {preferredRoleTypes.join(', ')}</p> : null}
              {preferredSkills.length > 0 ? <p><span className="font-medium text-foreground">Preferred skills:</span> {preferredSkills.join(', ')}</p> : null}
              {preferredLocations.length > 0 ? <p><span className="font-medium text-foreground">Locations:</span> {preferredLocations.join(', ')}</p> : null}
              {workModes.length > 0 ? <p><span className="font-medium text-foreground">Work modes:</span> {workModes.join(', ')}</p> : null}
            </div>

            {/* Skills: ALL listed skills enter discovery (no per-skill share flag). */}
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Skills</p>
              {bundle.skills === null ? (
                <p className="mt-1 text-xs text-muted-foreground">{bundle.failed ? 'Could not load skills right now.' : 'Loading…'}</p>
              ) : bundle.skills.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">None listed yet.</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {bundle.skills.map(s => (
                    <li key={s.id}>
                      <Badge variant="outline" className="border-border bg-card text-foreground">
                        {s.skillName}{s.proficiency ? ` · ${s.proficiency}` : ''}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Projects: only SHARED + ACTIVE, matching the server query. */}
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Projects (shared only)</p>
              {bundle.projects === null ? (
                <p className="mt-1 text-xs text-muted-foreground">{bundle.failed ? 'Could not load projects right now.' : 'Loading…'}</p>
              ) : sharedProjects.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">No shared projects — employers see none.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {sharedProjects.map(p => (
                    <li key={p.id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{p.title}</span>
                      {p.category ? ` · ${p.category.toLowerCase().replace(/_/g, ' ')}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Credentials: only ISSUED + portfolioShared, matching the server query. */}
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Credentials (shared only)</p>
              {bundle.credentials === null ? (
                <p className="mt-1 text-xs text-muted-foreground">{bundle.failed ? 'Could not load credentials right now.' : 'Loading…'}</p>
              ) : sharedCredentials.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">No shared credentials — employers see none.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {sharedCredentials.map(c => (
                    <li key={c.id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{c.credentialName}</span>
                      {' '}{c.issuer.displayName || c.issuer.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
              Your email and other contact details are never part of discovery. Contact details are only shared when you
              consent on a specific application.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

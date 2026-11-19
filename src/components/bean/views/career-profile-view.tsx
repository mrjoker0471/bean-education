'use client'

// ─── Phase 7 — Career profile editor (#/career/profile) ──────────────────────
// The student's own career profile: headline, summary, preferences and the
// visibility control. The adult-eligibility state is shown truthfully — the
// review is performed by BEAN administrators, and until it is APPROVED the
// server blocks discovery and applications regardless of what the UI shows.

import { useCallback, useEffect, useState } from 'react'
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
import { ArrowLeft, Eye, EyeOff, Loader2, PauseCircle, ShieldCheck } from 'lucide-react'

const VISIBILITY_OPTIONS = [
  { value: 'PRIVATE', label: 'Private — only you can see this' },
  { value: 'DISCOVERABLE', label: 'Discoverable — verified employers may find me' },
  { value: 'PAUSED', label: 'Paused — hidden from discovery, choice kept' },
]

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
  const [eligibility, setEligibility] = useState<CareerEligibilityClientDTO | null>(null)
  const [busy, setBusy] = useState(false)

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
        setEligibility(res.eligibility)
      })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your career profile.'))
  }, [])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

  const save = async () => {
    setBusy(true)
    try {
      const res = await api.saveCareerProfile({
        headline: headline.trim() || undefined,
        summary: summary.trim() || undefined,
        preferredRoleTypes: preferredRoleTypes.split(',').map(s => s.trim()).filter(Boolean),
        preferredSkills: preferredSkills.split(',').map(s => s.trim()).filter(Boolean),
        preferredLocations: preferredLocations.split(',').map(s => s.trim()).filter(Boolean),
        workModes: workModes.split(',').map(s => s.trim()).filter(Boolean),
        visibility,
      })
      toast({ title: 'Career profile saved' })
      setData(d => (d ? { ...d, profile: res.profile } : d))
    } catch (e) {
      toast({ title: 'Could not save', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
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
              </div>
              <div className="text-sm">
                <p className="text-xs text-muted-foreground">Adult-eligibility (safeguarding)</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="outline" className={eligibilityBadge(eligibility?.status ?? 'NOT_ELIGIBLE')}>
                    {(eligibility?.status ?? 'NOT_ELIGIBLE').replace('_', ' ').toLowerCase()}
                  </Badge>
                  {eligibility?.status === 'NOT_ELIGIBLE' || eligibility?.status === 'DENIED' ? (
                    <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" disabled={busy} onClick={requestReview}>
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden /> Request review
                    </Button>
                  ) : null}
                </div>
                {eligibility?.status === 'DENIED' && eligibility.decisionReason ? (
                  <p className="mt-1 text-xs text-muted-foreground">Reason: {eligibility.decisionReason}</p>
                ) : null}
              </div>
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
                Verified employers can find the fields you marked discoverable. Pausing hides you instantly at any time.
              </p>
            ) : null}
          </div>

          {/* Fields */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="cp-headline">Headline</Label>
                <Input id="cp-headline" value={headline} onChange={e => setHeadline(e.target.value)} maxLength={120} placeholder="Aspiring CA with financial-analysis projects" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cp-summary">Summary</Label>
                <Textarea id="cp-summary" rows={4} value={summary} onChange={e => setSummary(e.target.value)} maxLength={2000} />
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
              <div>
                <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={save}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save profile
                </Button>
              </div>
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

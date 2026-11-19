'use client'

// ─── Phase 7 — Opportunity browse + detail/apply (#/career/opportunities[/:id])
// Lists admin-moderated PUBLISHED opportunities from verified employer
// organizations. The apply dialog assembles the snapshot EXPLICITLY: the
// student selects exactly which profile fields, skills, projects and
// credentials to include, and contact sharing is a separate explicit consent.
// The server re-validates eligibility and the deadline at submission time.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type {
  CareerCredentialClientDTO,
  CareerProfileResponse,
  CareerProjectClientDTO,
  CareerSkillClientDTO,
  OpportunitiesBrowseResponse,
  PublicOpportunityClientDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { ArrowLeft, Briefcase, Building2, Loader2, MapPin, Search, ShieldAlert } from 'lucide-react'

const TYPE_OPTIONS = [
  { value: 'ALL', label: 'All types' },
  { value: 'JOB', label: 'Jobs' },
  { value: 'INTERNSHIP', label: 'Internships' },
  { value: 'APPRENTICESHIP', label: 'Apprenticeships' },
  { value: 'PROJECT', label: 'Projects' },
]

export function OpportunityBrowseView() {
  const navigate = useAppStore(s => s.navigate)
  const authChecked = useAppStore(s => s.authChecked)
  const [q, setQ] = useState('')
  const [type, setType] = useState('ALL')
  const [data, setData] = useState<OpportunitiesBrowseResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback((search: string, t: string) => {
    setData(null)
    api.browseOpportunities({ q: search || undefined, type: t && t !== 'ALL' ? t : undefined })
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load opportunities.'))
  }, [])

  useEffect(() => {
    if (!authChecked) return
    const t = setTimeout(() => load(q, type), q ? 250 : 0)
    return () => clearTimeout(t)
  }, [authChecked, q, type, load])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Career</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Jobs & internships</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Every listing comes from a BEAN-verified employer organization and was reviewed by a moderator before publication.
        BEAN never charges for applications, and employers only see what you explicitly share.
      </p>

      <div className="mt-6 grid gap-2 sm:grid-cols-[1fr_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search opportunities" className="pl-9" placeholder="Search roles, companies, skills…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger aria-label="Opportunity type"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent className="border-border bg-popover">
            {TYPE_OPTIONS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6">
        {failed ? (
          <EmptyState icon={Briefcase} title="Could not load opportunities" description={failed} actionLabel="Try again" onAction={() => load(q, type)} />
        ) : !data ? (
          <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading opportunities"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : data.opportunities.length === 0 ? (
          <EmptyState icon={Briefcase} title="No opportunities right now" description="Verified employers publish new listings regularly — check back soon." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.opportunities.map(o => (
              <button
                key={o.id}
                type="button"
                className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
                onClick={() => navigate({ view: 'career-opportunity', opportunityId: o.id })}
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-display text-base font-semibold text-foreground">{o.title}</h2>
                  <Badge variant="outline" className="border-gold/40 text-gold">{o.opportunityType.toLowerCase()}</Badge>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5 text-gold" aria-hidden />
                  {o.organization.displayName || o.organization.name}
                  {o.organization.verificationStatus === 'APPROVED' ? <BadgeCheckInline /> : null}
                </p>
                {o.location ? (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 text-gold" aria-hidden /> {o.location}{o.workMode ? ` · ${o.workMode.toLowerCase()}` : ''}
                  </p>
                ) : null}
                {o.applicationDeadline ? (
                  <p className="mt-1 text-xs text-muted-foreground">Apply by {new Date(o.applicationDeadline).toLocaleDateString()}</p>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function BadgeCheckInline() {
  return <span className="text-xs text-success" title="Identity reviewed by BEAN" aria-label="Identity reviewed by BEAN">✓</span>
}

// ─── Detail + apply ──────────────────────────────────────────────────────────

export function OpportunityDetailView({ opportunityId }: { opportunityId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [data, setData] = useState<PublicOpportunityClientDTO | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [profile, setProfile] = useState<CareerProfileResponse | null>(null)
  const [skills, setSkills] = useState<CareerSkillClientDTO[]>([])
  const [projects, setProjects] = useState<CareerProjectClientDTO[]>([])
  const [credentials, setCredentials] = useState<CareerCredentialClientDTO[]>([])
  const [applyOpen, setApplyOpen] = useState(false)
  const [selected, setSelected] = useState<{ skills: Set<string>; projects: Set<string>; credentials: Set<string>; includeHeadline: boolean; includeSummary: boolean; shareContact: boolean }>({
    skills: new Set(), projects: new Set(), credentials: new Set(), includeHeadline: true, includeSummary: true, shareContact: false,
  })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setData(null)
    api.opportunityDetail(opportunityId)
      .then(res => { setData(res.opportunity); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load the opportunity.'))
  }, [opportunityId])

  useEffect(() => {
    if (!authChecked) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, load])

  useEffect(() => {
    if (!applyOpen || !authedStudent) return
    const t = setTimeout(() => {
      Promise.all([api.careerProfile(), api.careerSkills(), api.careerProjects(), api.careerCredentials()])
        .then(([p, s, pr, c]) => { setProfile(p); setSkills(s.skills); setProjects(pr.projects.filter(x => x.visibility === 'SHARED')); setCredentials(c.credentials.filter(x => x.status === 'ISSUED' && x.portfolioShared)) })
        .catch(() => undefined)
    }, 0)
    return () => clearTimeout(t)
  }, [applyOpen, authedStudent])

  const submitApplication = async () => {
    if (!profile) return
    setBusy(true)
    try {
      const snapshot: Record<string, unknown> = {}
      if (selected.includeHeadline) snapshot['headline'] = profile.profile.headline
      if (selected.includeSummary) snapshot['summary'] = profile.profile.summary
      if (note.trim()) snapshot['note'] = note.trim()
      snapshot['skills'] = skills.filter(s => selected.skills.has(s.id)).map(s => ({ skillName: s.skillName, verificationLabel: s.verificationLabel, proficiency: s.proficiency }))
      snapshot['projects'] = projects.filter(p => selected.projects.has(p.id)).map(p => ({ title: p.title, description: p.description, projectUrl: p.projectUrl, category: p.category }))
      snapshot['credentials'] = credentials.filter(c => selected.credentials.has(c.id)).map(c => ({ credentialName: c.credentialName, issuer: c.issuer.displayName || c.issuer.name, issuedDate: c.issuedDate }))
      const res = await api.applyToOpportunity(opportunityId, { snapshot, contactSharingConsent: selected.shareContact })
      toast({ title: 'Application submitted — track it under My applications.' })
      setApplyOpen(false)
      void res
      navigate({ view: 'career-applications' })
    } catch (e) {
      toast({ title: 'Could not apply', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  if (!authChecked) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }

  if (failed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={Briefcase} title="Could not open this opportunity" description={failed} actionLabel="Back to listings" onAction={() => navigate({ view: 'career-opportunities' })} />
      </div>
    )
  }
  if (!data) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }

  const deadlinePassed = data.applicationDeadline ? new Date(data.applicationDeadline).getTime() <= Date.now() : false

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Button variant="ghost" className="-ml-2 mb-3 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'career-opportunities' })}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> All opportunities
      </Button>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">{data.title}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4 text-gold" aria-hidden />
              {data.organization.displayName || data.organization.name}
              {data.organization.verificationStatus === 'APPROVED' ? (
                <Badge variant="outline" className="border-success/40 text-success">Identity reviewed by BEAN</Badge>
              ) : null}
            </p>
          </div>
          <Badge variant="outline" className="border-gold/40 text-gold">{data.opportunityType.toLowerCase()}</Badge>
        </div>

        <div className="mt-4 grid gap-1 text-sm text-muted-foreground">
          {data.location ? <p><span className="text-gold">Location:</span> {data.location}{data.workMode ? ` · ${data.workMode}` : ''}</p> : null}
          {data.compensationDescription ? <p><span className="text-gold">Compensation (informational):</span> {data.compensationDescription}</p> : null}
          {data.applicationDeadline ? <p><span className="text-gold">Apply by:</span> {new Date(data.applicationDeadline).toLocaleDateString()}</p> : null}
        </div>

        {data.eligibilityDescription ? (
          <p className="mt-4 rounded-lg border border-border bg-elevated p-3 text-sm text-muted-foreground">Eligibility: {data.eligibilityDescription}</p>
        ) : null}

        <div className="mt-6">
          <h2 className="font-display text-base font-semibold text-foreground">About the role</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{data.description}</p>
        </div>
        {data.responsibilities ? (
          <div className="mt-4">
            <h2 className="font-display text-base font-semibold text-foreground">Responsibilities</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{data.responsibilities}</p>
          </div>
        ) : null}
        {data.requiredSkills.length > 0 ? (
          <div className="mt-4">
            <h2 className="font-display text-base font-semibold text-foreground">Required skills</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.requiredSkills.map(s => <Badge key={s} variant="outline" className="border-border text-muted-foreground">{s}</Badge>)}
            </div>
          </div>
        ) : null}

        <div className="mt-6 border-t border-border pt-4">
          {!authedStudent ? (
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>Sign in to apply</Button>
          ) : deadlinePassed ? (
            <p className="text-sm text-muted-foreground">The application deadline has passed.</p>
          ) : (
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setApplyOpen(true)}>Apply with a selected snapshot</Button>
          )}
        </div>
      </div>

      {/* Apply dialog — explicit snapshot assembly */}
      <Dialog open={applyOpen} onOpenChange={o => !busy && setApplyOpen(o)}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Choose exactly what to share</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              The employer receives only your selection, frozen at submission. Nothing else from your account — no Riishe
              data, no learning history — is ever included.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={selected.includeHeadline} onCheckedChange={v => setSelected(s => ({ ...s, includeHeadline: v === true }))} aria-label="Include headline" />
              Headline {profile?.profile.headline ? <span className="text-xs text-muted-foreground">({profile.profile.headline})</span> : null}
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={selected.includeSummary} onCheckedChange={v => setSelected(s => ({ ...s, includeSummary: v === true }))} aria-label="Include summary" />
              Summary
            </label>

            {skills.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {skills.map(s => (
                    <label key={s.id} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={selected.skills.has(s.id)}
                        onCheckedChange={v => setSelected(sel => { const n = new Set(sel.skills); if (v === true) n.add(s.id); else n.delete(s.id); return { ...sel, skills: n } })}
                        aria-label={`Include ${s.skillName}`}
                      />
                      {s.skillName}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {projects.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">Shared projects</p>
                <div className="space-y-2">
                  {projects.map(p => (
                    <label key={p.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={selected.projects.has(p.id)}
                        onCheckedChange={v => setSelected(sel => { const n = new Set(sel.projects); if (v === true) n.add(p.id); else n.delete(p.id); return { ...sel, projects: n } })}
                        aria-label={`Include ${p.title}`}
                      />
                      <span className="font-medium text-foreground">{p.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {credentials.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">Shared credentials</p>
                <div className="space-y-2">
                  {credentials.map(c => (
                    <label key={c.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={selected.credentials.has(c.id)}
                        onCheckedChange={v => setSelected(sel => { const n = new Set(sel.credentials); if (v === true) n.add(c.id); else n.delete(c.id); return { ...sel, credentials: n } })}
                        aria-label={`Include ${c.credentialName}`}
                      />
                      <span className="font-medium text-foreground">{c.credentialName}</span> · {c.issuer.displayName || c.issuer.name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="flex items-start gap-2 rounded-lg border border-gold/30 bg-gold/5 p-3 text-sm text-muted-foreground">
              <Checkbox
                checked={selected.shareContact}
                onCheckedChange={v => setSelected(s => ({ ...s, shareContact: v === true }))}
                aria-label="Share contact email"
              />
              <span>
                Share my account email with this employer. Off by default — without this, the employer has no way to
                contact you outside BEAN.
              </span>
            </label>

            <div className="grid gap-2">
              <Label htmlFor="apply-note">Note to the employer (optional)</Label>
              <Textarea id="apply-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={600} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setApplyOpen(false)}>Cancel</Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={submitApplication}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Submit application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
        BEAN never charges for applications and no employer can ask you to pay at any stage. Suspicious listings can be
        reported from My applications — a report never auto-suspends anyone; BEAN investigates first.
      </p>
    </div>
  )
}

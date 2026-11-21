'use client'

// ─── Phase 7 — Career hub dashboard (#/career) ───────────────────────────────
// Data-backed student career dashboard. Everything shown is real server
// state: profile visibility, adult-eligibility review status, portfolio
// counts, application breakdown and derived next steps. Six fetches run in
// parallel via Promise.allSettled so one failing section never kills the
// dashboard — each section renders its own loading/error/retry state.
//
// Honesty rules preserved: discovery stays off until an adult-eligibility
// review is APPROVED (a server-side safeguard), no scores or ranks are
// invented, and employer tools appear only for members of approved employer
// organizations (server authorization remains authoritative).

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/lib/store'
import {
  Award, Briefcase, Building2, CheckCircle2, ChevronRight, Eye, FileText,
  Inbox, Lightbulb, Loader2, Plus, Search, ShieldQuestion, Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { MyOrganizationsResponse } from '@/lib/types'
import type {
  CareerCredentialClientDTO, CareerEligibilityClientDTO, CareerProfileResponse,
  CareerProjectClientDTO, CareerSkillClientDTO, OwnApplicationClientDTO,
} from '@/lib/types'
import { EmptyState } from '@/components/bean/empty-state'
import { LogIn } from 'lucide-react'
import {
  applicationStatusChips, careerCounts, discoveryEligibility, discoveryToneClass,
  eligibilityBadgeClass, eligibilityHumanLabel, nextCareerActions,
  visibilityBadgeClass, visibilityDescription, visibilityHumanLabel,
} from '@/lib/career-ui'

interface Slot<T> {
  data: T | null
  error: string | null
  loading: boolean
}

type SlotKey = 'profile' | 'eligibility' | 'skills' | 'projects' | 'credentials' | 'applications'

interface Slots {
  profile: Slot<CareerProfileResponse>
  eligibility: Slot<CareerEligibilityClientDTO>
  skills: Slot<CareerSkillClientDTO[]>
  projects: Slot<CareerProjectClientDTO[]>
  credentials: Slot<CareerCredentialClientDTO[]>
  applications: Slot<OwnApplicationClientDTO[]>
}

const ALL_LOADING: Slots = {
  profile: { data: null, error: null, loading: true },
  eligibility: { data: null, error: null, loading: true },
  skills: { data: null, error: null, loading: true },
  projects: { data: null, error: null, loading: true },
  credentials: { data: null, error: null, loading: true },
  applications: { data: null, error: null, loading: true },
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.')

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg border border-border bg-elevated ${className ?? ''}`} aria-hidden />
}

function SectionRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <p className="text-sm text-destructive">{message}</p>
      <Button size="sm" variant="outline" className="mt-2 border-border text-muted-foreground hover:bg-elevated" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

export function CareerView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const [orgs, setOrgs] = useState<MyOrganizationsResponse | null>(null)
  const [slots, setSlots] = useState<Slots>(ALL_LOADING)

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(() => {
      api.myOrganizations().then(setOrgs).catch(() => setOrgs({ organizations: [] }))
    }, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent])

  const loadAll = useCallback(() => {
    setSlots(ALL_LOADING)
    const jobs = [
      api.careerProfile(),
      api.careerEligibility().then(r => r.eligibility),
      api.careerSkills().then(r => r.skills),
      api.careerProjects().then(r => r.projects),
      api.careerCredentials().then(r => r.credentials),
      api.myApplications().then(r => r.applications),
    ] as const

    // One failure must never kill the dashboard — each section resolves
    // independently through Promise.allSettled and renders its own state.
    void Promise.allSettled(jobs).then(([profile, eligibility, skills, projects, credentials, applications]) => {
      const toSlot = <T,>(r: PromiseSettledResult<T>): Slot<T> =>
        r.status === 'fulfilled' ? { data: r.value, error: null, loading: false } : { data: null, error: errorMessage(r.reason), loading: false }
      setSlots({
        profile: toSlot(profile),
        eligibility: toSlot(eligibility),
        skills: toSlot(skills),
        projects: toSlot(projects),
        credentials: toSlot(credentials),
        applications: toSlot(applications),
      })
    })
  }, [])

  const retryOne = useCallback((key: SlotKey) => {
    setSlots(prev => ({ ...prev, [key]: { ...prev[key], loading: true, error: null } }))
    const job =
      key === 'profile' ? api.careerProfile()
        : key === 'eligibility' ? api.careerEligibility().then(r => r.eligibility)
          : key === 'skills' ? api.careerSkills().then(r => r.skills)
            : key === 'projects' ? api.careerProjects().then(r => r.projects)
              : key === 'credentials' ? api.careerCredentials().then(r => r.credentials)
                : api.myApplications().then(r => r.applications)
    job.then(
      data => setSlots(prev => ({ ...prev, [key]: { ...prev[key], data, error: null, loading: false } }) as Slots),
      e => setSlots(prev => ({ ...prev, [key]: { ...prev[key], loading: false, error: errorMessage(e) } }) as Slots),
    )
  }, [])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(loadAll, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, loadAll])

  const employerOrgs = (orgs?.organizations ?? []).filter(
    o => o.organization.orgType === 'EMPLOYER' && o.organization.verificationStatus === 'APPROVED' && o.membership.status === 'ACTIVE',
  )

  if (!authChecked) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading career hub">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={LogIn} title="Sign in to build your career portfolio" description="Your portfolio is private by default — you choose what is ever shared." actionLabel="Sign in" onAction={() => navigate({ view: 'auth' })} />
      </div>
    )
  }

  const profile = slots.profile.data?.profile ?? null
  // Eligibility: its own endpoint first, falling back to the identical value
  // embedded in the profile response (same server data) for resilience.
  const eligibility = slots.eligibility.data ?? slots.profile.data?.eligibility ?? null

  const counts = careerCounts({
    skills: slots.skills.data,
    projects: slots.projects.data,
    credentials: slots.credentials.data,
    applications: slots.applications.data,
  })
  const chips = applicationStatusChips(slots.applications.data)

  const actionsSettled = !slots.profile.loading && !slots.eligibility.loading && !slots.skills.loading && !slots.projects.loading && !slots.credentials.loading
  const nextActions = nextCareerActions({
    profile: profile ? { headline: profile.headline, visibility: profile.visibility } : null,
    eligibility: eligibility ? { status: eligibility.status } : null,
    skills: slots.skills.data,
    projects: slots.projects.data,
    credentials: slots.credentials.data,
  })

  const discovery = discoveryEligibility(profile?.visibility ?? 'PRIVATE', eligibility?.status ?? 'NOT_ELIGIBLE')

  const quickActions = [
    { key: 'qa-profile', title: 'Edit career profile', icon: FileText, description: 'Headline, summary, preferences and visibility.', view: 'career-profile' as const },
    { key: 'qa-skills', title: 'Manage skills', icon: Wrench, description: 'Honest labels — self-declared or verified.', view: 'career-portfolio' as const },
    { key: 'qa-project', title: 'Add project', icon: Plus, description: 'Academic, personal, internship or research work.', view: 'career-portfolio' as const },
    { key: 'qa-credentials', title: 'View credentials', icon: Award, description: 'Institution-issued credentials you control sharing for.', view: 'career-portfolio' as const },
    { key: 'qa-opportunities', title: 'Browse opportunities', icon: Briefcase, description: 'Moderated listings from BEAN-verified employers.', view: 'career-opportunities' as const },
    { key: 'qa-applications', title: 'Track applications', icon: Inbox, description: 'Statuses, employer notes, withdraw anytime.', view: 'career-applications' as const },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Career</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Your career, under your control</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Nothing is published automatically. Employer discovery only ever sees what you explicitly share, and only after
        BEAN approves your adult-eligibility review — a safeguarding requirement that keeps school-age learners out of
        employer reach entirely.
      </p>

      <div className="mt-8 space-y-6">
        {/* ── Profile status ─────────────────────────────────────────────── */}
        <section aria-labelledby="career-status-heading" className="rounded-xl border border-border bg-card p-5">
          <h2 id="career-status-heading" className="font-display text-lg font-semibold text-foreground">Profile status</h2>
          {slots.profile.loading ? (
            <div className="mt-3 space-y-3" role="status" aria-label="Loading profile status">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : slots.profile.error || !profile ? (
            <div className="mt-3">
              <SectionRetry message={slots.profile.error ?? 'Profile unavailable.'} onRetry={() => retryOne('profile')} />
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={visibilityBadgeClass(profile.visibility)}>{visibilityHumanLabel(profile.visibility)}</Badge>
                {profile.headline ? <span className="text-sm text-foreground">{profile.headline}</span> : <span className="text-sm text-muted-foreground">No headline yet</span>}
              </div>
              <p className="text-xs text-muted-foreground">{visibilityDescription(profile.visibility)}</p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Adult-eligibility (safeguarding):</span>
                {slots.eligibility.loading ? (
                  <Skeleton className="h-5 w-32" />
                ) : slots.eligibility.error && !eligibility ? (
                  <span className="text-xs text-destructive">{slots.eligibility.error}</span>
                ) : (
                  <Badge variant="outline" className={eligibilityBadgeClass(eligibility?.status ?? 'NOT_ELIGIBLE')}>
                    {eligibilityHumanLabel(eligibility?.status ?? 'NOT_ELIGIBLE')}
                  </Badge>
                )}
              </div>
              <div className={`flex items-center gap-2 text-sm ${discoveryToneClass(discovery.tone)}`}>
                {discovery.tone === 'eligible' ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> : <Eye className="h-4 w-4 shrink-0" aria-hidden />}
                <span>{discovery.line}</span>
              </div>
              {profile.visibility === 'DISCOVERABLE' && profile.publicSlug ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2">
                  <span className="text-xs text-muted-foreground">Public slug</span>
                  <code className="break-all text-xs text-foreground">{profile.publicSlug}</code>
                </div>
              ) : null}
              <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'career-profile' })}>
                Edit profile settings
              </Button>
            </div>
          )}
        </section>

        {/* ── Counts row (real) ──────────────────────────────────────────── */}
        <section aria-label="Portfolio counts">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { key: 'skills', label: 'Skills', value: counts.skills, note: counts.skillsVerified === null ? null : `${counts.skillsVerified} verified` },
              { key: 'projects', label: 'Projects', value: counts.projects, note: counts.projectsShared === null ? null : `${counts.projectsShared} shared` },
              { key: 'credentials', label: 'Credentials', value: counts.credentials, note: counts.credentialsShared === null ? null : `${counts.credentialsShared} shared` },
              { key: 'applications', label: 'Applications', value: counts.applications, note: 'total submitted' },
            ].map(c => (
              <div key={c.key} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
                {c.value === null ? (
                  <p className="mt-1 font-display text-2xl font-semibold text-muted-foreground" aria-label={`${c.label} unavailable`}>—</p>
                ) : (
                  <p className="mt-1 font-display text-2xl font-semibold text-foreground">{c.value}</p>
                )}
                {c.note ? <p className="mt-1 text-xs text-muted-foreground">{c.note}</p> : null}
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Applications by status ───────────────────────────────────── */}
          <section aria-labelledby="career-apps-heading" className="rounded-xl border border-border bg-card p-5">
            <h2 id="career-apps-heading" className="font-display text-lg font-semibold text-foreground">Applications by status</h2>
            {slots.applications.loading ? (
              <div className="mt-3 flex flex-wrap gap-2" role="status" aria-label="Loading applications">
                <Skeleton className="h-6 w-24" /><Skeleton className="h-6 w-28" /><Skeleton className="h-6 w-20" />
              </div>
            ) : slots.applications.error || !slots.applications.data ? (
              <div className="mt-3">
                <SectionRetry message={slots.applications.error ?? 'Applications unavailable.'} onRetry={() => retryOne('applications')} />
              </div>
            ) : slots.applications.data.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-border bg-elevated p-4 text-center">
                <p className="text-sm text-muted-foreground">No applications yet.</p>
                <Button size="sm" variant="outline" className="mt-3 border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'career-opportunities' })}>
                  <Briefcase className="mr-2 h-3.5 w-3.5" aria-hidden /> Browse opportunities
                </Button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {chips.map(chip => (
                  <button
                    key={chip.status}
                    type="button"
                    className="cursor-pointer"
                    onClick={() => navigate({ view: 'career-applications' })}
                    aria-label={`${chip.label}: ${chip.count} application${chip.count === 1 ? '' : 's'} — open tracker`}
                  >
                    <Badge variant="outline" className={`${chip.badgeClass} hover:opacity-80`}>{chip.label} · {chip.count}</Badge>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── Recommended next steps (pure derived logic) ──────────────── */}
          {actionsSettled && nextActions.length > 0 ? (
            <section aria-labelledby="career-next-heading" className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-gold" aria-hidden />
                <h2 id="career-next-heading" className="font-display text-lg font-semibold text-foreground">Recommended next steps</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Derived from your actual portfolio state — no scores, no ranks.</p>
              <ul className="mt-3 space-y-2">
                {nextActions.map(a => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="exam-card-hover flex w-full items-center gap-3 rounded-lg border border-border bg-elevated p-3 text-left transition-colors hover:border-gold/40"
                      onClick={() => navigate({ view: a.target })}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">{a.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{a.description}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* ── Quick actions ──────────────────────────────────────────────── */}
        <section aria-labelledby="career-quick-heading">
          <h2 id="career-quick-heading" className="font-display text-lg font-semibold text-foreground">Quick actions</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {quickActions.map(t => (
              <button
                key={t.key}
                type="button"
                className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
                onClick={() => navigate({ view: t.view })}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-gold/30 bg-gold/10" aria-hidden>
                  <t.icon className="h-5 w-5 text-gold" />
                </span>
                <h3 className="mt-3 font-display text-base font-semibold text-foreground">{t.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
              </button>
            ))}
          </div>
        </section>
      </div>

      {employerOrgs.length > 0 ? (
        <div className="mt-6 rounded-xl border border-gold/30 bg-gold/5 p-5">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gold" aria-hidden />
            <h2 className="font-display text-base font-semibold text-foreground">Employer workspace</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            You hold a role in a verified employer organization — manage listings, applicants and candidate discovery there.
          </p>
          <Button className="mt-3 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'career-employer' })}>
            <Search className="mr-2 h-4 w-4" aria-hidden /> Open employer dashboard
          </Button>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <ShieldQuestion className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="font-display text-base font-semibold text-foreground">Hiring on BEAN?</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Register an EMPLOYER organization from the Institution page. Candidate discovery unlocks only after BEAN
            verifies the organization — and every candidate you can see has explicitly opted in.
          </p>
          <Button variant="outline" className="mt-3 border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'institution' })}>
            <Building2 className="mr-2 h-4 w-4" aria-hidden /> Register an organization
          </Button>
        </div>
      )}
    </div>
  )
}

'use client'

// ─── Phase 7 — Career hub (#/career) ─────────────────────────────────────────
// Entry point for the student career portfolio and the employer exchange.
// Everything on this surface is computed from real server data (careerProfile,
// careerSkills, careerProjects, careerCredentials, myApplications,
// myOrganizations) — the completion checklist is an honest "N of 5" count of
// sections that actually have content, never a fabricated score. Students
// control everything: the profile is private by default, discovery requires an
// explicit DISCOVERABLE choice plus an APPROVED adult-eligibility review (both
// server-enforced in src/lib/career.ts), and employer tools appear only for
// members of approved employer organizations (server authorization remains
// authoritative).

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/lib/store'
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  Circle,
  FileText,
  FolderKanban,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  ShieldQuestion,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type {
  CareerCredentialClientDTO,
  CareerProfileResponse,
  CareerProjectClientDTO,
  CareerSkillClientDTO,
  MyApplicationsResponse,
  MyOrganizationsResponse,
} from '@/lib/types'
import { EmptyState } from '@/components/bean/empty-state'
import { LogIn } from 'lucide-react'

/** Employer roles that surface the workspace card (server still re-checks). */
const EMPLOYER_WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'RECRUITER', 'CAREER_COORDINATOR'] as const

interface CareerHomeData {
  profile: CareerProfileResponse | null
  skills: CareerSkillClientDTO[] | null
  projects: CareerProjectClientDTO[] | null
  credentials: CareerCredentialClientDTO[] | null
  applications: MyApplicationsResponse | null
  orgs: MyOrganizationsResponse | null
}

const EMPTY_HOME: CareerHomeData = {
  profile: null,
  skills: null,
  projects: null,
  credentials: null,
  applications: null,
  orgs: null,
}

export function CareerView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const [data, setData] = useState<CareerHomeData>(EMPTY_HOME)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setFailed(null)
    Promise.allSettled([
      api.careerProfile(),
      api.careerSkills(),
      api.careerProjects(),
      api.careerCredentials(),
      api.myApplications(),
      api.myOrganizations(),
    ])
      .then(([profile, skills, projects, credentials, applications, orgs]) => {
        setData({
          profile: profile.status === 'fulfilled' ? profile.value : null,
          skills: skills.status === 'fulfilled' ? skills.value.skills : null,
          projects: projects.status === 'fulfilled' ? projects.value.projects : null,
          credentials: credentials.status === 'fulfilled' ? credentials.value.credentials : null,
          applications: applications.status === 'fulfilled' ? applications.value : null,
          orgs: orgs.status === 'fulfilled' ? orgs.value : null,
        })
        // The profile is the core record — without it the page cannot be honest.
        if (profile.status === 'rejected') {
          setFailed(profile.reason instanceof Error ? profile.reason.message : 'Could not load your career profile.')
        }
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

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

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading your career data">
          <Loader2 className="h-6 w-6 animate-spin text-gold" />
        </div>
      </div>
    )
  }
  if (failed || !data.profile) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={RefreshCw} title="Could not load your career hub" description={failed ?? 'Something went wrong on our side.'} actionLabel="Try again" onAction={load} />
      </div>
    )
  }

  const { profile, skills, projects, applications, orgs } = data
  const eligibility = profile.eligibility
  const visibility = profile.profile.visibility

  // ── Profile completion checklist: honest field-presence checks only ──────
  const checklist = [
    { key: 'headline', label: 'Headline added', done: !!profile.profile.headline?.trim(), action: 'career-profile' as const, actionLabel: 'Add a headline' },
    { key: 'summary', label: 'Summary written', done: !!profile.profile.summary?.trim(), action: 'career-profile' as const, actionLabel: 'Write a summary' },
    { key: 'skills', label: 'At least one skill listed', done: (skills?.length ?? 0) >= 1, action: 'career-portfolio' as const, actionLabel: 'Add your first skill' },
    { key: 'projects', label: 'At least one project added', done: (projects?.length ?? 0) >= 1, action: 'career-portfolio' as const, actionLabel: 'Add your first project' },
    { key: 'eligibility', label: 'Adult-eligibility review approved', done: eligibility.status === 'APPROVED', action: 'career-profile' as const, actionLabel: eligibility.status === 'NOT_ELIGIBLE' || eligibility.status === 'DENIED' ? 'Request a review' : 'Check review status' },
  ]
  const doneCount = checklist.filter(c => c.done).length
  const missing = checklist.filter(c => !c.done)

  // ── Application activity: real counts by status ───────────────────────────
  const statusCounts = new Map<string, number>()
  for (const a of applications?.applications ?? []) {
    statusCounts.set(a.status, (statusCounts.get(a.status) ?? 0) + 1)
  }

  // ── Employer workspace: approved org + employer-facing role ───────────────
  const employerOrgs = (orgs?.organizations ?? []).filter(
    o =>
      o.organization.orgType === 'EMPLOYER' &&
      o.organization.verificationStatus === 'APPROVED' &&
      o.membership.status === 'ACTIVE' &&
      (EMPLOYER_WORKSPACE_ROLES as readonly string[]).includes(o.membership.role),
  )

  const visibilityMeaning =
    visibility === 'DISCOVERABLE'
      ? 'Verified employers searching candidate discovery may find you — but only while your adult-eligibility review stays APPROVED.'
      : visibility === 'PAUSED'
        ? 'Hidden from discovery right now. Your DISCOVERABLE choice is kept, so resuming later takes one change.'
        : 'Only you can see your profile. It never appears in employer discovery.'

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Career</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Your career, under your control</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Nothing is published automatically. Employer discovery only ever sees what you explicitly share, and only after
        BEAN approves your adult-eligibility review — a safeguarding requirement that keeps school-age learners out of
        employer reach entirely.
      </p>

      {/* ── Profile completion checklist ── */}
      <section aria-labelledby="career-checklist-heading" className="mt-8 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="career-checklist-heading" className="font-display text-base font-semibold text-foreground">
            Profile setup
          </h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {doneCount} of {checklist.length} sections complete
          </p>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
          <div className="h-full bg-gold transition-all" style={{ width: `${(doneCount / checklist.length) * 100}%` }} role="presentation" />
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {checklist.map(c => (
            <li key={c.key} className="flex items-center gap-2 text-sm">
              {c.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className={c.done ? 'text-muted-foreground' : 'text-foreground'}>{c.label}</span>
              {!c.done ? (
                <button
                  type="button"
                  className="ml-auto text-xs font-medium text-gold underline-offset-4 hover:underline"
                  onClick={() => navigate({ view: c.action })}
                >
                  {c.actionLabel} <ArrowRight className="inline h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {missing.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Everything is in place. You can still edit any section at any time — changes never rewrite applications you
            already sent.
          </p>
        ) : null}
      </section>

      {/* ── Quick actions ── */}
      <section aria-labelledby="career-quick-actions-heading" className="mt-6">
        <h2 id="career-quick-actions-heading" className="sr-only">Quick actions</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { key: 'profile', title: 'Edit career profile', icon: FileText, description: 'Headline, summary, preferences, visibility and your public address.', hash: '#/career/profile', view: 'career-profile' as const },
            { key: 'portfolio', title: 'Skills & projects', icon: FolderKanban, description: 'Truthfully-labelled skills, projects and institution credentials you choose to share.', hash: '#/career/portfolio', view: 'career-portfolio' as const },
            { key: 'opportunities', title: 'Browse opportunities', icon: Briefcase, description: 'Moderated listings from BEAN-verified employer organizations.', hash: '#/career/opportunities', view: 'career-opportunities' as const },
            { key: 'applications', title: 'My applications', icon: Inbox, description: 'Track statuses, employer notes to you, filed reports, and withdraw when you choose.', hash: '#/career/applications', view: 'career-applications' as const },
          ].map(t => (
            <button
              key={t.key}
              type="button"
              className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
              onClick={() => navigate({ view: t.view })}
              aria-label={`${t.title} — go to ${t.hash}`}
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

      {/* ── Current visibility ── */}
      <section aria-labelledby="career-visibility-heading" className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="career-visibility-heading" className="font-display text-base font-semibold text-foreground">Current visibility</h2>
          <Badge variant="outline" className={visibility === 'DISCOVERABLE' ? 'border-gold/40 bg-gold/10 text-gold' : 'border-border bg-elevated text-muted-foreground'}>
            {visibility.toLowerCase()}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{visibilityMeaning}</p>
        {visibility !== 'DISCOVERABLE' || eligibility.status !== 'APPROVED' ? (
          <p className="mt-2 rounded-lg border border-gold/30 bg-gold/5 p-3 text-xs text-muted-foreground">
            <ShieldQuestion className="mr-1 inline h-3.5 w-3.5 text-gold" aria-hidden />
            How discovery works: a profile becomes visible to verified employers only when BOTH (1) you set visibility to
            DISCOVERABLE and (2) BEAN has approved your adult-eligibility review. Your profile is currently
            {visibility === 'DISCOVERABLE'
              ? ' discoverable by choice, but the eligibility review is not approved yet — the server keeps discovery off.'
              : visibility === 'PAUSED'
                ? ' paused — employers cannot find it even if both other conditions hold.'
                : ' private — it is never included in employer searches.'}
            {' '}Neither condition is something the website can bypass.
          </p>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="mt-3 border-gold/40 text-gold hover:bg-gold/10"
          onClick={() => navigate({ view: 'career-profile' })}
        >
          <FileText className="mr-2 h-3.5 w-3.5" aria-hidden /> Change visibility in your profile
        </Button>
      </section>

      {/* ── Application activity ── */}
      <section aria-labelledby="career-activity-heading" className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="career-activity-heading" className="font-display text-base font-semibold text-foreground">Application activity</h2>
          {applications ? (
            <span className="text-sm text-muted-foreground">{applications.applications.length} total</span>
          ) : null}
        </div>
        {applications ? (
          applications.applications.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No applications yet — browse opportunities to get started.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {[...statusCounts.entries()].map(([status, count]) => (
                <li key={status}>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-3 py-1 text-xs text-muted-foreground">
                    {status.replace(/_/g, ' ').toLowerCase()}
                    <span className="font-semibold text-foreground">{count}</span>
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Could not load applications right now.{' '}
            <button type="button" className="text-gold underline-offset-4 hover:underline" onClick={load}>Retry</button>
          </p>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="mt-3 text-muted-foreground hover:text-foreground"
          onClick={() => navigate({ view: 'career-applications' })}
        >
          Open application tracker <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
        </Button>
      </section>

      {/* ── Employer workspace (only for verified employer org members) ── */}
      {employerOrgs.length > 0 ? (
        <div className="mt-6 rounded-xl border border-gold/30 bg-gold/5 p-5">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gold" aria-hidden />
            <h2 className="font-display text-base font-semibold text-foreground">Employer workspace</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            You hold a {employerOrgs[0].membership.role.toLowerCase().replace(/_/g, ' ')} role in{' '}
            {employerOrgs[0].organization.displayName || employerOrgs[0].organization.name} — manage listings,
            applicants and candidate discovery there.
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

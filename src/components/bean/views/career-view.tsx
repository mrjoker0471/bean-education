'use client'

// ─── Phase 7 — Career hub (#/career) ─────────────────────────────────────────
// Entry point for the student career portfolio and the employer exchange.
// Students control everything: the profile is private by default, discovery
// requires an explicit choice plus an approved adult-eligibility review, and
// employer tools appear only for members of approved employer organizations
// (server authorization remains authoritative).

import { Button } from '@/components/ui/button'
import { useAppStore } from '@/lib/store'
import { Briefcase, FileText, FolderKanban, Building2, Inbox, Search, ShieldQuestion, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { MyOrganizationsResponse } from '@/lib/types'
import { EmptyState } from '@/components/bean/empty-state'
import { LogIn } from 'lucide-react'

export function CareerView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const [orgs, setOrgs] = useState<MyOrganizationsResponse | null>(null)

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(() => {
      api.myOrganizations().then(setOrgs).catch(() => setOrgs({ organizations: [] }))
    }, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent])

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

  const tiles = [
    { key: 'profile', title: 'Career profile', icon: FileText, description: 'Headline, summary and preferences — private until you decide otherwise.', hash: '#/career/profile' },
    { key: 'portfolio', title: 'Skills & projects', icon: FolderKanban, description: 'Truthfully-labelled skills, projects and institution credentials you choose to share.', hash: '#/career/portfolio' },
    { key: 'opportunities', title: 'Jobs & internships', icon: Briefcase, description: 'Moderated listings from BEAN-verified employer organizations.', hash: '#/career/opportunities' },
    { key: 'applications', title: 'My applications', icon: Inbox, description: 'Track statuses, notes from employers, and withdraw when you choose.', hash: '#/career/applications' },
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

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {tiles.map(t => (
          <button
            key={t.key}
            type="button"
            className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
            onClick={() => navigate({ view: t.key === 'profile' ? 'career-profile' : t.key === 'portfolio' ? 'career-portfolio' : t.key === 'opportunities' ? 'career-opportunities' : 'career-applications' })}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-gold/30 bg-gold/10" aria-hidden>
              <t.icon className="h-5 w-5 text-gold" />
            </span>
            <h2 className="mt-3 font-display text-base font-semibold text-foreground">{t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
          </button>
        ))}
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

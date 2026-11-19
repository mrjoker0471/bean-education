'use client'

// ─── Phase 7 — Institution workspace (#/institution/:orgId[/section]) ────────
// The organization-aware workspace: Overview, Members, Invitations, Groups,
// Classes, Assignments and Resources. Every section renders data fetched from
// authorized organization-scoped endpoints; the server re-checks membership
// and role on every request (the UI never decides authorization).
//
// Integrity notes:
//   • Verification copy is truthful ("Identity reviewed by BEAN" — never
//     government recognition or accreditation).
//   • Invitation raw tokens are shown exactly once via the copy dialog and
//     never persisted in app state.
//   • Assignment grades/feedback come only from authorized endpoints; students
//     never see other students' submissions here.
//   • Analytics derive from institution-owned activity only.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { TeacherLiveClassButton } from '@/components/bean/classroom/classroom-entry'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { evaluateOrgCapabilities, type OrgCapabilities, type OrgMembershipStatus, type OrgRole, type OrgVerificationStatus } from '@/lib/capabilities'
import {
  activeBookings,
  attendanceMarkedCount,
  buildInviteLink,
  classDisplayStatus,
  classStatusBadgeClass,
  deriveInvitationStatus,
  humanizeAuditAction,
  institutionClassAudienceError,
  invitationStatusBadgeClass,
  isFutureLocalSchedule,
  upcomingOrgClasses,
} from '@/lib/institution-ui'
import {
  bookingStatusBadgeClass,
  classEndTime,
  COMMON_TIMEZONES,
  formatClassLocal,
  formatDay,
  formatDuration,
  guessTimeZone,
  TEACH_LEVEL_OPTIONS,
} from '@/components/bean/teach-format'
import type {
  AnnouncementDTO,
  AssignmentDTO,
  AssignmentDetailResponse,
  GroupDTO,
  InvitationDTO,
  MemberDTO,
  MyClassDTO,
  OrgClassRowDTO,
  OrgClassesResponse,
  OrgDashboardResponse,
  OrgInvitationsResponse,
  OrgMembersResponse,
  OrgResourcesResponse,
  PublicClassDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  BookMarked,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Copy,
  GraduationCap,
  Loader2,
  Megaphone,
  Plus,
  Rocket,
  Send,
  ShieldAlert,
  Undo2,
  UserPlus,
  Users,
} from 'lucide-react'

type Section = 'overview' | 'members' | 'groups' | 'classes' | 'assignments' | 'resources' | 'reports'

const SECTION_TABS: { key: Section; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'members', label: 'Members' },
  { key: 'groups', label: 'Groups & batches' },
  { key: 'classes', label: 'Classes' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'resources', label: 'Resources' },
  { key: 'reports', label: 'Reports' },
]

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'INSTRUCTOR', label: 'Instructor' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'LEARNER', label: 'Learner' },
  { value: 'CAREER_COORDINATOR', label: 'Career coordinator' },
  { value: 'RECRUITER', label: 'Recruiter (employer orgs)' },
]

export function InstitutionOrgView({ orgId, section }: { orgId: string; section?: Section }) {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [dash, setDash] = useState<OrgDashboardResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [tab, setTab] = useState<Section>(section ?? 'overview')
  // Signed-in user's BEAN Teach status (real source: GET /api/teach/application,
  // the same API the teacher dashboard gates on). ClassesPanel needs it because
  // the server requires an APPROVED TeacherProfile for scheduling classes.
  const [teacherStatus, setTeacherStatus] = useState<'loading' | 'approved' | 'notApproved'>('loading')
  // Overview "Invite member" quick action opens the invitations panel in the
  // Members section (cross-section handshake, consumed on mount there).
  const [inviteAutoOpen, setInviteAutoOpen] = useState(false)

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    let cancelled = false
    api.teachApplication()
      .then(res => { if (!cancelled) setTeacherStatus(res.application?.status === 'APPROVED' ? 'approved' : 'notApproved') })
      .catch(() => { if (!cancelled) setTeacherStatus('notApproved') })
    return () => { cancelled = true }
  }, [authChecked, authedStudent])

  // Overview "Invite member" quick action: navigates to the Members section and
  // asks the invitations panel there to open its create dialog (consumed on mount).
  const openInvitations = useCallback(() => {
    setInviteAutoOpen(true)
    navigate({ view: 'institution-org', orgId, section: 'members' })
  }, [navigate, orgId])

  useEffect(() => {
    if (!section) return
    const t = setTimeout(() => setTab(section), 0)
    return () => clearTimeout(t)
  }, [section])

  const load = useCallback(() => {
    setDash(null)
    api.organizationDashboard(orgId)
      .then(res => { setDash(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load this workspace.'))
  }, [orgId])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

  if (!authChecked) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading workspace">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={ShieldAlert} title="Sign in required" description="This workspace is for organization members." actionLabel="Sign in" onAction={() => navigate({ view: 'auth' })} />
      </div>
    )
  }
  if (failed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={ShieldAlert} title="Could not open this workspace" description={failed} actionLabel="Back to institutions" onAction={() => navigate({ view: 'institution' })} />
      </div>
    )
  }
  if (!dash) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading workspace">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  const org = dash.organization
  const isAdmin = dash.isAdmin
  // Central capability evaluator (client mirror of the server guards): the UI
  // never gates on ad-hoc role strings — every affordance keys off these flags.
  const caps = evaluateOrgCapabilities({
    role: dash.role as OrgRole,
    membershipStatus: dash.membership.status as OrgMembershipStatus,
    verificationStatus: dash.organization.verificationStatus as OrgVerificationStatus,
    organizationActive: dash.organization.isActive,
  })

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Button variant="ghost" className="-ml-2 mb-3 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'institution' })}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> All organizations
      </Button>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Institution</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-xl" aria-hidden>
            {org.logoText || '🏛'}
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">{org.displayName || org.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={verificationBadge(dash.verification.status)}>
                {dash.verification.status === 'APPROVED' && <BadgeCheck className="mr-1 h-3 w-3" aria-hidden />}
                {verificationCopy(dash.verification.status)}
              </Badge>
              <Badge variant="outline" className="border-border text-muted-foreground">You: {dash.membership.role.toLowerCase()}</Badge>
            </div>
          </div>
        </div>
        {dash.verification.status === 'DRAFT' || dash.verification.status === 'REJECTED' ? (
          isAdmin ? <SubmitForReviewButton orgId={org.id} onDone={load} /> : null
        ) : null}
      </div>
      {dash.verification.status === 'REJECTED' && isAdmin ? (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-destructive">Verification declined.</p>
          <p className="mt-1">BEAN administrators recorded a reason for this decision. Update the organization profile and resubmit; the decision history stays auditable.</p>
        </div>
      ) : null}

      {!dash.verification.operational ? (
        <div className="mt-6 rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-gold">Workspace is gated until BEAN verifies this organization.</p>
          <p className="mt-1">
            Members and profile details are available now. Groups, private classes, assignments, resources and
            invitations unlock after an administrator approves the application (a human review — &ldquo;verified&rdquo;
            means identity reviewed by BEAN, not government accreditation).
          </p>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={v => navigate({ view: 'institution-org', orgId: org.id, section: v as Section })} className="mt-8">
        <TabsList className="bg-elevated">
          {SECTION_TABS.map(t => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-6">
        {tab === 'overview' && (
          <OverviewPanel
            dash={dash}
            caps={caps}
            approvedTeacher={teacherStatus === 'approved'}
            onInviteMember={openInvitations}
          />
        )}
        {tab === 'members' && (
          <MembersPanel
            orgId={org.id}
            isAdmin={isAdmin}
            active={dash.verification.operational}
            canInviteMembers={caps.canInviteMembers}
            autoOpenInvitations={inviteAutoOpen}
            onInvitationsAutoOpenConsumed={() => setInviteAutoOpen(false)}
            onChanged={load}
          />
        )}
        {tab === 'groups' && <GroupsPanel orgId={org.id} caps={caps} />}
        {tab === 'classes' && <ClassesPanel orgId={org.id} caps={caps} teacherStatus={teacherStatus} />}
        {tab === 'assignments' && <AssignmentsPanel orgId={org.id} isAdmin={isAdmin} active={dash.verification.operational} groupsReady={dash.verification.operational} />}
        {tab === 'resources' && <ResourcesPanel orgId={org.id} isAdmin={isAdmin} active={dash.verification.operational} />}
        {tab === 'reports' && <ReportsPanel dash={dash} />}
      </div>
    </div>
  )
}

function verificationBadge(status: string): string {
  switch (status) {
    case 'APPROVED': return 'border-success/40 bg-success/10 text-success'
    case 'PENDING_REVIEW': return 'border-gold/40 bg-gold/10 text-gold'
    case 'REJECTED':
    case 'SUSPENDED': return 'border-destructive/40 bg-destructive/10 text-destructive'
    default: return 'border-border bg-elevated text-muted-foreground'
  }
}

function verificationCopy(status: string): string {
  switch (status) {
    case 'APPROVED': return 'Identity reviewed by BEAN'
    case 'PENDING_REVIEW': return 'Verification pending'
    case 'REJECTED': return 'Verification declined'
    case 'SUSPENDED': return 'Suspended'
    default: return 'Not verified yet'
  }
}

function SubmitForReviewButton({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api.submitOrganization(orgId)
      toast({ title: 'Submitted for review — BEAN administrators will verify the identity.' })
      onDone()
    } catch (e) {
      toast({ title: 'Could not submit', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button className="bg-gold text-primary-foreground hover:bg-gold-hover sm:self-end" disabled={busy} onClick={submit}>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <BadgeCheck className="mr-2 h-4 w-4" aria-hidden />}
      Submit for verification
    </Button>
  )
}

// ─── Overview: operational dashboard ─────────────────────────────────────────
// Every number comes from the dashboard response (server-computed). The
// "upcoming classes" list filters real rows from the org classes endpoint —
// no statistics are invented client-side.

function OverviewPanel({ dash, caps, approvedTeacher, onInviteMember }: {
  dash: OrgDashboardResponse
  caps: OrgCapabilities
  approvedTeacher: boolean
  onInviteMember: () => void
}) {
  const navigate = useAppStore(s => s.navigate)
  const orgId = dash.organization.id
  const o = dash.overview
  const [classes, setClasses] = useState<OrgClassRowDTO[] | null>(null)
  const [classesFailed, setClassesFailed] = useState<string | null>(null)

  const loadClasses = useCallback(() => {
    setClasses(null)
    api.organizationClasses(orgId)
      .then(res => { setClasses(res.classes); setClassesFailed(null) })
      .catch(e => setClassesFailed(e instanceof Error ? e.message : 'Could not load upcoming classes.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(loadClasses, 0)
    return () => clearTimeout(t)
  }, [loadClasses])

  const nextClasses = upcomingOrgClasses(classes ?? [])
  const stats = [
    { label: 'Members', value: o.activeMembers, note: `${o.pendingMembers} pending approval` },
    { label: 'Active groups', value: o.activeGroups, note: o.archivedGroups > 0 ? `${o.archivedGroups} archived` : undefined },
    { label: 'Upcoming classes', value: o.upcomingClasses },
    { label: 'Published assignments', value: o.publishedAssignments, note: `${o.draftAssignments} draft · ${o.closedAssignments} closed` },
    { label: 'Active resources', value: o.resourcesTotal },
    { label: 'Active announcements', value: o.announcementsActive },
  ]

  const focusAnnouncementComposer = () => {
    document.getElementById('announcement-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => document.getElementById('announcement-title-input')?.focus(), 400)
  }

  // Quick actions, filtered by the capability evaluator (and the approved
  // teacher status for scheduling — the server enforces the same rules).
  const quickActions: { label: string; icon: typeof Plus; onClick: () => void }[] = []
  if (caps.canCreateGroups) quickActions.push({ label: 'New group', icon: Users, onClick: () => navigate({ view: 'institution-org', orgId, section: 'groups' }) })
  if (caps.canInviteMembers) quickActions.push({ label: 'Invite member', icon: UserPlus, onClick: onInviteMember })
  if (caps.canManageClasses && approvedTeacher) quickActions.push({ label: 'Schedule class', icon: GraduationCap, onClick: () => navigate({ view: 'institution-org', orgId, section: 'classes' }) })
  if (caps.canCreateAssignments) quickActions.push({ label: 'New assignment', icon: ClipboardList, onClick: () => navigate({ view: 'institution-org', orgId, section: 'assignments' }) })
  if (caps.canShareResources) quickActions.push({ label: 'Share resource', icon: BookMarked, onClick: () => navigate({ view: 'institution-org', orgId, section: 'resources' }) })
  if (caps.canPublishAnnouncements) quickActions.push({ label: 'Post announcement', icon: Megaphone, onClick: focusAnnouncementComposer })

  return (
    <div className="space-y-6">
      {o.submissionsAwaitingGrading > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-gold/40 bg-gold/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-base font-semibold text-gold">
              {o.submissionsAwaitingGrading} submission{o.submissionsAwaitingGrading === 1 ? '' : 's'} awaiting grading
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Students are waiting for grades and feedback on published assignments.</p>
          </div>
          <Button size="sm" className="shrink-0 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'institution-org', orgId, section: 'assignments' })}>
            Open assignments
          </Button>
        </div>
      ) : null}

      {quickActions.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick actions">
          {quickActions.map(a => (
            <Button key={a.label} size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={a.onClick}>
              <a.icon className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {a.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 font-display text-2xl font-semibold text-gold">{s.value}</p>
            {s.note ? <p className="mt-1 text-[11px] text-muted-foreground">{s.note}</p> : null}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-display text-base font-semibold text-foreground">Upcoming classes</h3>
        {classesFailed ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-destructive">{classesFailed}</p>
            <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={loadClasses}>Try again</Button>
          </div>
        ) : !classes ? (
          <div className="flex min-h-[8vh] items-center justify-center" role="status" aria-label="Loading upcoming classes"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : nextClasses.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No upcoming classes scheduled.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {nextClasses.map(c => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2">
                <span className="text-sm text-foreground">{c.title}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5 text-gold" aria-hidden />
                  {formatClassLocal(c.startsAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-display text-base font-semibold text-foreground">Recent administrative activity</h3>
        <p className="mt-1 text-xs text-muted-foreground">Recorded organization events — audit history, display names only.</p>
        {o.recentActivity.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No recorded activity yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {o.recentActivity.map(item => (
              <li key={item.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-foreground">{humanizeAuditAction(item.action)}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.actorDisplayName || (item.actorRole ? item.actorRole.toLowerCase().replace('_', ' ') : 'System')} · {formatDay(item.createdAt)}
                  </p>
                </div>
                {item.summary ? <p className="max-w-full truncate text-xs text-muted-foreground sm:max-w-[45%]">{item.summary}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div id="announcement-composer">
        <AnnouncementsCard orgId={orgId} isAdmin={dash.isAdmin} active={dash.verification.operational} />
      </div>
    </div>
  )
}

// ─── Members ─────────────────────────────────────────────────────────────────

function MembersPanel({ orgId, isAdmin, active, canInviteMembers, autoOpenInvitations, onInvitationsAutoOpenConsumed, onChanged }: {
  orgId: string
  isAdmin: boolean
  active: boolean
  canInviteMembers: boolean
  autoOpenInvitations?: boolean
  onInvitationsAutoOpenConsumed?: () => void
  onChanged: () => void
}) {
  const [data, setData] = useState<OrgMembersResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ member: MemberDTO; action: 'SUSPEND' | 'REMOVE' | 'REINSTATE' | 'APPROVE_OWNER' } | null>(null)
  const [roleDialog, setRoleDialog] = useState<MemberDTO | null>(null)
  const [newRole, setNewRole] = useState<string>('')

  const load = useCallback(() => {
    setData(null)
    api.organizationMembers(orgId)
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load members.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const runAction = async (member: MemberDTO, action: 'SUSPEND' | 'REMOVE' | 'REINSTATE' | 'APPROVE_OWNER' | 'SET_ROLE', role?: string) => {
    setBusyId(member.id)
    try {
      await api.organizationMemberAction(orgId, member.id, { action, role })
      toast({ title: actionLabel(action) })
      setConfirm(null)
      load()
      onChanged()
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const memberStatusBadge = (status: string) =>
    status === 'ACTIVE'
      ? 'border-success/40 bg-success/10 text-success'
      : status === 'INVITED'
        ? 'border-gold/40 bg-gold/10 text-gold'
        : status === 'SUSPENDED'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-elevated text-muted-foreground'

  return (
    <div>
      {failed ? (
        <EmptyState icon={Users} title="Could not load members" description={failed} actionLabel="Try again" onAction={load} />
      ) : !data ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading members"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <Badge variant="outline" className="border-border text-muted-foreground">{data.counts.total} total</Badge>
            <Badge variant="outline" className="border-success/40 text-success">{data.counts.active} active</Badge>
            <Badge variant="outline" className="border-gold/40 text-gold">{data.counts.pending} pending</Badge>
            <Badge variant="outline" className="border-destructive/40 text-destructive">{data.counts.suspended} suspended</Badge>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {data.members.map(m => (
                <li key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-elevated text-sm text-muted-foreground" aria-hidden>
                      {(m.student.displayName || 'M').slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{m.student.displayName || 'Member'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="border-gold/40 text-gold">{m.role.toLowerCase()}</Badge>
                        <Badge variant="outline" className={memberStatusBadge(m.status)}>{m.status.toLowerCase()}</Badge>
                      </div>
                    </div>
                  </div>
                  {isAdmin ? (
                    <div className="flex flex-wrap gap-2">
                      {m.status === 'INVITED' && (
                        <Button size="sm" variant="outline" className="border-success/40 text-success hover:bg-success/10" disabled={busyId === m.id} onClick={() => setConfirm({ member: m, action: 'APPROVE_OWNER' })}>
                          Approve
                        </Button>
                      )}
                      {m.status === 'ACTIVE' && (
                        <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" disabled={busyId === m.id} onClick={() => { setRoleDialog(m); setNewRole(m.role === 'OWNER' ? m.role : ROLE_OPTIONS[0].value) }}>
                          Change role
                        </Button>
                      )}
                      {m.status === 'ACTIVE' && m.role !== 'OWNER' && (
                        <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" disabled={busyId === m.id} onClick={() => setConfirm({ member: m, action: 'SUSPEND' })}>
                          Suspend
                        </Button>
                      )}
                      {m.status === 'SUSPENDED' && (
                        <Button size="sm" variant="outline" className="border-success/40 text-success hover:bg-success/10" disabled={busyId === m.id} onClick={() => setConfirm({ member: m, action: 'REINSTATE' })}>
                          Reinstate
                        </Button>
                      )}
                      {m.role !== 'OWNER' && (
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={busyId === m.id} onClick={() => setConfirm({ member: m, action: 'REMOVE' })}>
                          Remove
                        </Button>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            Roster privacy: only display names are shown — never emails or private account details. Historical records
            survive removal; nothing is deleted.
          </p>
          {canInviteMembers ? (
            <InvitationsPanel orgId={orgId} autoOpen={autoOpenInvitations} onAutoOpenConsumed={onInvitationsAutoOpenConsumed} />
          ) : null}
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={o => !o && setConfirm(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">{confirm ? actionTitle(confirm.action, confirm.member) : ''}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {confirm?.action === 'REMOVE'
                ? 'Their historical bookings, submissions and attendance records are preserved. They lose access to new institution content immediately.'
                : confirm?.action === 'SUSPEND'
                  ? 'Suspended members cannot access new private classes or workspace functions until reinstated.'
                  : 'This is a recorded administrative action and appears in the organization audit history.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={confirm?.action === 'SUSPEND' || confirm?.action === 'REMOVE' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
              onClick={e => { e.preventDefault(); if (confirm) void runAction(confirm.member, confirm.action) }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!roleDialog} onOpenChange={o => !o && setRoleDialog(null)}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Change role</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Organization roles are scoped to this organization — they never change anyone&apos;s BEAN account role.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="member-role">Role</Label>
            <Select value={newRole} onValueChange={setNewRole}>
              <SelectTrigger id="member-role" aria-label="Member role"><SelectValue /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {ROLE_OPTIONS.map(r => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setRoleDialog(null)}>Cancel</Button>
            <Button
              className="bg-gold text-primary-foreground hover:bg-gold-hover"
              disabled={busyId === roleDialog?.id}
              onClick={async () => {
                if (!roleDialog) return
                await runAction(roleDialog, 'SET_ROLE', newRole)
                setRoleDialog(null)
              }}
            >
              Save role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function actionTitle(action: string, member: MemberDTO): string {
  const name = member.student.displayName || 'this member'
  switch (action) {
    case 'SUSPEND': return `Suspend ${name}?`
    case 'REMOVE': return `Remove ${name} from the organization?`
    case 'REINSTATE': return `Reinstate ${name}?`
    case 'APPROVE_OWNER': return `Approve ${name}'s membership?`
    default: return 'Confirm action'
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case 'SUSPEND': return 'Member suspended'
    case 'REMOVE': return 'Member removed'
    case 'REINSTATE': return 'Member reinstated'
    case 'APPROVE_OWNER': return 'Membership approved'
    case 'SET_ROLE': return 'Role updated'
    default: return 'Done'
  }
}

// ─── Invitations (visible to canInviteMembers — server guard: org admin) ─────
// Lists and creates invitations. Raw tokens are returned exactly once by the
// server and shown exactly once here; they are never persisted in app state.
// There is no revoke endpoint yet, so no revoke control is rendered.

function InvitationsPanel({ orgId, autoOpen, onAutoOpenConsumed }: {
  orgId: string
  autoOpen?: boolean
  onAutoOpenConsumed?: () => void
}) {
  const [data, setData] = useState<OrgInvitationsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(() => {
    setData(null)
    api.organizationInvitations(orgId)
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load invitations.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  // Overview "Invite member" quick action: open the create dialog once when
  // this panel mounts with the handshake flag set, then consume it.
  useEffect(() => {
    if (!autoOpen) return
    const t = setTimeout(() => {
      setCreateOpen(true)
      onAutoOpenConsumed?.()
    }, 0)
    return () => clearTimeout(t)
  }, [autoOpen, onAutoOpenConsumed])

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-foreground">Invitations</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Personal, expiring join codes — there is no public joining. Recipients redeem them from the Institutions page.
          </p>
        </div>
        <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreateOpen(true)}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Invite member
        </Button>
      </div>
      {failed ? (
        <EmptyState icon={UserPlus} title="Could not load invitations" description={failed} actionLabel="Try again" onAction={load} />
      ) : !data ? (
        <div className="flex min-h-[15vh] items-center justify-center" role="status" aria-label="Loading invitations"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : data.invitations.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No invitations yet — create one to bring a colleague in.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
          {data.invitations.map(inv => {
            const status = deriveInvitationStatus(inv)
            return (
              <li key={inv.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="border-gold/40 text-gold">{roleLabel(inv.intendedRole)}</Badge>
                    <Badge variant="outline" className={invitationStatusBadgeClass(status)}>{status.toLowerCase()}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {inv.email ? `For ${inv.email}` : 'Open to any signed-in member'}
                    {' · '}created {formatDay(inv.createdAt)}
                    {' · '}expires {formatDay(inv.expiresAt)}
                    {inv.maxUses !== null ? ` · ${inv.useCount}/${inv.maxUses} used` : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <CreateInvitationDialog open={createOpen} onOpenChange={setCreateOpen} orgId={orgId} onCreated={load} />
    </div>
  )
}

function roleLabel(role: string): string {
  return ROLE_OPTIONS.find(r => r.value === role)?.label ?? role
}

function CreateInvitationDialog({ open, onOpenChange, orgId, onCreated }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  onCreated: () => void
}) {
  const [intendedRole, setIntendedRole] = useState<string>('LEARNER')
  const [email, setEmail] = useState('')
  const [ttlDays, setTtlDays] = useState('14')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The created invitation — rawToken present exactly once (POST response).
  const [created, setCreated] = useState<InvitationDTO | null>(null)
  const [copied, setCopied] = useState(false)

  const close = () => {
    setCreated(null)
    setCopied(false)
    setError(null)
    onOpenChange(false)
  }

  const submit = async () => {
    setError(null)
    const trimmedEmail = email.trim()
    if (trimmedEmail && !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError('Enter a valid email address, or leave the field empty.')
      return
    }
    setBusy(true)
    try {
      const res = await api.createInvitation(orgId, {
        intendedRole,
        email: trimmedEmail || undefined,
        ttlDays: Number(ttlDays),
      })
      setCreated(res.invitation)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!created?.rawToken) return
    try {
      await navigator.clipboard.writeText(buildInviteLink(created.rawToken))
      setCopied(true)
    } catch {
      setError('Clipboard unavailable — select the link and copy it manually.')
    }
  }

  const inviteLink = created?.rawToken ? buildInviteLink(created.rawToken) : ''

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy && !created) onOpenChange(o) }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
        {created && created.rawToken ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-foreground">Invitation created</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Share this link with {created.email ? created.email : 'the person you are inviting'} — it is shown
                only once and cannot be retrieved again.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={inviteLink}
                  aria-label="Invitation link"
                  className="font-mono text-xs"
                  onFocus={e => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-elevated"
                  onClick={copyLink}
                  aria-label="Copy invitation link"
                >
                  <Copy className="h-4 w-4" aria-hidden /> {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Recipients paste it into &ldquo;Join with an invitation&rdquo; on the Institutions page (or share just the
                raw code after <span className="font-mono">?token=</span>).
                {created.expiresAt ? ` It expires ${formatDay(created.expiresAt)}.` : ''}
              </p>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            </div>
            <DialogFooter>
              <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-foreground">Invite a member</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Invitations never grant owner or administrator roles. Elevated roles stay pending until an administrator
                approves them.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="invite-role">Role for the new member</Label>
                <Select value={intendedRole} onValueChange={setIntendedRole}>
                  <SelectTrigger id="invite-role" aria-label="Intended role"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {ROLE_OPTIONS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-email">Email restriction (optional)</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Only this address can redeem the invitation"
                  maxLength={200}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-ttl">Expires after</Label>
                <Select value={ttlDays} onValueChange={setTtlDays}>
                  <SelectTrigger id="invite-ttl" aria-label="Expiry"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {[1, 3, 7, 14].map(d => (
                      <SelectItem key={d} value={String(d)}>{d} {d === 1 ? 'day' : 'days'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Create invitation
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Groups & batches ────────────────────────────────────────────────────────

function GroupsPanel({ orgId, caps }: { orgId: string; caps: OrgCapabilities }) {
  const navigate = useAppStore(s => s.navigate)
  const [groups, setGroups] = useState<GroupDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [enrollGroup, setEnrollGroup] = useState<GroupDTO | null>(null)

  const load = useCallback(() => {
    setGroups(null)
    api.organizationGroups(orgId)
      .then(res => { setGroups(res.groups); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load groups.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Batches, sections and cohorts — open a group to see its roster, classes and assignments.</p>
        {caps.canCreateGroups ? (
          <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreateOpen(true)}>
            New group
          </Button>
        ) : null}
      </div>
      {failed ? (
        <EmptyState icon={Users} title="Could not load groups" description={failed} actionLabel="Try again" onAction={load} />
      ) : !groups ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading groups"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : groups.length === 0 ? (
        <EmptyState icon={Users} title="No groups yet" description="Create your first batch or cohort to organize learners." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(g => (
            <div key={g.id} className="flex h-full flex-col gap-3">
              {/* Whole card opens the group workspace (keyboard reachable — a real button). */}
              <button
                type="button"
                className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
                onClick={() => navigate({ view: 'institution-group', orgId, groupId: g.id })}
                aria-label={`Open group ${g.name}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-foreground">{g.name}</h3>
                  <Badge
                    variant="outline"
                    className={g.status === 'ARCHIVED' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-success/40 bg-success/10 text-success'}
                  >
                    {g.status === 'ARCHIVED' ? 'Archived' : 'Active'}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                  {g.programmeLabel ? <span><span className="text-gold">Programme:</span> {g.programmeLabel}</span> : null}
                  {g.academicYear ? <span><span className="text-gold">Year:</span> {g.academicYear}</span> : null}
                  {g.batchLabel ? <span><span className="text-gold">Batch:</span> {g.batchLabel}</span> : null}
                  {g.sectionLabel ? <span><span className="text-gold">Section:</span> {g.sectionLabel}</span> : null}
                  {g.trackLabel ? <span><span className="text-gold">Track:</span> {g.trackLabel}</span> : null}
                  <span><span className="text-gold">Enrolled:</span> {g.capacity === null ? `${g.activeEnrollmentCount} · unlimited` : `${g.activeEnrollmentCount} / ${g.capacity}`}</span>
                </div>
              </button>
              {caps.canEnrollGroupMembers && g.status === 'ACTIVE' ? (
                <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setEnrollGroup(g)}>
                  <UserPlus className="mr-2 h-3.5 w-3.5" aria-hidden /> Enroll member
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} orgId={orgId} onCreated={() => { setCreateOpen(false); load() }} />
      <EnrollMemberDialog group={enrollGroup} orgId={orgId} onOpenChange={o => !o && setEnrollGroup(null)} />
    </div>
  )
}

function CreateGroupDialog({ open, onOpenChange, orgId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [programmeLabel, setProgrammeLabel] = useState('')
  const [academicYear, setAcademicYear] = useState('')
  const [batchLabel, setBatchLabel] = useState('')
  const [sectionLabel, setSectionLabel] = useState('')
  const [trackLabel, setTrackLabel] = useState('')
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (name.trim().length < 2) { setError('Give the group a name.'); return }
    setBusy(true)
    try {
      await api.createOrganizationGroup(orgId, {
        name: name.trim(),
        programmeLabel: programmeLabel.trim() || undefined,
        academicYear: academicYear.trim() || undefined,
        batchLabel: batchLabel.trim() || undefined,
        sectionLabel: sectionLabel.trim() || undefined,
        trackLabel: trackLabel.trim() || undefined,
        capacity: capacity ? Number(capacity) : undefined,
      })
      toast({ title: 'Group created' })
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Create a group</DialogTitle>
          <DialogDescription className="text-muted-foreground">Batches, sections and cohorts organize learners for classes and assignments.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="group-name">Group name</Label>
            <Input id="group-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="CA Inter — Batch A (2025)" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="group-programme">Programme (optional)</Label>
              <Input id="group-programme" value={programmeLabel} onChange={e => setProgrammeLabel(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-year">Academic year (optional)</Label>
              <Input id="group-year" value={academicYear} onChange={e => setAcademicYear(e.target.value)} maxLength={40} placeholder="2025–26" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-batch">Batch (optional)</Label>
              <Input id="group-batch" value={batchLabel} onChange={e => setBatchLabel(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-section">Section (optional)</Label>
              <Input id="group-section" value={sectionLabel} onChange={e => setSectionLabel(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-track">Subject / track (optional)</Label>
              <Input id="group-track" value={trackLabel} onChange={e => setTrackLabel(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="group-capacity">Capacity (optional)</Label>
              <Input id="group-capacity" type="number" min={1} max={2000} value={capacity} onChange={e => setCapacity(e.target.value)} className="[color-scheme:dark]" />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EnrollMemberDialog({ group, orgId, onOpenChange }: { group: GroupDTO | null; orgId: string; onOpenChange: (o: boolean) => void }) {
  const [members, setMembers] = useState<OrgMembersResponse | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!group) return
    const t = setTimeout(() => {
      setMembers(null)
      api.organizationMembers(orgId)
        .then(setMembers)
        .catch(() => setMembers(null))
    }, 0)
    return () => clearTimeout(t)
  }, [group, orgId])

  const enroll = async (membershipId: string) => {
    if (!group) return
    setBusyId(membershipId)
    try {
      await api.enrollMember(orgId, group.id, membershipId)
      toast({ title: 'Member enrolled' })
      setMembers(m => (m ? { ...m, counts: m.counts } : m))
      api.organizationMembers(orgId).then(setMembers).catch(() => undefined)
    } catch (e) {
      toast({ title: 'Could not enroll', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={!!group} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Enroll into {group?.name}</DialogTitle>
          <DialogDescription className="text-muted-foreground">Only active organization members can be enrolled. Group classes stay restricted to enrolled members.</DialogDescription>
        </DialogHeader>
        {!members ? (
          <div className="flex min-h-[20vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {members.members.filter(m => m.status === 'ACTIVE').map(m => (
              <li key={m.id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm text-foreground">{m.student.displayName || 'Member'}</p>
                  <p className="text-xs text-muted-foreground">{m.role.toLowerCase()}</p>
                </div>
                <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" disabled={busyId === m.id} onClick={() => void enroll(m.id)}>
                  Enroll
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Classes (institution-owned, incl. private) ─────────────────────────────
// Institution classes reuse the BEAN Teach class system — no duplication: the
// schedule dialog posts to /api/teach/classes with an ORGANIZATION/GROUP
// audience (PUBLIC is never offered here), lifecycle actions call the same
// publish/unpublish/cancel routes the teacher dashboard uses, and bookings/
// attendance come from /api/teach/my-classes (owner-only, display names only).
// The server re-checks every rule (approved teacher, instructor membership,
// group ownership) on every request.

function ClassesPanel({ orgId, caps, teacherStatus }: {
  orgId: string
  caps: OrgCapabilities
  teacherStatus: 'loading' | 'approved' | 'notApproved'
}) {
  const navigate = useAppStore(s => s.navigate)
  const [data, setData] = useState<OrgClassesResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [myClasses, setMyClasses] = useState<MyClassDTO[] | null>(null)
  const [myFailed, setMyFailed] = useState<string | null>(null)
  const [groups, setGroups] = useState<GroupDTO[]>([])
  // Drafts created in this panel — real server responses (PublicClassDTO).
  // organizationClasses lists PUBLISHED classes only, so drafts live here until
  // published (and permanently in the teacher's BEAN Teach dashboard).
  const [drafts, setDrafts] = useState<PublicClassDTO[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [cancelling, setCancelling] = useState<MyClassDTO | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null)

  const approved = teacherStatus === 'approved'

  const load = useCallback(() => {
    setData(null)
    api.organizationClasses(orgId)
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load classes.'))
    api.organizationGroups(orgId).then(res => setGroups(res.groups)).catch(() => setGroups([]))
  }, [orgId])

  // Owner-only enrichment (bookings, attendance evidence, capacity). The
  // server only serves this endpoint to APPROVED teachers and only returns
  // their own classes, so it is fetched exactly when that applies.
  const loadMine = useCallback(() => {
    if (!approved) return
    setMyClasses(null)
    api.teachMyClasses()
      .then(res => { setMyClasses(res.classes); setMyFailed(null) })
      .catch(e => setMyFailed(e instanceof Error ? e.message : 'Could not load your class details.'))
  }, [approved])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  useEffect(() => {
    const t = setTimeout(loadMine, 0)
    return () => clearTimeout(t)
  }, [loadMine])

  const runLifecycle = async (id: string, fn: () => Promise<unknown>, success: string) => {
    setBusyId(id)
    setActionError(null)
    try {
      await fn()
      toast({ title: success })
      load()
      loadMine()
    } catch (e) {
      setActionError({ id, message: e instanceof Error ? e.message : 'Please try again.' })
    } finally {
      setBusyId(null)
    }
  }

  const publishDraft = async (cls: PublicClassDTO) => {
    setBusyId(cls.id)
    setActionError(null)
    try {
      await api.teachPublishClass(cls.id)
      toast({ title: 'Class published — members can now book it' })
      setDrafts(ds => ds.filter(d => d.id !== cls.id))
      load()
      loadMine()
    } catch (e) {
      setActionError({ id: cls.id, message: e instanceof Error ? e.message : 'Please try again.' })
    } finally {
      setBusyId(null)
    }
  }

  const myClassById = new Map((myClasses ?? []).map(c => [c.id, c]))
  const groupById = new Map(groups.map(g => [g.id, g]))
  const publishedIds = new Set((data?.classes ?? []).map(c => c.id))
  const visibleDrafts = drafts.filter(d => !publishedIds.has(d.id))
  const canSchedule = caps.canManageClasses && approved

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Institution classes use the same BEAN Teach classrooms and LiveKit rooms as public classes — organization and
            group audiences simply never appear in public discovery, and booking checks membership on the server.
          </p>
          {canSchedule ? (
            <Button size="sm" className="shrink-0 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Schedule class
            </Button>
          ) : null}
        </div>
        {caps.canManageClasses && teacherStatus === 'notApproved' ? (
          <div className="mb-4 rounded-xl border border-gold/30 bg-gold/5 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-gold">Only approved BEAN teachers can schedule classes — apply via BEAN Teach.</p>
            <p className="mt-1">Every class runs through your approved teacher profile; institutional roles never bypass that review.</p>
            <Button size="sm" variant="outline" className="mt-3 border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'teach-apply' })}>
              Apply via BEAN Teach
            </Button>
          </div>
        ) : null}
        {myFailed && canSchedule ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-sm">
            <p className="text-muted-foreground">{myFailed} Seat counts and attendance may be incomplete.</p>
            <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={loadMine}>Try again</Button>
          </div>
        ) : null}
        {failed ? (
          <EmptyState icon={GraduationCap} title="Could not load classes" description={failed} actionLabel="Try again" onAction={load} />
        ) : !data ? (
          <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading classes"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : data.classes.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No institution classes yet"
            description={canSchedule
              ? 'Schedule the first class for your members — it stays private to this institution (or a single group).'
              : 'Approved teachers with an instructor role schedule private classes; published ones appear here.'}
            actionLabel={canSchedule ? undefined : 'Browse classes'}
            onAction={canSchedule ? undefined : () => navigate({ view: 'classes' })}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.classes.map(c => (
              <OrgClassCard
                key={c.id}
                row={c}
                mine={myClassById.get(c.id) ?? null}
                groupName={c.audience === 'GROUP' ? (groupById.get(c.organizationGroupId ?? '')?.name ?? null) : null}
                busy={busyId === c.id}
                actionError={actionError?.id === c.id ? actionError.message : null}
                onOpen={() => navigate({ view: 'class', classId: c.id })}
                onUnpublish={() => { const m = myClassById.get(c.id); if (m) void runLifecycle(m.id, () => api.teachUnpublishClass(m.id), 'Class unpublished — it is hidden from members until published again') }}
                onCancel={() => { const m = myClassById.get(c.id); if (m) setCancelling(m) }}
              />
            ))}
          </div>
        )}
      </div>

      {visibleDrafts.length > 0 ? (
        <section aria-label="Your draft classes">
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Your drafts ({visibleDrafts.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDrafts.map(d => (
              <div key={d.id} className="flex h-full flex-col gap-2">
                <div className="flex h-full flex-col rounded-xl border border-dashed border-gold/40 bg-card p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-foreground">{d.title}</h3>
                    <Badge variant="outline" className={classStatusBadgeClass('DRAFT')}>draft</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{d.subject}</p>
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5 text-gold" aria-hidden />
                    {formatClassLocal(d.startsAt)}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Only you can see this draft until published. Edit it from your BEAN Teach dashboard.
                  </p>
                </div>
                <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busyId === d.id} onClick={() => void publishDraft(d)}>
                  {busyId === d.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Rocket className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
                  Publish
                </Button>
                {actionError?.id === d.id && <p className="text-xs text-destructive" role="alert">{actionError.message}</p>}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <ScheduleClassDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        orgId={orgId}
        onCreated={cls => {
          setDrafts(ds => [cls, ...ds])
          setCreateOpen(false)
          load()
        }}
      />

      <AlertDialog open={!!cancelling} onOpenChange={o => !o && setCancelling(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Cancel this class?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {cancelling && `\u201C${cancelling.title}\u201D will be removed from members' views and every reserved student will see the cancellation in their bookings. This is audited.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-transparent text-muted-foreground hover:bg-elevated">Keep class</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={e => {
                e.preventDefault()
                if (!cancelling) return
                const target = cancelling
                setCancelling(null)
                void runLifecycle(target.id, () => api.teachCancelClass(target.id), 'Class cancelled — reserved students were informed')
              }}
            >
              {busyId === cancelling?.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Cancel class
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function audienceBadgeClass(audience: string): string {
  return audience === 'PUBLIC' ? 'border-border text-muted-foreground' : 'border-gold/40 text-gold'
}

function audienceBadgeLabel(audience: string): string {
  return audience === 'PUBLIC' ? 'public' : audience === 'ORGANIZATION' ? 'org only' : 'group only'
}

function OrgClassCard({ row, mine, groupName, busy, actionError, onOpen, onUnpublish, onCancel }: {
  row: OrgClassRowDTO
  mine: MyClassDTO | null
  groupName: string | null
  busy: boolean
  actionError: string | null
  onOpen: () => void
  onUnpublish: () => void
  onCancel: () => void
}) {
  const display = classDisplayStatus(row.status, row.startsAt, row.durationMinutes)
  const active = mine ? activeBookings(mine.bookings) : []
  return (
    <div className="flex h-full flex-col gap-2">
      <button
        type="button"
        className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
        onClick={onOpen}
        aria-label={`Open class ${row.title}`}
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-base font-semibold text-foreground">{row.title}</h3>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant="outline" className={audienceBadgeClass(row.audience)}>{audienceBadgeLabel(row.audience)}</Badge>
            <Badge variant="outline" className={classStatusBadgeClass(display)}>{display.toLowerCase()}</Badge>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {row.subject} · {row.teacherName}
          {groupName ? ` · ${groupName}` : ''}
        </p>
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 text-gold" aria-hidden />
          {formatClassLocal(row.startsAt)} · {formatDuration(row.durationMinutes)}
        </div>
        {mine ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {active.length} / {mine.capacity} seats booked
          </p>
        ) : null}
      </button>
      {mine ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {display === 'PUBLISHED' ? <TeacherLiveClassButton classId={row.id} /> : null}
            {display === 'PUBLISHED' ? (
              <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onUnpublish}>
                <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Unpublish
              </Button>
            ) : null}
            {display === 'PUBLISHED' ? (
              <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" disabled={busy} onClick={onCancel}>
                <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Cancel class
              </Button>
            ) : null}
          </div>
          <OwnedBookingsStrip cls={mine} />
          {actionError && <p className="text-xs text-destructive" role="alert">{actionError}</p>}
        </>
      ) : null}
    </div>
  )
}

function OwnedBookingsStrip({ cls }: { cls: MyClassDTO }) {
  const navigate = useAppStore(s => s.navigate)
  const [open, setOpen] = useState(false)
  const active = activeBookings(cls.bookings)
  const marked = attendanceMarkedCount(cls.bookings)
  const ended = classEndTime(cls.startsAt, cls.durationMinutes).getTime() <= Date.now()
  if (active.length === 0) {
    return <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted-foreground">No students booked yet.</p>
  }
  return (
    <div className="rounded-lg border border-border bg-elevated px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-xs font-medium text-foreground"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span>{active.length} booked</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
          {active.map(b => (
            <li key={b.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-foreground">{b.studentName ?? 'Student'}</span>
              <Badge variant="outline" className={bookingStatusBadgeClass(b.status)}>{b.status.replace('_', ' ').toLowerCase()}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Attendance: {marked} of {active.length} marked
        {ended
          ? <> · mark from <button type="button" className="font-medium text-gold underline-offset-2 hover:underline" onClick={() => navigate({ view: 'teach-dashboard' })}>your BEAN Teach dashboard</button></>
          : ' · marking unlocks after the class ends'}
      </p>
    </div>
  )
}

function ScheduleClassDialog({ open, onOpenChange, orgId, onCreated }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  onCreated: (cls: PublicClassDTO) => void
}) {
  const fallbackTz = guessTimeZone()
  const [form, setForm] = useState(() => ({
    title: '',
    description: '',
    subject: '',
    targetLevel: TEACH_LEVEL_OPTIONS[0]?.value ?? 'SCHOOL_9_10',
    language: 'English',
    durationHours: '2',
    durationMinutesPart: '0',
    startsAtLocal: '',
    timeZone: COMMON_TIMEZONES.includes(fallbackTz) ? fallbackTz : 'Asia/Kolkata',
    capacity: '10',
    minimumStudents: '1',
    audience: 'ORGANIZATION' as 'ORGANIZATION' | 'GROUP',
    groupId: '',
  }))
  const [groups, setGroups] = useState<GroupDTO[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only ACTIVE groups are schedulable — mirrors the workspace behavior where
  // archived batches hold no new classes.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      api.organizationGroups(orgId)
        .then(res => setGroups(res.groups.filter(g => g.status === 'ACTIVE')))
        .catch(() => setGroups([]))
    }, 0)
    return () => clearTimeout(t)
  }, [open, orgId])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(f => ({ ...f, [key]: value }))
  const durationMinutes = (Number.parseInt(form.durationHours, 10) || 0) * 60 + (Number.parseInt(form.durationMinutesPart, 10) || 0)
  const invalidDuration = durationMinutes < 60 || durationMinutes > 360 || durationMinutes % 30 !== 0

  const submit = async () => {
    setError(null)
    if (form.title.trim().length < 8) { setError('Give the class a title (8+ characters).'); return }
    if (form.description.trim().length < 50) { setError('Describe the session in at least 50 characters.'); return }
    if (form.subject.trim().length < 2) { setError('Add the subject (2+ characters).'); return }
    if (!isFutureLocalSchedule(form.startsAtLocal)) { setError('Pick a future date and time for the class.'); return }
    const capacity = Number.parseInt(form.capacity, 10)
    const minimumStudents = Number.parseInt(form.minimumStudents, 10)
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) { setError('Capacity must be between 1 and 50.'); return }
    if (!Number.isInteger(minimumStudents) || minimumStudents < 1 || minimumStudents > capacity) { setError('Minimum enrolment must be between 1 and the capacity.'); return }
    const audienceError = institutionClassAudienceError(form.audience, form.audience === 'GROUP' ? form.groupId : null)
    if (audienceError) { setError(audienceError); return }
    setBusy(true)
    try {
      const res = await api.teachCreateClass({
        title: form.title.trim(),
        description: form.description.trim(),
        subject: form.subject.trim(),
        targetLevel: form.targetLevel,
        language: form.language.trim() || 'English',
        durationMinutes,
        startsAt: new Date(form.startsAtLocal).toISOString(),
        timeZone: form.timeZone,
        capacity,
        minimumStudents,
        audience: form.audience,
        organizationId: orgId,
        ...(form.audience === 'GROUP' && form.groupId ? { organizationGroupId: form.groupId } : {}),
      })
      toast({ title: 'Class scheduled as a draft — publish it when ready' })
      onCreated(res.class)
    } catch (e) {
      // Server error shown inline; every entered value is preserved.
      setError(e instanceof Error ? e.message : 'Could not schedule the class.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Schedule a class</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Runs on the BEAN Teach classroom system. Saved as a draft first — publishing is a separate, explicit step.
            Institution classes never appear in public discovery.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="oc-title">Class title</Label>
            <Input id="oc-title" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Quadratic equations — problem sprint" maxLength={120} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="oc-desc">Detailed description</Label>
            <Textarea id="oc-desc" value={form.description} onChange={e => set('description', e.target.value)} placeholder="What you will cover, what students should bring, how the session runs (50–4000 characters)" rows={4} maxLength={4000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="oc-subject">Subject</Label>
              <Input id="oc-subject" value={form.subject} onChange={e => set('subject', e.target.value)} maxLength={60} />
            </div>
            <div className="grid gap-1.5">
              <Label>Target level</Label>
              <Select value={form.targetLevel} onValueChange={v => set('targetLevel', v)}>
                <SelectTrigger aria-label="Target level"><SelectValue placeholder="Pick a level" /></SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {TEACH_LEVEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="oc-language">Language</Label>
              <Input id="oc-language" value={form.language} onChange={e => set('language', e.target.value)} maxLength={30} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Duration</Label>
              <div className="flex items-center gap-2">
                <Select value={form.durationHours} onValueChange={v => set('durationHours', v)}>
                  <SelectTrigger aria-label="Duration hours"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {[1, 2, 3, 4, 5, 6].map(h => <SelectItem key={h} value={String(h)}>{h}h</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={form.durationMinutesPart} onValueChange={v => set('durationMinutesPart', v)}>
                  <SelectTrigger aria-label="Duration minutes"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {[0, 30].map(m => <SelectItem key={m} value={String(m)}>{m}m</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <p className={`text-xs ${invalidDuration ? 'text-destructive' : 'text-muted-foreground'}`}>
                {formatDuration(durationMinutes)} — allowed range is 1h to 6h in 30-minute steps
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="oc-starts">Date &amp; time (your local device time)</Label>
              <Input id="oc-starts" type="datetime-local" value={form.startsAtLocal} onChange={e => set('startsAtLocal', e.target.value)} className="[color-scheme:dark]" />
            </div>
            <div className="grid gap-1.5">
              <Label>Time zone</Label>
              <Select value={form.timeZone} onValueChange={v => set('timeZone', v)}>
                <SelectTrigger aria-label="Time zone"><SelectValue /></SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {(COMMON_TIMEZONES.includes(form.timeZone) ? COMMON_TIMEZONES : [form.timeZone, ...COMMON_TIMEZONES]).map(tz => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Stored as UTC and shown to members in their local time.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="oc-capacity">Capacity (1–50)</Label>
              <Input id="oc-capacity" type="number" min={1} max={50} value={form.capacity} onChange={e => set('capacity', e.target.value)} className="[color-scheme:dark]" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="oc-minimum">Minimum enrolment</Label>
              <Input id="oc-minimum" type="number" min={1} max={50} value={form.minimumStudents} onChange={e => set('minimumStudents', e.target.value)} className="[color-scheme:dark]" />
              <p className="text-xs text-muted-foreground">Cannot exceed capacity.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="oc-audience">Audience</Label>
              <Select value={form.audience} onValueChange={v => set('audience', v as 'ORGANIZATION' | 'GROUP')}>
                <SelectTrigger id="oc-audience" aria-label="Audience"><SelectValue /></SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  <SelectItem value="ORGANIZATION">Organization (private to this institution)</SelectItem>
                  <SelectItem value="GROUP">Group only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.audience === 'GROUP' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="oc-group">Group</Label>
              {groups !== null && groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active groups yet — create one in Groups &amp; batches first.</p>
              ) : (
                <Select value={form.groupId} onValueChange={v => set('groupId', v)}>
                  <SelectTrigger id="oc-group" aria-label="Group"><SelectValue placeholder="Select group" /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {(groups ?? []).map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || invalidDuration} onClick={submit}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Schedule class
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Assignments ─────────────────────────────────────────────────────────────

function AssignmentsPanel({ orgId, isAdmin, active }: { orgId: string; isAdmin: boolean; active: boolean; groupsReady: boolean }) {
  const [data, setData] = useState<AssignmentDTO[] | null>(null)
  const [viewerRole, setViewerRole] = useState<string>('')
  const [failed, setFailed] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<AssignmentDetailResponse | null>(null)

  const load = useCallback(() => {
    setData(null)
    api.organizationAssignments(orgId)
      .then(res => { setData(res.assignments); setViewerRole(res.viewerRole); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load assignments.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const isStaff = ['OWNER', 'ADMIN', 'INSTRUCTOR'].includes(viewerRole)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Group assignments with private submissions — grades and feedback are visible only to the student and permitted staff.</p>
        {isStaff && active && isAdmin ? (
          <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreateOpen(true)}>New assignment</Button>
        ) : null}
      </div>
      {failed ? (
        <EmptyState icon={ClipboardList} title="Could not load assignments" description={failed} actionLabel="Try again" onAction={load} />
      ) : !data ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading assignments"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : data.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No assignments yet" description="Instructors publish assignments to their groups; enrolled learners submit work here." />
      ) : (
        <div className="space-y-3">
          {data.map(a => (
            <button
              key={a.id}
              type="button"
              className="exam-card-hover flex w-full flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-gold/40"
              onClick={() => { api.assignmentDetail(a.id).then(setDetail).catch(e => toast({ title: 'Could not open assignment', description: e instanceof Error ? e.message : '', variant: 'destructive' })) }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-foreground">{a.title}</h3>
                <Badge variant="outline" className={a.status === 'PUBLISHED' ? 'border-success/40 text-success' : 'border-border text-muted-foreground'}>
                  {a.status.toLowerCase()}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {a.subjectLabel ? <span><span className="text-gold">Subject:</span> {a.subjectLabel}</span> : null}
                {a.dueAt ? <span><span className="text-gold">Due:</span> {formatClassLocal(a.dueAt)}</span> : null}
                {a.maxScore ? <span><span className="text-gold">Max score:</span> {a.maxScore}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateAssignmentDialog open={createOpen} onOpenChange={setCreateOpen} orgId={orgId} onCreated={() => { setCreateOpen(false); load() }} />
      <AssignmentDetailDialog detail={detail} isStaff={isStaff} onClose={() => { setDetail(null); load() }} />
    </div>
  )
}

function CreateAssignmentDialog({ open, onOpenChange, orgId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; onCreated: () => void }) {
  const [groups, setGroups] = useState<GroupDTO[]>([])
  const [groupId, setGroupId] = useState('')
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [subjectLabel, setSubjectLabel] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [maxScore, setMaxScore] = useState('')
  const [publish, setPublish] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      api.organizationGroups(orgId).then(res => setGroups(res.groups)).catch(() => setGroups([]))
    }, 0)
    return () => clearTimeout(t)
  }, [open, orgId])

  const submit = async () => {
    setError(null)
    if (!groupId || title.trim().length < 4) {
      setError('Pick a group and give the assignment a title (4+ characters).')
      return
    }
    setBusy(true)
    try {
      await api.createAssignment(orgId, {
        groupId,
        title: title.trim(),
        instructions: instructions.trim() || undefined,
        subjectLabel: subjectLabel.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        maxScore: maxScore ? Number(maxScore) : undefined,
        publish,
      })
      toast({ title: publish ? 'Assignment published to the group' : 'Assignment saved as draft' })
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">New assignment</DialogTitle>
          <DialogDescription className="text-muted-foreground">Students in the selected group see published assignments and submit text or an external project link.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="as-group">Group</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger id="as-group" aria-label="Group"><SelectValue placeholder="Select group" /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="as-title">Title</Label>
            <Input id="as-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="as-instructions">Instructions (optional)</Label>
            <Textarea id="as-instructions" rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={4000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="as-subject">Subject (optional)</Label>
              <Input id="as-subject" value={subjectLabel} onChange={e => setSubjectLabel(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="as-due">Due (optional)</Label>
              <Input id="as-due" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} className="[color-scheme:dark]" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="as-max">Max score (optional)</Label>
              <Input id="as-max" type="number" min={1} max={1000} value={maxScore} onChange={e => setMaxScore(e.target.value)} className="[color-scheme:dark]" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} className="h-4 w-4 accent-[#D6A514]" />
            Publish immediately (uncheck to save as draft)
          </label>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AssignmentDetailDialog({ detail, isStaff, onClose }: { detail: AssignmentDetailResponse | null; isStaff: boolean; onClose: () => void }) {
  const [responseText, setResponseText] = useState('')
  const [externalLink, setExternalLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [grades, setGrades] = useState<Record<string, { gradeValue: string; teacherFeedback: string }>>({})

  useEffect(() => {
    if (!detail) return
    const t = setTimeout(() => {
      setResponseText(detail.mySubmission?.responseText ?? '')
      setExternalLink(detail.mySubmission?.externalLink ?? '')
      const initial: Record<string, { gradeValue: string; teacherFeedback: string }> = {}
      for (const s of detail.submissions ?? []) initial[s.id] = { gradeValue: s.gradeValue ?? '', teacherFeedback: s.teacherFeedback ?? '' }
      setGrades(initial)
    }, 0)
    return () => clearTimeout(t)
  }, [detail])

  if (!detail) return null
  const a = detail.assignment

  const submitWork = async () => {
    setBusy(true)
    try {
      await api.submitAssignment(a.id, { responseText: responseText.trim() || undefined, externalLink: externalLink.trim() || undefined })
      toast({ title: 'Submission saved' })
      onClose()
    } catch (e) {
      toast({ title: 'Could not submit', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const gradeOne = async (submissionId: string, markReturned: boolean) => {
    const g = grades[submissionId] ?? { gradeValue: '', teacherFeedback: '' }
    setBusy(true)
    try {
      await api.gradeSubmission(a.id, submissionId, { gradeValue: g.gradeValue || undefined, teacherFeedback: g.teacherFeedback || undefined, markReturned })
      toast({ title: markReturned ? 'Returned for rework' : 'Submission graded' })
      onClose()
    } catch (e) {
      toast({ title: 'Could not grade', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">{a.title}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {a.subjectLabel ? `${a.subjectLabel} · ` : ''}Status: {a.status.toLowerCase()}{a.dueAt ? ` · due ${formatClassLocal(a.dueAt)}` : ''}
          </DialogDescription>
        </DialogHeader>
        {a.instructions ? <p className="whitespace-pre-wrap rounded-lg border border-border bg-elevated p-3 text-sm text-muted-foreground">{a.instructions}</p> : null}

        {isStaff ? (
          (detail.submissions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions yet.</p>
          ) : (
            <div className="space-y-3">
              <Separator className="bg-border" />
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Submissions (staff only)</p>
              {(detail.submissions ?? []).map(s => (
                <div key={s.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{s.student.displayName || 'Student'}</p>
                    <Badge variant="outline" className="border-border text-muted-foreground">{s.status.toLowerCase()}</Badge>
                  </div>
                  {s.responseText ? <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">{s.responseText}</p> : null}
                  {s.externalLink ? (
                    <a href={s.externalLink} target="_blank" rel="noreferrer noopener" className="mt-1 block break-all text-xs text-gold underline-offset-4 hover:underline">
                      {s.externalLink}
                    </a>
                  ) : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Input
                      aria-label={`Grade for ${s.student.displayName || 'student'}`}
                      placeholder="Grade (e.g. 8/10)"
                      value={grades[s.id]?.gradeValue ?? ''}
                      onChange={e => setGrades(g => ({ ...g, [s.id]: { ...(g[s.id] ?? { teacherFeedback: '' }), gradeValue: e.target.value } }))}
                      maxLength={40}
                    />
                    <Input
                      aria-label={`Feedback for ${s.student.displayName || 'student'}`}
                      placeholder="Private feedback"
                      value={grades[s.id]?.teacherFeedback ?? ''}
                      onChange={e => setGrades(g => ({ ...g, [s.id]: { ...(g[s.id] ?? { gradeValue: '' }), teacherFeedback: e.target.value } }))}
                      maxLength={2000}
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={() => void gradeOne(s.id, false)}>Save grade</Button>
                    <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => void gradeOne(s.id, true)}>Return for rework</Button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="sub-text">Your response</Label>
              <Textarea id="sub-text" rows={5} value={responseText} onChange={e => setResponseText(e.target.value)} maxLength={8000} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sub-link">External project link (optional)</Label>
              <Input id="sub-link" value={externalLink} onChange={e => setExternalLink(e.target.value)} placeholder="https://…" />
            </div>
            {detail.mySubmission ? (
              <div className="rounded-lg border border-border bg-elevated p-3 text-sm text-muted-foreground">
                <p>Current status: <span className="text-foreground">{detail.mySubmission.status.toLowerCase()}</span></p>
                {detail.mySubmission.gradedAt && detail.mySubmission.gradeValue ? (
                  <p className="mt-1">Grade: <span className="text-gold">{detail.mySubmission.gradeValue}</span></p>
                ) : null}
                {detail.mySubmission.teacherFeedback ? <p className="mt-1">Feedback: {detail.mySubmission.teacherFeedback}</p> : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={submitWork}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}
                Save submission
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Resources (+ announcements in overview) ─────────────────────────────────

function ResourcesPanel({ orgId, isAdmin, active }: { orgId: string; isAdmin: boolean; active: boolean }) {
  const [data, setData] = useState<OrgResourcesResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setData(null)
    api.organizationResources(orgId)
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load resources.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const share = async () => {
    setBusy(true)
    try {
      await api.createResource(orgId, { title: title.trim(), description: description.trim() || undefined, url: url.trim() })
      toast({ title: 'Resource shared' })
      setTitle(''); setDescription(''); setUrl('')
      load()
    } catch (e) {
      toast({ title: 'Could not share', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-4 text-sm text-muted-foreground">Learning resources shared by the institution (external HTTPS links — private student documents stay inside Riishe).</p>
        {failed ? (
          <EmptyState icon={BookMarked} title="Could not load resources" description={failed} actionLabel="Try again" onAction={load} />
        ) : !data ? (
          <div className="flex min-h-[25vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : data.resources.length === 0 ? (
          <EmptyState icon={BookMarked} title="No resources yet" description="Share reference links, recordings or study pages with your members." />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {data.resources.map(r => (
              <li key={r.id} className="p-4">
                <p className="text-sm font-medium text-foreground">{r.title}</p>
                {r.description ? <p className="mt-1 text-xs text-muted-foreground">{r.description}</p> : null}
                <a href={r.url} target="_blank" rel="noreferrer noopener" className="mt-1 block break-all text-xs text-gold underline-offset-4 hover:underline">
                  {r.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {isAdmin && active ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-display text-sm font-semibold text-foreground">Share a resource</h3>
          <div className="mt-3 grid gap-3">
            <Input aria-label="Resource title" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} />
            <Input aria-label="Resource description" placeholder="Short description (optional)" value={description} onChange={e => setDescription(e.target.value)} maxLength={600} />
            <Input aria-label="Resource URL" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} />
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover sm:w-fit" disabled={busy || !title.trim() || !url.trim()} onClick={share}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Share resource
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ReportsPanel({ dash }: { dash: OrgDashboardResponse }) {
  const rows = [
    { label: 'Active members', value: dash.overview.activeMembers, note: 'roster of this organization only' },
    { label: 'Active groups', value: dash.overview.activeGroups, note: 'batches / cohorts' },
    { label: 'Upcoming institution classes', value: dash.overview.upcomingClasses, note: 'scheduled, not yet started' },
    { label: 'Published assignments', value: dash.overview.publishedAssignments, note: 'currently open group work' },
    { label: 'Submissions awaiting grading', value: dash.overview.openSubmissions, note: 'assigned to your staff' },
    { label: 'Active announcements', value: dash.overview.activeAnnouncements, note: 'not expired' },
  ]
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-display text-base font-semibold text-foreground">Institution activity</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Every figure derives from this organization&apos;s own activity. Personal learning data — Riishe conversations,
          documents, goals, notes and unrelated exam attempts — is never included, for any member.
        </p>
        <ul className="mt-4 divide-y divide-border">
          {rows.map(r => (
            <li key={r.label} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm text-foreground">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.note}</p>
              </div>
              <p className="font-display text-xl font-semibold text-gold">{r.value}</p>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">
        Attendance detail for institution classes lives in each class&apos;s attendance record (Phase 5 evidence); group-level
        completion metrics update as staff grade submissions.
      </p>
    </div>
  )
}

function AnnouncementsCard({ orgId, isAdmin, active }: { orgId: string; isAdmin: boolean; active: boolean }) {
  const [items, setItems] = useState<AnnouncementDTO[] | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setItems(null)
    api.organizationAnnouncements(orgId)
      .then(res => setItems(res.announcements))
      .catch(() => setItems([]))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const publish = async () => {
    setBusy(true)
    try {
      await api.createAnnouncement(orgId, { title: title.trim(), body: body.trim() })
      toast({ title: 'Announcement published' })
      setTitle(''); setBody('')
      load()
    } catch (e) {
      toast({ title: 'Could not publish', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <Megaphone className="h-4 w-4 text-gold" aria-hidden />
        <h3 className="font-display text-base font-semibold text-foreground">Announcements</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">In-app only — members of this organization see them here.</p>
      {!items ? (
        <div className="flex min-h-[10vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No announcements yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {items.map(a => (
            <li key={a.id} className="rounded-lg border border-border bg-elevated p-3">
              <p className="text-sm font-medium text-foreground">{a.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
              {a.publishedAt ? <p className="mt-1 text-xs text-muted-foreground">{formatClassLocal(a.publishedAt)}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && active ? (
        <div className="mt-4 grid gap-2 border-t border-border pt-4">
          <Input id="announcement-title-input" aria-label="Announcement title" placeholder="Announcement title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} />
          <Textarea aria-label="Announcement body" rows={2} placeholder="What should members know?" value={body} onChange={e => setBody(e.target.value)} maxLength={5000} />
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover sm:w-fit" disabled={busy || !title.trim() || body.trim().length < 10} onClick={publish}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Publish announcement
          </Button>
        </div>
      ) : null}
    </div>
  )
}

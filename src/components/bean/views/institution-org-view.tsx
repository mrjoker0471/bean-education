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
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import { formatClassLocal } from '@/components/bean/teach-format'
import type {
  AnnouncementDTO,
  AssignmentDTO,
  AssignmentDetailResponse,
  GroupDTO,
  MemberDTO,
  OrgClassesResponse,
  OrgDashboardResponse,
  OrgInvitationsResponse,
  OrgMembersResponse,
  OrgResourcesResponse,
  InvitationDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import {
  ArrowLeft,
  BadgeCheck,
  BookMarked,
  CalendarDays,
  ClipboardList,
  GraduationCap,
  Loader2,
  Megaphone,
  Send,
  ShieldAlert,
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
        {tab === 'overview' && <OverviewPanel dash={dash} />}
        {tab === 'members' && <MembersPanel orgId={org.id} isAdmin={isAdmin} active={dash.verification.operational} onChanged={load} />}
        {tab === 'groups' && <GroupsPanel orgId={org.id} isAdmin={isAdmin} active={dash.verification.operational} />}
        {tab === 'classes' && <ClassesPanel orgId={org.id} />}
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

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewPanel({ dash }: { dash: OrgDashboardResponse }) {
  const stats = [
    { label: 'Active members', value: dash.overview.activeMembers },
    { label: 'Pending approvals', value: dash.overview.pendingMembers },
    { label: 'Active groups', value: dash.overview.activeGroups },
    { label: 'Upcoming classes', value: dash.overview.upcomingClasses },
    { label: 'Published assignments', value: dash.overview.publishedAssignments },
    { label: 'Open submissions', value: dash.overview.openSubmissions },
    { label: 'Active announcements', value: dash.overview.activeAnnouncements },
  ]
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 font-display text-2xl font-semibold text-gold">{s.value}</p>
          </div>
        ))}
      </div>
      <AnnouncementsCard orgId={dash.organization.id} isAdmin={dash.isAdmin} active={dash.verification.operational} />
    </div>
  )
}

// ─── Members ─────────────────────────────────────────────────────────────────

function MembersPanel({ orgId, isAdmin, active, onChanged }: { orgId: string; isAdmin: boolean; active: boolean; onChanged: () => void }) {
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

// ─── Groups & batches ────────────────────────────────────────────────────────

function GroupsPanel({ orgId, isAdmin, active }: { orgId: string; isAdmin: boolean; active: boolean }) {
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
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Batches, sections and cohorts — learners are enrolled into groups by instructors.</p>
        {isAdmin && active ? (
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
            <div key={g.id} className="flex h-full flex-col rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-foreground">{g.name}</h3>
                <Badge variant="outline" className="border-border text-muted-foreground">{g.status.toLowerCase()}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                {g.programmeLabel ? <span><span className="text-gold">Programme:</span> {g.programmeLabel}</span> : null}
                {g.academicYear ? <span><span className="text-gold">Year:</span> {g.academicYear}</span> : null}
                {g.batchLabel ? <span><span className="text-gold">Batch:</span> {g.batchLabel}</span> : null}
                {g.sectionLabel ? <span><span className="text-gold">Section:</span> {g.sectionLabel}</span> : null}
                {g.trackLabel ? <span><span className="text-gold">Track:</span> {g.trackLabel}</span> : null}
                <span><span className="text-gold">Enrolled:</span> {g.activeEnrollmentCount}{g.capacity ? ` / ${g.capacity}` : ''}</span>
              </div>
              {isAdmin && active ? (
                <Button size="sm" variant="outline" className="mt-4 border-gold/40 text-gold hover:bg-gold/10" onClick={() => setEnrollGroup(g)}>
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

function ClassesPanel({ orgId }: { orgId: string }) {
  const [data, setData] = useState<OrgClassesResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const navigate = useAppStore(s => s.navigate)

  const load = useCallback(() => {
    setData(null)
    api.organizationClasses(orgId)
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load classes.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Institution classes use the same BEAN Teach classrooms and LiveKit rooms as public classes — organization and
        group audiences simply never appear in public discovery, and booking checks membership on the server.
      </p>
      {failed ? (
        <EmptyState icon={GraduationCap} title="Could not load classes" description={failed} actionLabel="Try again" onAction={load} />
      ) : !data ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading classes"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : data.classes.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No institution classes yet"
          description="Approved teachers with an instructor role create private classes from the Classes tab (choose an organization or group audience)."
          actionLabel="Browse classes"
          onAction={() => navigate({ view: 'classes' })}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.classes.map(c => (
            <button
              key={c.id}
              type="button"
              className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
              onClick={() => navigate({ view: 'class', classId: c.id })}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-foreground">{c.title}</h3>
                <Badge variant="outline" className={c.audience === 'PUBLIC' ? 'border-border text-muted-foreground' : 'border-gold/40 text-gold'}>
                  {c.audience === 'PUBLIC' ? 'public' : c.audience === 'ORGANIZATION' ? 'org only' : 'group only'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.subject} · {c.teacherName}</p>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 text-gold" aria-hidden />
                {formatClassLocal(c.startsAt)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
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

function AssignmentDetailDialog({ detail, isStaff, onClose }: { detail: AssignmentDetailResponse | null; isStaff: boolean; onClose: () => void }) {
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
          <Input aria-label="Announcement title" placeholder="Announcement title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} />
          <Textarea aria-label="Announcement body" rows={2} placeholder="What should members know?" value={body} onChange={e => setBody(e.target.value)} maxLength={5000} />
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover sm:w-fit" disabled={busy || !title.trim() || body.trim().length < 10} onClick={publish}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Publish announcement
          </Button>
        </div>
      ) : null}
    </div>
  )
}

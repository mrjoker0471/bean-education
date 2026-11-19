'use client'

// ─── Phase 7 — Group workspace (#/institution/:orgId/groups/:groupId[/tab]) ──
// One institution group: overview, full roster (ACTIVE + LEFT history is never
// hidden) and the group-scoped slices of the organization's classes,
// assignments, resources and announcements. Every affordance is gated through
// evaluateOrgCapabilities (the pure client mirror of the server guards — the
// server re-checks authorization on every request), and every list renders
// loading / empty / error+retry states. Consequential actions (archive,
// restore, remove member, leave) always confirm first.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore, type InstitutionGroupTab } from '@/lib/store'
import {
  evaluateOrgCapabilities,
  type OrgCapabilities,
  type OrgMembershipStatus,
  type OrgRole,
  type OrgVerificationStatus,
} from '@/lib/capabilities'
import { buildRoleIndex, enrollCandidates, filterByGroupId } from '@/lib/institution-group'
import type { GroupDetailDTO, GroupRosterEntryDTO } from '@/lib/institution-dto'
import { formatClassLocal, formatDay } from '@/components/bean/teach-format'
import { AssignmentDetailDialog } from '@/components/bean/views/institution-org-view'
import type {
  AnnouncementDTO,
  AssignmentDTO,
  AssignmentDetailResponse,
  GroupDTO,
  OrgClassRowDTO,
  OrgDashboardResponse,
  OrgMembersResponse,
  OrgResourceDTO,
} from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BookMarked,
  ClipboardList,
  GraduationCap,
  Loader2,
  LogOut,
  Megaphone,
  Pencil,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react'

const GROUP_TABS: { key: InstitutionGroupTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'roster', label: 'Roster' },
  { key: 'classes', label: 'Classes' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'resources', label: 'Resources' },
  { key: 'announcements', label: 'Announcements' },
]

function enrollmentBadgeClass(state: string): string {
  return state === 'ACTIVE'
    ? 'border-success/40 bg-success/10 text-success'
    : 'border-border bg-elevated text-muted-foreground'
}

function lifecycleBadgeClass(status: string): string {
  switch (status) {
    case 'PUBLISHED': return 'border-success/40 bg-success/10 text-success'
    case 'DRAFT': return 'border-gold/40 bg-gold/10 text-gold'
    case 'ARCHIVED': return 'border-destructive/40 bg-destructive/10 text-destructive'
    default: return 'border-border bg-elevated text-muted-foreground'
  }
}

export function InstitutionGroupView({ orgId, groupId, tab }: { orgId: string; groupId: string; tab?: InstitutionGroupTab }) {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [dash, setDash] = useState<OrgDashboardResponse | null>(null)
  const [detail, setDetail] = useState<GroupDetailDTO | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [archiveConfirm, setArchiveConfirm] = useState<'ARCHIVED' | 'ACTIVE' | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)

  const load = useCallback(() => {
    setDash(null)
    setDetail(null)
    Promise.all([api.organizationDashboard(orgId), api.organizationGroup(orgId, groupId)])
      .then(([d, g]) => { setDash(d); setDetail(g); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load this group.'))
  }, [orgId, groupId])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

  // Refreshes just the group after an in-place mutation (edit/archive/enroll).
  const reloadGroup = useCallback(() => {
    api.organizationGroup(orgId, groupId)
      .then(g => setDetail(g))
      .catch(e => toast({ title: 'Could not refresh the group', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' }))
  }, [orgId, groupId])

  if (!authChecked) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading group">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={ShieldAlert} title="Sign in required" description="Group workspaces are for organization members." actionLabel="Sign in" onAction={() => navigate({ view: 'auth' })} />
      </div>
    )
  }
  if (failed) {
    // Covers non-members (403), removed groups (404) and transient failures —
    // the back link always returns to the organization's groups section.
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState
          icon={ShieldAlert}
          title="Could not open this group"
          description={failed}
          actionLabel="Back to the organization"
          onAction={() => navigate({ view: 'institution-org', orgId, section: 'groups' })}
        />
      </div>
    )
  }
  if (!dash || !detail) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading group">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  const group = detail.group
  const caps = evaluateOrgCapabilities({
    role: dash.role as OrgRole,
    membershipStatus: dash.membership.status as OrgMembershipStatus,
    verificationStatus: dash.organization.verificationStatus as OrgVerificationStatus,
    organizationActive: dash.organization.isActive,
  })
  const orgName = dash.organization.displayName || dash.organization.name
  const archived = group.status === 'ARCHIVED'
  const capacityChip = group.capacity === null
    ? `${group.activeEnrollmentCount} enrolled · unlimited`
    : `${group.activeEnrollmentCount} / ${group.capacity} enrolled`

  const setGroupStatus = async (status: 'ARCHIVED' | 'ACTIVE') => {
    setStatusBusy(true)
    try {
      await api.updateOrganizationGroup(orgId, groupId, { status })
      toast({ title: status === 'ARCHIVED' ? 'Group archived — historical records are kept' : 'Group restored' })
      setArchiveConfirm(null)
      reloadGroup()
    } catch (e) {
      toast({ title: 'Could not update the group', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <Button
        variant="ghost"
        className="-ml-2 mb-3 text-muted-foreground hover:text-foreground"
        onClick={() => navigate({ view: 'institution-org', orgId, section: 'groups' })}
      >
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> {orgName}
      </Button>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Institution · Group</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">{group.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={archived ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-success/40 bg-success/10 text-success'}>
              {archived ? 'Archived' : 'Active'}
            </Badge>
            <Badge variant="outline" className="border-border text-muted-foreground">{capacityChip}</Badge>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{orgName} › {group.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {caps.canEditGroups ? (
            <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden /> Edit group
            </Button>
          ) : null}
          {caps.canArchiveGroups ? (
            <Button
              size="sm"
              variant="outline"
              className={archived ? 'border-success/40 text-success hover:bg-success/10' : 'border-destructive/40 text-destructive hover:bg-destructive/10'}
              onClick={() => setArchiveConfirm(archived ? 'ACTIVE' : 'ARCHIVED')}
            >
              {archived ? <ArchiveRestore className="mr-2 h-3.5 w-3.5" aria-hidden /> : <Archive className="mr-2 h-3.5 w-3.5" aria-hidden />}
              {archived ? 'Restore group' : 'Archive group'}
            </Button>
          ) : null}
        </div>
      </div>

      {/* Tab strip navigates via the hash router so back/forward and refresh
          always restore the exact tab (unknown tabs fall back to overview). */}
      <div className="mt-6 overflow-x-auto">
        <Tabs
          value={tab ?? 'overview'}
          onValueChange={v => navigate({ view: 'institution-group', orgId, groupId, tab: v as InstitutionGroupTab })}
        >
          <TabsList className="bg-elevated">
            {GROUP_TABS.map(t => (
              <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="mt-6">
        {(tab ?? 'overview') === 'overview' && <GroupOverviewPanel group={group} counts={detail.counts} />}
        {(tab ?? 'overview') === 'roster' && (
          <GroupRosterPanel orgId={orgId} group={group} detail={detail} caps={caps} myMembershipId={dash.membership.id} onChanged={reloadGroup} />
        )}
        {(tab ?? 'overview') === 'classes' && <GroupClassesPanel orgId={orgId} groupId={groupId} />}
        {(tab ?? 'overview') === 'assignments' && <GroupAssignmentsPanel orgId={orgId} groupId={groupId} />}
        {(tab ?? 'overview') === 'resources' && <GroupResourcesPanel orgId={orgId} groupId={groupId} />}
        {(tab ?? 'overview') === 'announcements' && <GroupAnnouncementsPanel orgId={orgId} groupId={groupId} />}
      </div>

      <AlertDialog open={archiveConfirm !== null} onOpenChange={o => !o && setArchiveConfirm(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">
              {archiveConfirm === 'ARCHIVED' ? `Archive ${group.name}?` : `Restore ${group.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {archiveConfirm === 'ARCHIVED'
                ? 'The group leaves active lists and stops accepting new enrollments. Historical records are kept — enrollments, submissions and attendance history survive, and the group can be restored at any time.'
                : 'The group becomes active again: it reappears in active lists and accepts new enrollments. Historical records were preserved throughout.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated" disabled={statusBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={archiveConfirm === 'ARCHIVED' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
              onClick={e => { e.preventDefault(); if (archiveConfirm) void setGroupStatus(archiveConfirm) }}
            >
              {archiveConfirm === 'ARCHIVED' ? 'Archive group' : 'Restore group'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {caps.canEditGroups ? (
        <EditGroupDialog open={editOpen} onOpenChange={setEditOpen} orgId={orgId} group={group} onSaved={reloadGroup} />
      ) : null}
    </div>
  )
}

// ─── Overview ────────────────────────────────────────────────────────────────

function GroupOverviewPanel({ group, counts }: { group: GroupDTO; counts: GroupDetailDTO['counts'] }) {
  const labels = [
    { label: 'Programme', value: group.programmeLabel },
    { label: 'Academic year', value: group.academicYear },
    { label: 'Batch', value: group.batchLabel },
    { label: 'Section', value: group.sectionLabel },
    { label: 'Subject / track', value: group.trackLabel },
  ].filter(l => l.value)
  const summary = labels.map(l => `${l.label}: ${l.value}`).join(' · ')
  const stats: { label: string; value: number | string }[] = [
    { label: 'Active enrollments', value: counts.activeCount },
    { label: 'Capacity', value: counts.capacity === null ? 'Unlimited' : counts.capacity },
    { label: 'Seats remaining', value: counts.capacity === null ? 'Unlimited' : Math.max(0, counts.capacity - counts.activeCount) },
    { label: 'Historical enrollments', value: counts.totalEnrolled },
  ]
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-display text-base font-semibold text-foreground">Group labels</h3>
        {labels.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No labels set — instructors can add programme, year, batch, section or track labels with Edit group.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted-foreground">{summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {labels.map(l => (
                <Badge key={l.label} variant="outline" className="border-gold/40 text-gold">{l.label}: {l.value}</Badge>
              ))}
            </div>
          </>
        )}
        <p className="mt-4 text-xs text-muted-foreground">Created {formatDay(group.createdAt)}</p>
        {group.startsAt || group.endsAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {group.startsAt ? `Runs from ${formatDay(group.startsAt)}` : 'No start date'}
            {group.startsAt && group.endsAt ? ' to ' : ''}
            {group.endsAt ? formatDay(group.endsAt) : ''}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 font-display text-2xl font-semibold text-gold">{s.value}</p>
          </div>
        ))}
      </div>
      {group.status === 'ARCHIVED' ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-destructive">This group is archived.</p>
          <p className="mt-1">
            Historical records are kept — the roster still shows every past enrollment. New enrollments are blocked
            until an instructor restores the group.
          </p>
        </div>
      ) : null}
    </div>
  )
}

// ─── Roster ──────────────────────────────────────────────────────────────────

function GroupRosterPanel({ orgId, group, detail, caps, myMembershipId, onChanged }: {
  orgId: string
  group: GroupDTO
  detail: GroupDetailDTO
  caps: OrgCapabilities
  myMembershipId: string
  onChanged: () => void
}) {
  const [members, setMembers] = useState<OrgMembersResponse | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<GroupRosterEntryDTO | null>(null)
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Org roles are joined client-side for the badges; a failure here is
  // non-fatal — the roster itself comes from the group detail response.
  useEffect(() => {
    const t = setTimeout(() => {
      api.organizationMembers(orgId)
        .then(setMembers)
        .catch(() => setMembers(null))
    }, 0)
    return () => clearTimeout(t)
  }, [orgId])

  const roleIndex = members ? buildRoleIndex(members.members) : new Map<string, string>()
  const myActiveEntry = detail.roster.find(r => r.membershipId === myMembershipId && r.enrollmentState === 'ACTIVE') ?? null
  const activeCount = detail.roster.filter(r => r.enrollmentState === 'ACTIVE').length

  const removeMember = async (entry: GroupRosterEntryDTO) => {
    setBusyId(entry.id)
    try {
      await api.removeGroupMember(orgId, group.id, entry.membershipId)
      toast({ title: 'Member removed — their history in this group is kept' })
      setConfirmRemove(null)
      onChanged()
    } catch (e) {
      toast({ title: 'Could not remove the member', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const leaveGroup = async () => {
    setBusyId('self')
    try {
      await api.leaveGroup(orgId, group.id)
      toast({ title: 'You left the group — your history is kept' })
      setLeaveConfirm(false)
      onChanged()
    } catch (e) {
      toast({ title: 'Could not leave the group', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="border-success/40 text-success">{activeCount} active</Badge>
          <Badge variant="outline" className="border-border text-muted-foreground">{detail.roster.length} historical</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {caps.canEnrollGroupMembers && group.status === 'ACTIVE' ? (
            <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setEnrollOpen(true)}>
              <UserPlus className="mr-2 h-3.5 w-3.5" aria-hidden /> Enroll member
            </Button>
          ) : null}
          {myActiveEntry ? (
            <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setLeaveConfirm(true)}>
              <LogOut className="mr-2 h-3.5 w-3.5" aria-hidden /> Leave group
            </Button>
          ) : null}
        </div>
      </div>

      {detail.roster.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No one is enrolled yet"
          description={caps.canEnrollGroupMembers && group.status === 'ACTIVE'
            ? 'Enroll active organization members into this group so they can attend its classes and see its assignments.'
            : 'Instructors enroll active organization members into groups.'}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {detail.roster.map(entry => {
              const left = entry.enrollmentState !== 'ACTIVE'
              const role = roleIndex.get(entry.membershipId) ?? null
              const self = entry.membershipId === myMembershipId
              return (
                <li
                  key={entry.id}
                  className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${left ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-elevated text-sm text-muted-foreground" aria-hidden>
                      {(entry.member.displayName || 'M').slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <p className={`text-sm font-medium ${left ? 'text-muted-foreground' : 'text-foreground'}`}>
                        {entry.member.displayName || 'Member'}{self ? ' (you)' : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {role ? <Badge variant="outline" className="border-gold/40 text-gold">{role.toLowerCase()}</Badge> : null}
                        <Badge variant="outline" className={enrollmentBadgeClass(entry.enrollmentState)}>
                          {entry.enrollmentState.toLowerCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          joined {formatDay(entry.joinedAt)}{entry.leftAt ? ` · left ${formatDay(entry.leftAt)}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  {!left && caps.canEnrollGroupMembers && !self ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={busyId === entry.id}
                      onClick={() => setConfirmRemove(entry)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Rows are never deleted: leaving or removal flips an enrollment to LEFT and assignment and attendance history
        survives. Only display names are shown — never emails.
      </p>

      <EnrollIntoGroupDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        orgId={orgId}
        group={group}
        roster={detail.roster}
        onEnrolled={onChanged}
      />

      <AlertDialog open={!!confirmRemove} onOpenChange={o => !o && setConfirmRemove(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">
              {confirmRemove ? `Remove ${confirmRemove.member.displayName || 'this member'} from ${group.name}?` : ''}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Their enrollment flips to LEFT and stays visible in the roster — submissions and attendance history are
              preserved. They lose access to this group&apos;s classes and assignments immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={e => { e.preventDefault(); if (confirmRemove) void removeMember(confirmRemove) }}
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaveConfirm} onOpenChange={setLeaveConfirm}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Leave {group.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Your enrollment flips to LEFT and stays visible in the roster — your submissions and attendance history
              are preserved. An instructor can re-enroll you later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={e => { e.preventDefault(); void leaveGroup() }}
            >
              Leave group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EnrollIntoGroupDialog({ open, onOpenChange, orgId, group, roster, onEnrolled }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  group: GroupDTO
  roster: GroupRosterEntryDTO[]
  onEnrolled: () => void
}) {
  const [members, setMembers] = useState<OrgMembersResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setMembers(null)
    setFailed(null)
    api.organizationMembers(orgId)
      .then(setMembers)
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load members.'))
  }, [orgId])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [open, load])

  const candidates = members ? enrollCandidates(members.members, roster) : []

  const enroll = async (membershipId: string) => {
    setBusyId(membershipId)
    try {
      await api.enrollMember(orgId, group.id, membershipId)
      toast({ title: 'Member enrolled' })
      onEnrolled()
      load()
    } catch (e) {
      toast({ title: 'Could not enroll', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Enroll into {group.name}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Active organization members who are not currently enrolled. Group classes stay restricted to enrolled
            members.
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <EmptyState icon={Users} title="Could not load members" description={failed} actionLabel="Try again" onAction={load} />
        ) : !members ? (
          <div className="flex min-h-[20vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every active organization member is already enrolled in this group.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {candidates.map(m => (
              <li key={m.id} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm text-foreground">{m.student.displayName || 'Member'}</p>
                  <p className="text-xs text-muted-foreground">{m.role.toLowerCase()}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-gold/40 text-gold hover:bg-gold/10"
                  disabled={busyId === m.id}
                  onClick={() => void enroll(m.id)}
                >
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

// ─── Edit group ──────────────────────────────────────────────────────────────

function EditGroupDialog({ open, onOpenChange, orgId, group, onSaved }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  group: GroupDTO
  onSaved: () => void
}) {
  const [name, setName] = useState(group.name)
  const [programmeLabel, setProgrammeLabel] = useState(group.programmeLabel ?? '')
  const [academicYear, setAcademicYear] = useState(group.academicYear ?? '')
  const [batchLabel, setBatchLabel] = useState(group.batchLabel ?? '')
  const [sectionLabel, setSectionLabel] = useState(group.sectionLabel ?? '')
  const [trackLabel, setTrackLabel] = useState(group.trackLabel ?? '')
  const [capacity, setCapacity] = useState(group.capacity === null ? '' : String(group.capacity))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the fields when the dialog opens. Entered values survive recoverable
  // failures: the effect only re-runs when the dialog is (re)opened or the
  // parent's group copy actually changes after a successful save.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setName(group.name)
      setProgrammeLabel(group.programmeLabel ?? '')
      setAcademicYear(group.academicYear ?? '')
      setBatchLabel(group.batchLabel ?? '')
      setSectionLabel(group.sectionLabel ?? '')
      setTrackLabel(group.trackLabel ?? '')
      setCapacity(group.capacity === null ? '' : String(group.capacity))
      setError(null)
    }, 0)
    return () => clearTimeout(t)
  }, [open, group])

  const submit = async () => {
    setError(null)
    if (name.trim().length < 2) { setError('Give the group a name.'); return }
    const capacityValue = capacity.trim()
    if (capacityValue && !/^\d+$/.test(capacityValue)) { setError('Capacity must be a whole number.'); return }
    setBusy(true)
    try {
      await api.updateOrganizationGroup(orgId, group.id, {
        name: name.trim(),
        programmeLabel: programmeLabel.trim() || null,
        academicYear: academicYear.trim() || null,
        batchLabel: batchLabel.trim() || null,
        sectionLabel: sectionLabel.trim() || null,
        trackLabel: trackLabel.trim() || null,
        capacity: capacityValue ? Number(capacityValue) : undefined,
      })
      toast({ title: 'Group updated' })
      onSaved()
      onOpenChange(false)
    } catch (e) {
      // Recoverable (capacity below active enrollment, etc.) — keep the dialog
      // open with every entered value intact and show the server error inline.
      setError(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Edit group</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Labels organize the group across the institution. Capacity can never drop below the current active
            enrollment.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="eg-name">Group name</Label>
            <Input id="eg-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="eg-programme">Programme</Label>
              <Input id="eg-programme" value={programmeLabel} onChange={e => setProgrammeLabel(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="eg-year">Academic year</Label>
              <Input id="eg-year" value={academicYear} onChange={e => setAcademicYear(e.target.value)} maxLength={40} placeholder="2025–26" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="eg-batch">Batch</Label>
              <Input id="eg-batch" value={batchLabel} onChange={e => setBatchLabel(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="eg-section">Section</Label>
              <Input id="eg-section" value={sectionLabel} onChange={e => setSectionLabel(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="eg-track">Subject / track</Label>
              <Input id="eg-track" value={trackLabel} onChange={e => setTrackLabel(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="eg-capacity">Capacity</Label>
              <Input
                id="eg-capacity"
                type="number"
                min={1}
                max={2000}
                value={capacity}
                onChange={e => setCapacity(e.target.value)}
                className="[color-scheme:dark]"
                aria-describedby="eg-capacity-hint"
              />
              <p id="eg-capacity-hint" className="text-xs text-muted-foreground">Currently {group.activeEnrollmentCount} active. Leave unchanged to keep.</p>
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Group-scoped slices of organization content ─────────────────────────────

function GroupClassesPanel({ orgId, groupId }: { orgId: string; groupId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const [classes, setClasses] = useState<OrgClassRowDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    setClasses(null)
    api.organizationClasses(orgId)
      .then(res => { setClasses(filterByGroupId(res.classes, groupId, c => c.organizationGroupId)); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load classes.'))
  }, [orgId, groupId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Classes with this group as their audience. Enrollment is checked on the server — only this group&apos;s members
        can book or join.
      </p>
      {failed ? (
        <EmptyState icon={GraduationCap} title="Could not load classes" description={failed} actionLabel="Try again" onAction={load} />
      ) : !classes ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading classes"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : classes.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No classes for this group"
          description="Instructors create group-audience classes from the Classes tab; they appear here for this group's members."
          actionLabel="Open organization classes"
          onAction={() => navigate({ view: 'institution-org', orgId, section: 'classes' })}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map(c => (
            <button
              key={c.id}
              type="button"
              className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
              onClick={() => navigate({ view: 'class', classId: c.id })}
              aria-label={`Open class ${c.title}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-foreground">{c.title}</h3>
                <Badge variant="outline" className={c.audience === 'PUBLIC' ? 'border-border text-muted-foreground' : 'border-gold/40 text-gold'}>
                  {c.audience === 'PUBLIC' ? 'public' : c.audience === 'ORGANIZATION' ? 'org only' : 'group only'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{c.subject} · {c.teacherName}</p>
              <p className="mt-3 text-xs text-muted-foreground">{c.status.toLowerCase()}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function GroupAssignmentsPanel({ orgId, groupId }: { orgId: string; groupId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const [assignments, setAssignments] = useState<AssignmentDTO[] | null>(null)
  const [viewerRole, setViewerRole] = useState('')
  const [failed, setFailed] = useState<string | null>(null)
  const [detail, setDetail] = useState<AssignmentDetailResponse | null>(null)

  const load = useCallback(() => {
    setAssignments(null)
    api.organizationAssignments(orgId)
      .then(res => { setAssignments(filterByGroupId(res.assignments, groupId, a => a.groupId)); setViewerRole(res.viewerRole); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load assignments.'))
  }, [orgId, groupId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const isStaff = ['OWNER', 'ADMIN', 'INSTRUCTOR'].includes(viewerRole)

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Assignments for this group — submissions and grades stay private to each student and permitted staff.
      </p>
      {failed ? (
        <EmptyState icon={ClipboardList} title="Could not load assignments" description={failed} actionLabel="Try again" onAction={load} />
      ) : !assignments ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading assignments"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : assignments.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No assignments for this group"
          description="Instructors publish assignments to this group from the organization workspace."
          actionLabel="Open organization assignments"
          onAction={() => navigate({ view: 'institution-org', orgId, section: 'assignments' })}
        />
      ) : (
        <div className="space-y-3">
          {assignments.map(a => (
            <button
              key={a.id}
              type="button"
              className="exam-card-hover flex w-full flex-col rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-gold/40"
              onClick={() => { api.assignmentDetail(a.id).then(setDetail).catch(e => toast({ title: 'Could not open assignment', description: e instanceof Error ? e.message : '', variant: 'destructive' })) }}
              aria-label={`Open assignment ${a.title}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-semibold text-foreground">{a.title}</h3>
                <Badge variant="outline" className={lifecycleBadgeClass(a.status)}>{a.status.toLowerCase()}</Badge>
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

      <AssignmentDetailDialog detail={detail} isStaff={isStaff} onClose={() => { setDetail(null); load() }} />
    </div>
  )
}

function GroupResourcesPanel({ orgId, groupId }: { orgId: string; groupId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const [resources, setResources] = useState<OrgResourceDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    setResources(null)
    api.organizationResources(orgId)
      .then(res => { setResources(filterByGroupId(res.resources, groupId, r => r.groupId)); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load resources.'))
  }, [orgId, groupId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">Learning resources shared with this group (external HTTPS links).</p>
      {failed ? (
        <EmptyState icon={BookMarked} title="Could not load resources" description={failed} actionLabel="Try again" onAction={load} />
      ) : !resources ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading resources"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : resources.length === 0 ? (
        <EmptyState
          icon={BookMarked}
          title="No resources for this group"
          description="Resources shared with this group by the institution appear here."
          actionLabel="Open organization resources"
          onAction={() => navigate({ view: 'institution-org', orgId, section: 'resources' })}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {resources.map(r => (
            <li key={r.id} className="p-4">
              <p className="text-sm font-medium text-foreground">{r.title}</p>
              {r.description ? <p className="mt-1 text-xs text-muted-foreground">{r.description}</p> : null}
              <a href={r.url} target="_blank" rel="noreferrer noopener" className="mt-1 block break-all text-xs text-gold underline-offset-4 hover:underline">
                {r.url}
              </a>
              <p className="mt-1 text-xs text-muted-foreground">Shared {formatDay(r.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GroupAnnouncementsPanel({ orgId, groupId }: { orgId: string; groupId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const [announcements, setAnnouncements] = useState<AnnouncementDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    setAnnouncements(null)
    api.organizationAnnouncements(orgId)
      .then(res => { setAnnouncements(filterByGroupId(res.announcements, groupId, a => a.groupId)); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load announcements.'))
  }, [orgId, groupId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">Announcements addressed to this group (in-app only).</p>
      {failed ? (
        <EmptyState icon={Megaphone} title="Could not load announcements" description={failed} actionLabel="Try again" onAction={load} />
      ) : !announcements ? (
        <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading announcements"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements for this group"
          description="Announcements addressed to this group appear here; staff publish them from the organization workspace."
          actionLabel="Open organization overview"
          onAction={() => navigate({ view: 'institution-org', orgId, section: 'overview' })}
        />
      ) : (
        <ul className="space-y-3">
          {announcements.map(a => (
            <li key={a.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{a.title}</p>
                <Badge variant="outline" className={lifecycleBadgeClass(a.status)}>{a.status.toLowerCase()}</Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {a.publishedAt ? `Published ${formatDay(a.publishedAt)}` : `Created ${formatDay(a.createdAt)}`}
                {a.expiresAt ? ` · expires ${formatDay(a.expiresAt)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

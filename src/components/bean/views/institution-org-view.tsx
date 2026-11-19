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
  Archive,
  Award,
  BadgeCheck,
  BookMarked,
  CalendarDays,
  ClipboardList,
  Copy,
  GraduationCap,
  Loader2,
  Lock,
  MailWarning,
  Megaphone,
  Pencil,
  RefreshCw,
  Send,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react'

const STAFF_ROLES = ['OWNER', 'ADMIN', 'INSTRUCTOR'] as const
const isStaffRole = (role: string) => (STAFF_ROLES as readonly string[]).includes(role)

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
        {/* Mobile: the 7 section tabs exceed 390px — scroll them horizontally instead of overflowing the page. */}
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="bg-elevated w-fit min-w-max">
            {SECTION_TABS.map(t => (
              <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <div className="mt-6">
        {tab === 'overview' && <OverviewPanel dash={dash} onChanged={load} />}
        {tab === 'members' && (
          <MembersPanel
            orgId={org.id}
            isAdmin={isAdmin}
            active={dash.verification.operational}
            orgType={org.orgType}
            viewerRole={dash.membership.role}
            onChanged={load}
          />
        )}
        {tab === 'groups' && (
          <GroupsPanel orgId={org.id} active={dash.verification.operational} viewerRole={dash.membership.role} />
        )}
        {tab === 'classes' && <ClassesPanel orgId={org.id} viewerRole={dash.membership.role} />}
        {tab === 'assignments' && (
          <AssignmentsPanel
            orgId={org.id}
            isAdmin={isAdmin}
            active={dash.verification.operational}
            groupsReady={dash.verification.operational}
            viewerRole={dash.membership.role}
            onChanged={load}
          />
        )}
        {tab === 'resources' && <ResourcesPanel orgId={org.id} isAdmin={isAdmin} active={dash.verification.operational} viewerRole={dash.membership.role} />}
        {tab === 'reports' && <ReportsPanel dash={dash} onRefresh={load} />}
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

function OverviewPanel({ dash, onChanged }: { dash: OrgDashboardResponse; onChanged: () => void }) {
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
      <PublicProfilePreviewCard organization={dash.organization} onEdited={onChanged} isAdmin={dash.isAdmin} />
      <AnnouncementsCard orgId={dash.organization.id} isAdmin={dash.isAdmin} active={dash.verification.operational} />
    </div>
  )
}

// ─── Organization profile editor (admins) + public preview ───────────────────

function PublicProfilePreviewCard({
  organization,
  isAdmin,
  onEdited,
}: {
  organization: OrgDashboardResponse['organization']
  isAdmin: boolean
  onEdited: () => void
}) {
  const [editorOpen, setEditorOpen] = useState(false)
  const location = [organization.city, organization.state, organization.country].filter(Boolean).join(', ')

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-foreground">Public profile preview</h3>
          <p className="mt-1 text-xs text-muted-foreground">Exactly what a visitor sees — verification is decided by BEAN administrators only and can never be edited here.</p>
        </div>
        {isAdmin ? (
          <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setEditorOpen(true)}>
            <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden /> Edit profile
          </Button>
        ) : null}
      </div>
      <div className="mt-4 rounded-xl border border-border bg-elevated p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-lg" aria-hidden>
            {organization.logoText || '🏛'}
          </span>
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-foreground">{organization.displayName || organization.name}</p>
            <p className="text-xs text-muted-foreground">
              {organization.verificationStatus === 'APPROVED' ? 'Identity reviewed by BEAN' : 'Not verified by BEAN yet'}
            </p>
          </div>
        </div>
        {organization.description ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{organization.description}</p>
        ) : (
          <p className="mt-3 text-sm italic text-muted-foreground">No description yet{isAdmin ? ' — add one so visitors know what your institution offers.' : '.'}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {organization.website ? (
            <a href={organization.website} target="_blank" rel="noreferrer noopener" className="break-all text-gold underline-offset-4 hover:underline">{organization.website}</a>
          ) : null}
          {location ? <span>{location}</span> : null}
          {organization.publicContact ? <span>Contact: {organization.publicContact}</span> : null}
        </div>
        {!organization.website && !location && !organization.publicContact ? (
          <p className="mt-2 text-xs italic text-muted-foreground">No website, location or public contact on record yet.</p>
        ) : null}
      </div>
      <OrgProfileEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        organization={organization}
        onSaved={() => {
          setEditorOpen(false)
          onEdited()
        }}
      />
    </section>
  )
}

function OrgProfileEditorDialog({
  open,
  onOpenChange,
  organization,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organization: OrgDashboardResponse['organization']
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState(organization.displayName ?? '')
  const [description, setDescription] = useState(organization.description ?? '')
  const [website, setWebsite] = useState(organization.website ?? '')
  const [publicContact, setPublicContact] = useState(organization.publicContact ?? '')
  const [country, setCountry] = useState(organization.country ?? '')
  const [state, setState] = useState(organization.state ?? '')
  const [city, setCity] = useState(organization.city ?? '')
  const [logoText, setLogoText] = useState(organization.logoText ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The decision reason comes from the org's own-view DTO (organizationDetail);
  // admin verification notes are private to BEAN and never exposed by the API.
  const [decisionReason, setDecisionReason] = useState<string | null>(null)

  // Re-sync the form whenever the dialog opens so saved data never goes stale.
  useEffect(() => {
    if (!open) return
    setDisplayName(organization.displayName ?? '')
    setDescription(organization.description ?? '')
    setWebsite(organization.website ?? '')
    setPublicContact(organization.publicContact ?? '')
    setCountry(organization.country ?? '')
    setState(organization.state ?? '')
    setCity(organization.city ?? '')
    setLogoText(organization.logoText ?? '')
    setError(null)
    setDecisionReason(null)
    api.organizationDetail(organization.id)
      .then(res => setDecisionReason(res.organization.rejectionReason))
      .catch(() => undefined)
  }, [open, organization])

  const websiteInvalid = website.trim().length > 0 && !/^https:\/\/\S+$/i.test(website.trim())

  const save = async () => {
    setError(null)
    if (websiteInvalid) {
      setError('Use a full https:// address (e.g. https://example.edu).')
      return
    }
    setBusy(true)
    try {
      await api.updateOrganization(organization.id, {
        displayName: displayName.trim(),
        description: description.trim(),
        website: website.trim(),
        publicContact: publicContact.trim(),
        country: country.trim(),
        state: state.trim(),
        city: city.trim(),
        logoText: logoText.trim(),
      })
      toast({ title: 'Profile updated' })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Edit organization profile</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Verification status is a BEAN administrator decision — it is never editable here.
            {organization.verificationStatus === 'REJECTED'
              ? ' Correct the details below, then submit the application again from the workspace header.'
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2">
          <Badge variant="outline" className={verificationBadge(organization.verificationStatus)}>
            {verificationCopy(organization.verificationStatus)}
          </Badge>
          {decisionReason ? <span className="text-xs text-muted-foreground">Decision reason on record: {decisionReason}</span> : null}
        </div>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="prof-name">Official name</Label>
              <Input id="prof-name" value={organization.name} disabled aria-readonly />
              <p className="text-xs text-muted-foreground">Registered name — fixed at creation.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prof-display">Public display name</Label>
              <Input id="prof-display" value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={120} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prof-desc">Description</Label>
            <Textarea id="prof-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={1500} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="prof-website">Website</Label>
              <Input
                id="prof-website"
                value={website}
                onChange={e => setWebsite(e.target.value)}
                placeholder="https://"
                aria-invalid={websiteInvalid}
                className={websiteInvalid ? 'border-destructive' : undefined}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prof-contact">Public contact</Label>
              <Input id="prof-contact" value={publicContact} onChange={e => setPublicContact(e.target.value)} maxLength={300} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="prof-country">Country</Label>
              <Input id="prof-country" value={country} onChange={e => setCountry(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prof-state">State</Label>
              <Input id="prof-state" value={state} onChange={e => setState(e.target.value)} maxLength={80} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="prof-city">City</Label>
              <Input id="prof-city" value={city} onChange={e => setCity(e.target.value)} maxLength={80} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prof-logo">Logo letters (up to 8)</Label>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-base" aria-hidden>
                {logoText.trim() || '🏛'}
              </span>
              <Input id="prof-logo" value={logoText} onChange={e => setLogoText(e.target.value)} maxLength={8} className="w-32" />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={save}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Members ─────────────────────────────────────────────────────────────────

function MembersPanel({
  orgId,
  isAdmin,
  active,
  orgType,
  viewerRole,
  onChanged,
}: {
  orgId: string
  isAdmin: boolean
  active: boolean
  orgType: string
  viewerRole: string
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

  // Credentials are issued by OWNER/ADMIN/INSTRUCTOR of non-employer orgs.
  const canIssueCredentials = active && isStaffRole(viewerRole) && orgType !== 'EMPLOYER'

  return (
    <div className="space-y-6">
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

      <InvitationsPanel orgId={orgId} enabled={isAdmin && active} onChanged={onChanged} />
      <IssueCredentialCard orgId={orgId} enabled={canIssueCredentials} members={data?.members ?? null} onChanged={onChanged} />

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

// ─── Members — invitations (admin only) ──────────────────────────────────────
// Lists every invitation with an honest computed status, creates invitations
// (copy-link only — no email is ever claimed) and revokes pending ones. The
// raw token is shown EXACTLY ONCE, immediately after creation.

type ComputedInvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'

function invitationStatus(inv: InvitationDTO, now: number): ComputedInvitationStatus {
  if (inv.revokedAt) return 'REVOKED'
  if (inv.acceptedAt) return 'ACCEPTED'
  if (new Date(inv.expiresAt).getTime() <= now) return 'EXPIRED'
  return 'PENDING'
}

function invitationStatusBadgeClass(status: ComputedInvitationStatus): string {
  switch (status) {
    case 'PENDING': return 'border-gold/40 bg-gold/10 text-gold'
    case 'ACCEPTED': return 'border-success/40 bg-success/10 text-success'
    case 'REVOKED':
    case 'EXPIRED': return 'border-border bg-elevated text-muted-foreground'
  }
}

function InvitationsPanel({ orgId, enabled, onChanged }: { orgId: string; enabled: boolean; onChanged: () => void }) {
  const [invitations, setInvitations] = useState<OrgInvitationsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<InvitationDTO | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setInvitations(null)
    api.organizationInvitations(orgId)
      .then(res => { setInvitations(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load invitations.'))
  }, [orgId])

  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [enabled, load])

  const revoke = async () => {
    if (!revokeTarget) return
    setBusyId(revokeTarget.id)
    try {
      await api.revokeInvitation(orgId, revokeTarget.id)
      toast({ title: 'Invitation revoked — its link no longer works.' })
      setRevokeTarget(null)
      load()
      onChanged()
    } catch (e) {
      toast({ title: 'Could not revoke', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  if (!enabled) return null

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <MailWarning className="h-4 w-4 text-gold" aria-hidden />
          <h3 className="font-display text-base font-semibold text-foreground">Invitations</h3>
        </div>
        <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreateOpen(true)}>
          <UserPlus className="mr-2 h-3.5 w-3.5" aria-hidden /> Create invitation
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Links only — there is no email delivery. Share the link yourself; it can be used before it expires or until its
        use limit is reached, and can be revoked at any time. Invitations can never grant owner or administrator roles.
      </p>

      {failed ? (
        <div className="mt-4">
          <EmptyState icon={MailWarning} title="Could not load invitations" description={failed} actionLabel="Try again" onAction={load} />
        </div>
      ) : !invitations ? (
        <div className="flex min-h-[12vh] items-center justify-center" role="status" aria-label="Loading invitations"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : invitations.invitations.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-muted-foreground">No invitations yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {invitations.invitations.map(inv => {
            const status = invitationStatus(inv, Date.now())
            return (
              <li key={inv.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">
                    {inv.email ? <span className="font-medium">{inv.email}</span> : 'Anyone with the link'}
                    <span className="text-muted-foreground"> · {inv.intendedRole.toLowerCase()}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Created {formatClassLocal(inv.createdAt)} · expires {formatClassLocal(inv.expiresAt)}
                    {inv.maxUses !== null ? ` · ${inv.useCount}/${inv.maxUses} uses` : ` · ${inv.useCount} use${inv.useCount === 1 ? '' : 's'}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={invitationStatusBadgeClass(status)}>{status.toLowerCase()}</Badge>
                  {status === 'PENDING' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={busyId === inv.id}
                      onClick={() => setRevokeTarget(inv)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <CreateInvitationDialog
        open={createOpen}
        orgId={orgId}
        onOpenChange={o => { setCreateOpen(o); if (!o) load() }}
      />

      <AlertDialog open={!!revokeTarget} onOpenChange={o => !o && setRevokeTarget(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Revoke this invitation?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              The link stops working immediately. Anyone who already joined keeps their membership — revoke their
              membership separately if needed. This action is audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={e => { e.preventDefault(); void revoke() }}
            >
              {busyId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Revoke invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

const INVITATION_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'INSTRUCTOR', label: 'Instructor' },
  { value: 'STAFF', label: 'Staff' },
  { value: 'LEARNER', label: 'Learner' },
  { value: 'CAREER_COORDINATOR', label: 'Career coordinator' },
  { value: 'RECRUITER', label: 'Recruiter (employer orgs)' },
]

function CreateInvitationDialog({ open, orgId, onOpenChange }: { open: boolean; orgId: string; onOpenChange: (open: boolean) => void }) {
  const [email, setEmail] = useState('')
  const [intendedRole, setIntendedRole] = useState('LEARNER')
  const [ttlDays, setTtlDays] = useState('14')
  const [maxUses, setMaxUses] = useState('20')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Shown ONCE, right after creation — never stored anywhere else.
  const [issuedLink, setIssuedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const close = () => {
    setIssuedLink(null)
    setCopied(false)
    setEmail('')
    setError(null)
    onOpenChange(false)
  }

  const submit = async () => {
    setError(null)
    const emailTrimmed = email.trim()
    if (emailTrimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setError('Enter a valid email, or leave it empty for a link anyone can use.')
      return
    }
    const ttl = Number.parseInt(ttlDays, 10)
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 90) {
      setError('Link validity must be between 1 and 90 days.')
      return
    }
    const uses = maxUses.trim() ? Number.parseInt(maxUses, 10) : null
    if (uses !== null && (!Number.isInteger(uses) || uses < 1 || uses > 200)) {
      setError('Use limit must be between 1 and 200, or empty for unlimited.')
      return
    }
    setBusy(true)
    try {
      const res = await api.createInvitation(orgId, {
        email: emailTrimmed || undefined,
        intendedRole,
        ttlDays: ttl,
        maxUses: uses ?? undefined,
      })
      const rawToken = res.invitation.rawToken
      if (rawToken) {
        setIssuedLink(`${window.location.origin}#/institution?invite=${rawToken}`)
      }
      toast({ title: 'Invitation created — copy the link now.' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!issuedLink) return
    try {
      await navigator.clipboard.writeText(issuedLink)
      setCopied(true)
      toast({ title: 'Link copied to clipboard' })
    } catch {
      setError('Clipboard unavailable — select the link text and copy it manually.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => (!busy && !issuedLink ? onOpenChange(o) : issuedLink ? close() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Create an invitation</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Invitations can never grant owner or administrator roles. The link is shown once — there is no email.
          </DialogDescription>
        </DialogHeader>

        {issuedLink ? (
          <div className="grid gap-3">
            <div className="rounded-lg border border-gold/40 bg-gold/10 p-3">
              <p className="text-sm font-medium text-gold">This link is shown only once — copy it now.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                If you lose it before sharing, revoke this invitation and create a new one. The token is stored hashed — BEAN can never show it again.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={issuedLink} aria-label="Invitation link" className="font-mono text-xs" onFocus={e => e.target.select()} />
              <Button className="bg-gold text-primary-foreground hover:bg-gold-hover sm:w-fit" onClick={() => void copyLink()}>
                <Copy className="mr-2 h-4 w-4" aria-hidden /> {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="inv-email">Email (optional)</Label>
                <Input id="inv-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Leave empty for a link anyone can use" />
                <p className="text-xs text-muted-foreground">When set, only an account with this email can accept the invitation.</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="inv-role">Role they will join as</Label>
                <Select value={intendedRole} onValueChange={setIntendedRole}>
                  <SelectTrigger id="inv-role" aria-label="Intended role"><SelectValue /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {INVITATION_ROLE_OPTIONS.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="inv-ttl">Link validity (days)</Label>
                  <Input id="inv-ttl" type="number" min={1} max={90} value={ttlDays} onChange={e => setTtlDays(e.target.value)} className="[color-scheme:dark]" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="inv-uses">Use limit (optional)</Label>
                  <Input id="inv-uses" type="number" min={1} max={200} value={maxUses} onChange={e => setMaxUses(e.target.value)} placeholder="20" className="[color-scheme:dark]" />
                  <p className="text-xs text-muted-foreground">Empty = unlimited uses until expiry.</p>
                </div>
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

// ─── Members — credential issuance (institution staff, non-employer) ─────────
// Staff issue credentials to ACTIVE members from this dialog. The credential
// then lives on the student's career portfolio — the members API does not
// expose issued credentials, so this panel never pretends to list them.

function IssueCredentialCard({
  orgId,
  enabled,
  members,
  onChanged,
}: {
  orgId: string
  enabled: boolean
  members: MemberDTO[] | null
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [studentId, setStudentId] = useState('')
  const [credentialName, setCredentialName] = useState('')
  const [credentialDescription, setCredentialDescription] = useState('')
  const [issuedDate, setIssuedDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [credentialReference, setCredentialReference] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      const today = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      setIssuedDate(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`)
    }, 0)
    return () => clearTimeout(t)
  }, [open])

  if (!enabled) return null

  const activeMembers = (members ?? []).filter(m => m.status === 'ACTIVE')

  const issue = async () => {
    setBusy(true)
    try {
      await api.issueCredential({
        organizationId: orgId,
        studentId,
        credentialName: credentialName.trim(),
        credentialDescription: credentialDescription.trim() || undefined,
        issuedDate: new Date(`${issuedDate}T00:00:00`).toISOString(),
        expiryDate: expiryDate ? new Date(`${expiryDate}T00:00:00`).toISOString() : undefined,
        credentialReference: credentialReference.trim() || undefined,
      })
      toast({ title: 'Credential issued — it now appears on the student\u2019s portfolio.' })
      setConfirmOpen(false)
      setOpen(false)
      setStudentId('')
      setCredentialName('')
      setCredentialDescription('')
      setExpiryDate('')
      setCredentialReference('')
      onChanged()
    } catch (e) {
      toast({ title: 'Could not issue the credential', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const valid = studentId && credentialName.trim().length >= 4 && issuedDate

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-gold" aria-hidden />
          <h3 className="font-display text-base font-semibold text-foreground">Issue a credential</h3>
        </div>
        <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={!members} onClick={() => setOpen(true)}>
          <Award className="mr-2 h-3.5 w-3.5" aria-hidden /> Issue credential
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Issued credentials appear on the student&apos;s career portfolio (with institution attribution) — they are not
        listed here because member rosters never expose another student&apos;s portfolio data. Revocation happens from
        the credential record with a written, audited reason.
      </p>

      <Dialog
        open={open}
        onOpenChange={o => {
          if (!o) setOpen(false)
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Issue a credential</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Recorded against this organization — students see it on their portfolio with issuer attribution.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="cred-member">Member</Label>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger id="cred-member" aria-label="Credential recipient"><SelectValue placeholder="Select an active member" /></SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {activeMembers.map(m => (
                    <SelectItem key={m.id} value={m.studentId}>{m.student.displayName || 'Member'} ({m.role.toLowerCase()})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cred-name">Credential name</Label>
              <Input id="cred-name" value={credentialName} onChange={e => setCredentialName(e.target.value)} maxLength={160} placeholder="e.g. CA Inter — Batch A completion" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cred-desc">Description (optional)</Label>
              <Textarea id="cred-desc" rows={2} value={credentialDescription} onChange={e => setCredentialDescription(e.target.value)} maxLength={1000} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="cred-issued">Issued on</Label>
                <Input id="cred-issued" type="date" value={issuedDate} onChange={e => setIssuedDate(e.target.value)} className="[color-scheme:dark]" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cred-expiry">Expires (optional)</Label>
                <Input id="cred-expiry" type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className="[color-scheme:dark]" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cred-ref">Reference (optional)</Label>
              <Input id="cred-ref" value={credentialReference} onChange={e => setCredentialReference(e.target.value)} maxLength={200} placeholder="e.g. certificate serial number" />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={!valid || busy} onClick={() => { setError(null); setConfirmOpen(true) }}>
              Review and issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Issue this credential?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              &ldquo;{credentialName.trim()}&rdquo; will be recorded on the selected member&apos;s portfolio under this
              organization&apos;s name. Issuance is audited and the credential can later be revoked only with a written reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated" disabled={busy}>Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-gold text-primary-foreground hover:bg-gold-hover"
              onClick={e => { e.preventDefault(); void issue() }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Issue credential
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ─── Groups & batches ────────────────────────────────────────────────────────

function GroupsPanel({
  orgId,
  active,
  viewerRole,
}: {
  orgId: string
  active: boolean
  viewerRole: string
}) {
  const [groups, setGroups] = useState<GroupDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [enrollGroup, setEnrollGroup] = useState<GroupDTO | null>(null)
  const [editGroup, setEditGroup] = useState<GroupDTO | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<GroupDTO | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const canManage = active && isStaffRole(viewerRole)

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

  const archive = async () => {
    if (!archiveTarget) return
    setBusyId(archiveTarget.id)
    try {
      await api.updateOrganizationGroup(orgId, archiveTarget.id, { status: 'ARCHIVED' })
      toast({ title: 'Group archived — it is hidden from active lists; history is preserved.' })
      setArchiveTarget(null)
      load()
    } catch (e) {
      toast({ title: 'Could not archive the group', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Batches, sections and cohorts — learners are enrolled into groups by instructors.</p>
        {canManage ? (
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
                <Badge variant="outline" className={g.status === 'ACTIVE' ? 'border-border text-muted-foreground' : 'border-gold/40 bg-gold/10 text-gold'}>{g.status.toLowerCase()}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                {g.programmeLabel ? <span><span className="text-gold">Programme:</span> {g.programmeLabel}</span> : null}
                {g.academicYear ? <span><span className="text-gold">Year:</span> {g.academicYear}</span> : null}
                {g.batchLabel ? <span><span className="text-gold">Batch:</span> {g.batchLabel}</span> : null}
                {g.sectionLabel ? <span><span className="text-gold">Section:</span> {g.sectionLabel}</span> : null}
                {g.trackLabel ? <span><span className="text-gold">Track:</span> {g.trackLabel}</span> : null}
                <span><span className="text-gold">Enrolled:</span> {g.activeEnrollmentCount}{g.capacity ? ` / ${g.capacity}` : ''}</span>
              </div>
              {canManage ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-gold/40 text-gold hover:bg-gold/10"
                    onClick={() => setEnrollGroup(g)}
                    aria-label={`Manage members of ${g.name}`}
                  >
                    <UserPlus className="mr-2 h-3.5 w-3.5" aria-hidden /> Enroll member
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-border text-muted-foreground hover:bg-elevated"
                    onClick={() => setEditGroup(g)}
                    aria-label={`Edit ${g.name}`}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit
                  </Button>
                  {g.status === 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground"
                      disabled={busyId === g.id}
                      onClick={() => setArchiveTarget(g)}
                      aria-label={`Archive ${g.name}`}
                    >
                      <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Archive
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {canManage ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Roster note: the API exposes the enrolled count per group, not the roster itself — enroll members here, and
          students leave groups themselves (self-serve, history preserved). Staff-initiated member removal is not
          available yet, so it is not shown here rather than faked.
        </p>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Your instructors manage group enrollment. Leaving a group from here is not offered yet because this list does
          not expose which groups you are personally enrolled in — ask your instructor rather than guessing.
        </p>
      )}

      <CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} orgId={orgId} onCreated={() => { setCreateOpen(false); load() }} />
      <EnrollMemberDialog group={enrollGroup} orgId={orgId} onOpenChange={o => !o && setEnrollGroup(null)} />
      <EditGroupDialog
        group={editGroup}
        orgId={orgId}
        onOpenChange={o => !o && setEditGroup(null)}
        onSaved={() => { setEditGroup(null); load() }}
      />

      <AlertDialog open={!!archiveTarget} onOpenChange={o => !o && setArchiveTarget(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Archive “{archiveTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Archived groups disappear from active lists (the dashboard counts only active groups). All enrollments,
              assignments and history are preserved, and the group can be re-activated later from its edit dialog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-gold text-primary-foreground hover:bg-gold-hover"
              onClick={e => { e.preventDefault(); void archive() }}
            >
              {busyId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Archive group
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EditGroupDialog({
  group,
  orgId,
  onOpenChange,
  onSaved,
}: {
  group: GroupDTO | null
  orgId: string
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [programmeLabel, setProgrammeLabel] = useState('')
  const [academicYear, setAcademicYear] = useState('')
  const [batchLabel, setBatchLabel] = useState('')
  const [sectionLabel, setSectionLabel] = useState('')
  const [trackLabel, setTrackLabel] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync from the group row whenever a new edit target is chosen.
  useEffect(() => {
    if (!group) return
    const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
    setName(group.name)
    setProgrammeLabel(group.programmeLabel ?? '')
    setAcademicYear(group.academicYear ?? '')
    setBatchLabel(group.batchLabel ?? '')
    setSectionLabel(group.sectionLabel ?? '')
    setTrackLabel(group.trackLabel ?? '')
    setStartsAt(toDateInput(group.startsAt))
    setEndsAt(toDateInput(group.endsAt))
    setCapacity(group.capacity !== null ? String(group.capacity) : '')
    setError(null)
  }, [group])

  const save = async () => {
    if (!group) return
    setError(null)
    if (name.trim().length < 2) { setError('Give the group a name.'); return }
    setBusy(true)
    try {
      const toIso = (value: string) => (value ? new Date(`${value}T00:00:00`).toISOString() : null)
      await api.updateOrganizationGroup(orgId, group.id, {
        name: name.trim(),
        programmeLabel: programmeLabel.trim(),
        academicYear: academicYear.trim(),
        batchLabel: batchLabel.trim(),
        sectionLabel: sectionLabel.trim(),
        trackLabel: trackLabel.trim(),
        startsAt: startsAt ? toIso(startsAt) : null,
        endsAt: endsAt ? toIso(endsAt) : null,
        capacity: capacity.trim() ? Number(capacity) : null,
      })
      toast({ title: 'Group updated' })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!group} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Edit “{group?.name}”</DialogTitle>
          <DialogDescription className="text-muted-foreground">Labels and dates organize the roster; capacity guards over-enrollment.</DialogDescription>
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
              <Input id="eg-year" value={academicYear} onChange={e => setAcademicYear(e.target.value)} maxLength={40} />
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
              <Input id="eg-capacity" type="number" min={1} max={2000} value={capacity} onChange={e => setCapacity(e.target.value)} className="[color-scheme:dark]" />
              <p className="text-xs text-muted-foreground">Clear to remove the limit.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="eg-starts">Starts (optional)</Label>
              <Input id="eg-starts" type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="[color-scheme:dark]" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="eg-ends">Ends (optional)</Label>
              <Input id="eg-ends" type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} className="[color-scheme:dark]" />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={save}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function ClassesPanel({ orgId, viewerRole }: { orgId: string; viewerRole: string }) {
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

      {isStaffRole(viewerRole) ? <TeachDashboardCta /> : null}
    </div>
  )
}

/** Honest CTA: staff learn where institution classes come from — only shown
 *  when the viewer holds a staff role; eligibility is still checked on the
 *  server (the teaching dashboard gates itself on an approved teacher profile). */
function TeachDashboardCta() {
  const navigate = useAppStore(s => s.navigate)
  const [teacherStatus, setTeacherStatus] = useState<'loading' | 'approved' | 'other'>('loading')

  useEffect(() => {
    let cancelled = false
    api.teachApplication()
      .then(res => { if (!cancelled) setTeacherStatus(res.application?.status === 'APPROVED' ? 'approved' : 'other') })
      .catch(() => { if (!cancelled) setTeacherStatus('other') })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-base font-semibold text-foreground">How institution classes get created</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Institution classes are created by eligible instructors from the teaching dashboard — pick the organization
            or group audience there, and the class appears here for your members.
          </p>
          {teacherStatus === 'other' ? (
            <p className="mt-1 text-xs text-muted-foreground">
              You currently have no approved BEAN Teach teacher profile, so the dashboard will show the application flow first.
            </p>
          ) : null}
        </div>
        <Button
          className="shrink-0 bg-gold text-primary-foreground hover:bg-gold-hover"
          disabled={teacherStatus === 'loading'}
          onClick={() => navigate({ view: 'teach-dashboard' })}
        >
          {teacherStatus === 'loading' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <GraduationCap className="mr-2 h-4 w-4" aria-hidden />}
          Open teaching dashboard
        </Button>
      </div>
    </div>
  )
}

// ─── Assignments ─────────────────────────────────────────────────────────────

function AssignmentsPanel({
  orgId,
  isAdmin,
  active,
  viewerRole,
  onChanged,
}: {
  orgId: string
  isAdmin: boolean
  active: boolean
  groupsReady: boolean
  viewerRole: string
  onChanged: () => void
}) {
  const [data, setData] = useState<AssignmentDTO[] | null>(null)
  const [viewerRoleLoaded, setViewerRoleLoaded] = useState<string>('')
  const [failed, setFailed] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<AssignmentDetailResponse | null>(null)
  const [editTarget, setEditTarget] = useState<AssignmentDTO | null>(null)
  const [statusTarget, setStatusTarget] = useState<{ assignment: AssignmentDTO; status: 'PUBLISHED' | 'CLOSED' | 'ARCHIVED' } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setData(null)
    api.organizationAssignments(orgId)
      .then(res => { setData(res.assignments); setViewerRoleLoaded(res.viewerRole); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load assignments.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const isStaff = isStaffRole(viewerRoleLoaded)

  const applyStatus = async () => {
    if (!statusTarget) return
    setBusyId(statusTarget.assignment.id)
    try {
      await api.updateAssignment(statusTarget.assignment.id, { status: statusTarget.status })
      toast({ title: statusCopy(statusTarget.status).toast })
      setStatusTarget(null)
      load()
      onChanged()
    } catch (e) {
      toast({ title: 'Could not update the assignment', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

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
          {data.map(a => {
            const busy = busyId === a.id
            return (
              <div key={a.id} className="rounded-xl border border-border bg-card p-4">
                <button
                  type="button"
                  className="exam-card-hover flex w-full flex-col rounded-lg text-left transition-colors hover:border-gold/40"
                  onClick={() => { api.assignmentDetail(a.id).then(setDetail).catch(e => toast({ title: 'Could not open assignment', description: e instanceof Error ? e.message : '', variant: 'destructive' })) }}
                  aria-label={`Open assignment: ${a.title}`}
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
                {isStaff && active ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                    {a.status === 'DRAFT' ? (
                      <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={() => setStatusTarget({ assignment: a, status: 'PUBLISHED' })}>
                        <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Publish
                      </Button>
                    ) : null}
                    {a.status === 'PUBLISHED' ? (
                      <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setStatusTarget({ assignment: a, status: 'CLOSED' })}>
                        <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Close
                      </Button>
                    ) : null}
                    {a.status === 'CLOSED' ? (
                      <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setStatusTarget({ assignment: a, status: 'ARCHIVED' })}>
                        <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Archive
                      </Button>
                    ) : null}
                    {a.status === 'DRAFT' || a.status === 'PUBLISHED' ? (
                      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => setEditTarget(a)}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <CreateAssignmentDialog open={createOpen} onOpenChange={setCreateOpen} orgId={orgId} onCreated={() => { setCreateOpen(false); load(); onChanged() }} />
      <EditAssignmentDialog
        target={editTarget}
        onClose={() => { setEditTarget(null); load(); onChanged() }}
      />
      <AssignmentDetailDialog detail={detail} isStaff={isStaff} onClose={() => { setDetail(null); load() }} />

      <AlertDialog open={!!statusTarget} onOpenChange={o => !o && setStatusTarget(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">
              {statusTarget ? statusCopy(statusTarget.status).title : ''}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {statusTarget
                ? `${statusCopy(statusTarget.status).detail} This transition is one-way and audited.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={statusTarget?.status === 'ARCHIVED' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
              onClick={e => { e.preventDefault(); void applyStatus() }}
            >
              {busyId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function statusCopy(status: 'PUBLISHED' | 'CLOSED' | 'ARCHIVED'): { title: string; detail: string; toast: string } {
  switch (status) {
    case 'PUBLISHED':
      return {
        title: 'Publish this assignment?',
        detail: 'Enrolled learners in the group will see it immediately and can start submitting work.',
        toast: 'Assignment published to the group',
      }
    case 'CLOSED':
      return {
        title: 'Close this assignment?',
        detail: 'Learners can no longer submit new work. Existing submissions and grades remain visible to permitted staff.',
        toast: 'Assignment closed — submissions are no longer accepted',
      }
    case 'ARCHIVED':
      return {
        title: 'Archive this assignment?',
        detail: 'Archived assignments are removed from learner lists but every submission and grade record is retained.',
        toast: 'Assignment archived',
      }
  }
}

function EditAssignmentDialog({ target, onClose }: { target: AssignmentDTO | null; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [maxScore, setMaxScore] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    const pad = (n: number) => String(n).padStart(2, '0')
    const d = target.dueAt ? new Date(target.dueAt) : null
    setTitle(target.title)
    setInstructions(target.instructions ?? '')
    setDueAt(d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` : '')
    setMaxScore(target.maxScore !== null ? String(target.maxScore) : '')
    setError(null)
  }, [target])

  const save = async () => {
    if (!target) return
    setError(null)
    if (title.trim().length < 4) { setError('Give the assignment a title (4+ characters).'); return }
    setBusy(true)
    try {
      await api.updateAssignment(target.id, {
        title: title.trim(),
        instructions: instructions.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        maxScore: maxScore.trim() ? Number(maxScore) : null,
      })
      toast({ title: 'Assignment updated' })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={o => !busy && !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Edit assignment</DialogTitle>
          <DialogDescription className="text-muted-foreground">Learners see the updated details immediately while the assignment is published.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ea-title">Title</Label>
            <Input id="ea-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ea-instructions">Instructions</Label>
            <Textarea id="ea-instructions" rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={4000} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ea-due">Due (optional)</Label>
              <Input id="ea-due" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} className="[color-scheme:dark]" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ea-max">Max score (optional)</Label>
              <Input id="ea-max" type="number" min={1} max={1000} value={maxScore} onChange={e => setMaxScore(e.target.value)} className="[color-scheme:dark]" />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={save}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function ResourcesPanel({ orgId, isAdmin, active, viewerRole }: { orgId: string; isAdmin: boolean; active: boolean; viewerRole: string }) {
  const [data, setData] = useState<OrgResourcesResponse | null>(null)
  const [groups, setGroups] = useState<GroupDTO[]>([])
  const [failed, setFailed] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [groupId, setGroupId] = useState('all')
  const [busy, setBusy] = useState(false)
  const canShare = active && isStaffRole(viewerRole) && (isAdmin || viewerRole === 'INSTRUCTOR')

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

  // Group targets are only needed for the share form.
  useEffect(() => {
    if (!canShare) return
    const t = setTimeout(() => {
      api.organizationGroups(orgId).then(res => setGroups(res.groups.filter(g => g.status === 'ACTIVE'))).catch(() => setGroups([]))
    }, 0)
    return () => clearTimeout(t)
  }, [canShare, orgId])

  const share = async () => {
    setBusy(true)
    try {
      await api.createResource(orgId, {
        title: title.trim(),
        description: description.trim() || undefined,
        url: url.trim(),
        groupId: groupId !== 'all' ? groupId : undefined,
      })
      toast({ title: groupId !== 'all' ? 'Resource shared with the selected group' : 'Resource shared with the whole organization' })
      setTitle(''); setDescription(''); setUrl(''); setGroupId('all')
      load()
    } catch (e) {
      toast({ title: 'Could not share', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const groupName = (id: string | null) => (id ? groups.find(g => g.id === id)?.name ?? null : null)

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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{r.title}</p>
                  <Badge variant="outline" className={r.groupId ? 'border-gold/40 text-gold' : 'border-border text-muted-foreground'}>
                    {r.groupId ? `group: ${groupName(r.groupId) ?? 'unknown group'}` : 'organization-wide'}
                  </Badge>
                </div>
                {r.description ? <p className="mt-1 text-xs text-muted-foreground">{r.description}</p> : null}
                <a href={r.url} target="_blank" rel="noreferrer noopener" className="mt-1 block break-all text-xs text-gold underline-offset-4 hover:underline">
                  {r.url}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {canShare ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-display text-sm font-semibold text-foreground">Share a resource</h3>
          <div className="mt-3 grid gap-3">
            <Input aria-label="Resource title" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} />
            <Input aria-label="Resource description" placeholder="Short description (optional)" value={description} onChange={e => setDescription(e.target.value)} maxLength={600} />
            <Input aria-label="Resource URL" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} />
            <div className="grid gap-1.5">
              <Label htmlFor="res-audience">Audience</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger id="res-audience" aria-label="Resource audience">
                  <SelectValue placeholder="Organization-wide" />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  <SelectItem value="all">Organization-wide (all members)</SelectItem>
                  {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover sm:w-fit" disabled={busy || !title.trim() || !url.trim()} onClick={share}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Share resource
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ReportsPanel({ dash, onRefresh }: { dash: OrgDashboardResponse; onRefresh: () => void }) {
  const [groups, setGroups] = useState<GroupDTO[] | null>(null)
  const [groupsFailed, setGroupsFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const loadGroups = useCallback(() => {
    setGroups(null)
    setGroupsFailed(false)
    api.organizationGroups(dash.organization.id)
      .then(res => setGroups(res.groups))
      .catch(() => setGroupsFailed(true))
  }, [dash.organization.id])

  useEffect(() => {
    const t = setTimeout(loadGroups, 0)
    return () => clearTimeout(t)
  }, [loadGroups])

  const refreshAll = () => {
    setRefreshing(true)
    // Re-fetch both sources this panel shows: the dashboard aggregates (via
    // the parent) and the per-group table (here).
    loadGroups()
    onRefresh()
    setTimeout(() => setRefreshing(false), 600)
  }

  const stats = [
    { label: 'Active members', value: dash.overview.activeMembers },
    { label: 'Pending member approvals', value: dash.overview.pendingMembers },
    { label: 'Active groups', value: dash.overview.activeGroups },
    { label: 'Upcoming classes', value: dash.overview.upcomingClasses },
    { label: 'Published assignments', value: dash.overview.publishedAssignments },
    { label: 'Submissions awaiting grading', value: dash.overview.openSubmissions },
    { label: 'Active announcements', value: dash.overview.activeAnnouncements },
  ]
  const unavailable = ['Grading completion rate', 'Attendance rate', 'Enrollment retention']

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-foreground">Institution activity</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Every figure derives from this organization&apos;s own activity. Personal learning data — Riishe conversations,
              documents, goals, notes and unrelated exam attempts — is never included, for any member.
            </p>
          </div>
          <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" disabled={refreshing} onClick={refreshAll}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5${refreshing ? ' animate-spin' : ''}`} aria-hidden /> Refresh
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {stats.map(s => (
            <div key={s.label} className="rounded-xl border border-border bg-elevated p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 font-display text-2xl font-semibold text-gold">{s.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Not available yet:</span>
          {unavailable.map(label => (
            <Badge key={label} variant="outline" className="border-border bg-elevated text-muted-foreground">{label} — not available yet</Badge>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-display text-base font-semibold text-foreground">Groups</h3>
        <p className="mt-1 text-xs text-muted-foreground">Live per-group view — name, enrolled members and status.</p>
        {groupsFailed ? (
          <div className="mt-3">
            <EmptyState icon={Users} title="Could not load groups" description="Group detail could not be loaded right now." actionLabel="Try again" onAction={loadGroups} />
          </div>
        ) : !groups ? (
          <div className="flex min-h-[12vh] items-center justify-center" role="status" aria-label="Loading group report"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : groups.length === 0 ? (
          <p className="mt-3 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-muted-foreground">No groups yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Group</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Enrolled</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 font-medium">Capacity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups.map(g => (
                  <tr key={g.id}>
                    <td className="py-2.5 pr-4 text-foreground">{g.name}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{g.activeEnrollmentCount}</td>
                    <td className="py-2.5 pr-4">
                      <Badge variant="outline" className={g.status === 'ACTIVE' ? 'border-success/40 text-success' : 'border-gold/40 bg-gold/10 text-gold'}>{g.status.toLowerCase()}</Badge>
                    </td>
                    <td className="py-2.5 text-muted-foreground">{g.capacity ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
  const [groups, setGroups] = useState<GroupDTO[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [groupId, setGroupId] = useState('all')
  const [expiresAt, setExpiresAt] = useState('')
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

  // Group targets for the composer (admin only).
  useEffect(() => {
    if (!isAdmin || !active) return
    const t = setTimeout(() => {
      api.organizationGroups(orgId).then(res => setGroups(res.groups.filter(g => g.status === 'ACTIVE'))).catch(() => setGroups([]))
    }, 0)
    return () => clearTimeout(t)
  }, [isAdmin, active, orgId])

  const publish = async () => {
    setBusy(true)
    try {
      await api.createAnnouncement(orgId, {
        title: title.trim(),
        body: body.trim(),
        groupId: groupId !== 'all' ? groupId : undefined,
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
      })
      toast({ title: groupId !== 'all' ? 'Announcement published to the selected group' : 'Announcement published' })
      setTitle(''); setBody(''); setGroupId('all'); setExpiresAt('')
      load()
    } catch (e) {
      toast({ title: 'Could not publish', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const groupName = (id: string | null) => (id ? groups.find(g => g.id === id)?.name ?? null : null)

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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{a.title}</p>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={a.groupId ? 'border-gold/40 text-gold' : 'border-border text-muted-foreground'}>
                    {a.groupId ? `group: ${groupName(a.groupId) ?? 'unknown group'}` : 'organization-wide'}
                  </Badge>
                  {a.expiresAt ? (
                    <Badge variant="outline" className="border-border text-muted-foreground">expires {formatClassLocal(a.expiresAt)}</Badge>
                  ) : null}
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
              {a.publishedAt ? <p className="mt-1 text-xs text-muted-foreground">{formatClassLocal(a.publishedAt)}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {isAdmin && active ? (
        <div className="mt-4 grid gap-3 border-t border-border pt-4">
          <Input aria-label="Announcement title" placeholder="Announcement title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} />
          <Textarea aria-label="Announcement body" rows={2} placeholder="What should members know?" value={body} onChange={e => setBody(e.target.value)} maxLength={5000} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ann-audience">Audience</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger id="ann-audience" aria-label="Announcement audience">
                  <SelectValue placeholder="Organization-wide" />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  <SelectItem value="all">Organization-wide (all members)</SelectItem>
                  {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ann-expiry">Expires (optional)</Label>
              <Input id="ann-expiry" type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="[color-scheme:dark]" />
            </div>
          </div>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover sm:w-fit" disabled={busy || !title.trim() || body.trim().length < 10} onClick={publish}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Publish announcement
          </Button>
        </div>
      ) : null}
    </div>
  )
}

'use client'

// ─── Phase 7 — Institution hub (#/institution) ───────────────────────────────
// Lists every organization the signed-in student belongs to (with their own
// membership role/status), offers registration of a new organization, and the
// copy-link invitation redemption flow. Guests get a sign-in gate — creating
// or joining an organization is never available in guest mode.
//
// Integrity notes:
//   • The verification badge is truthful: "Identity reviewed by BEAN" for
//     APPROVED orgs, and explicit pending/unverified labels otherwise. BEAN
//     verification never claims government recognition or accreditation.
//   • Invitation tokens are redeemed server-side; the raw token is pasted by
//     the student and never stored in app state beyond the dialog.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { MyOrganizationsResponse, PublicOrganizationDTO } from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { Building2, Copy, Loader2, LogIn, Plus, ShieldCheck, Users } from 'lucide-react'

const ORG_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'SCHOOL', label: 'School' },
  { value: 'COLLEGE', label: 'College' },
  { value: 'UNIVERSITY', label: 'University' },
  { value: 'COACHING_CENTRE', label: 'Coaching centre' },
  { value: 'PROFESSIONAL_INSTITUTE', label: 'Professional institute (CA/CMA/CS…)' },
  { value: 'SKILL_PROVIDER', label: 'Skill development / vocational provider' },
  { value: 'EMPLOYER', label: 'Employer organization' },
  { value: 'OTHER', label: 'Other' },
]

export function verificationBadgeClass(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'border-success/40 bg-success/10 text-success'
    case 'PENDING_REVIEW':
      return 'border-gold/40 bg-gold/10 text-gold'
    case 'REJECTED':
    case 'SUSPENDED':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    default:
      return 'border-border bg-elevated text-muted-foreground'
  }
}

export function verificationLabel(status: string): string {
  switch (status) {
    case 'APPROVED':
      return 'Identity reviewed by BEAN'
    case 'PENDING_REVIEW':
      return 'Verification pending'
    case 'REJECTED':
      return 'Verification declined'
    case 'SUSPENDED':
      return 'Suspended'
    default:
      return 'Not verified yet'
  }
}

export function InstitutionView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [data, setData] = useState<MyOrganizationsResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)

  const load = useCallback(() => {
    setData(null)
    api.myOrganizations()
      .then(res => { setData(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your organizations.'))
  }, [])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

  if (!authChecked) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading institution workspace">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState
          icon={LogIn}
          title="Institutions sign in first"
          description="Register an organization, manage members, batches and classes after signing in."
          actionLabel="Sign in"
          onAction={() => navigate({ view: 'auth' })}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Institution</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Your organizations</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Run your institution on BEAN: members, batches, private classes, assignments and learning resources — with
            roles scoped to each organization.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setJoinOpen(true)}>
            <Users className="mr-2 h-4 w-4" aria-hidden /> Join with invitation
          </Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden /> Register organization
          </Button>
        </div>
      </div>

      <div className="mt-8">
        {failed ? (
          <EmptyState icon={Building2} title="Could not load your organizations" description={failed} actionLabel="Try again" onAction={load} />
        ) : !data ? (
          <div className="flex min-h-[30vh] items-center justify-center" role="status" aria-label="Loading organizations">
            <Loader2 className="h-6 w-6 animate-spin text-gold" />
          </div>
        ) : data.organizations.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No organizations yet"
            description="Register your institution, or redeem an invitation link you received from its administrators."
            actionLabel="Register organization"
            onAction={() => setCreateOpen(true)}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.organizations.map(({ organization, membership }) => (
              <button
                key={organization.id}
                type="button"
                className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
                onClick={() => navigate({ view: 'institution-org', orgId: organization.id })}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 text-lg" aria-hidden>
                      {organization.logoText || '🏛'}
                    </span>
                    <div>
                      <h2 className="font-display text-base font-semibold text-foreground">
                        {organization.displayName || organization.name}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {ORG_TYPE_OPTIONS.find(t => t.value === organization.orgType)?.label ?? organization.orgType}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className={verificationBadgeClass(organization.verificationStatus)}>
                    {organization.verificationStatus === 'APPROVED' && <ShieldCheck className="mr-1 h-3 w-3" aria-hidden />}
                    {verificationLabel(organization.verificationStatus)}
                  </Badge>
                </div>
                {organization.description ? (
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{organization.description}</p>
                ) : null}
                <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    You: {membership.role.toLowerCase()}
                  </Badge>
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    {membership.status.toLowerCase()}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={orgId => {
          setCreateOpen(false)
          load()
          navigate({ view: 'institution-org', orgId })
        }}
      />
      <JoinInvitationDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onJoined={() => {
          setJoinOpen(false)
          load()
        }}
      />
    </div>
  )
}

function CreateOrganizationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (orgId: string) => void
}) {
  const [name, setName] = useState('')
  const [orgType, setOrgType] = useState('')
  const [description, setDescription] = useState('')
  const [website, setWebsite] = useState('')
  const [city, setCity] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (name.trim().length < 4 || !orgType) {
      setError('Choose an organization type and give the official name (at least 4 characters).')
      return
    }
    setBusy(true)
    try {
      const res = await api.createOrganization({
        name: name.trim(),
        orgType,
        description: description.trim() || undefined,
        website: website.trim() || undefined,
        city: city.trim() || undefined,
      })
      toast({ title: 'Organization registered — submit it for BEAN verification to unlock the workspace.' })
      onCreated(res.organization.id)
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
          <DialogTitle className="font-display text-foreground">Register an organization</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            You become the organization&apos;s owner. BEAN administrators review every application — approval is a human
            decision, and &ldquo;verified&rdquo; means identity reviewed by BEAN, not government accreditation.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="org-name">Official name</Label>
            <Input id="org-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="Springfield College of Commerce" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="org-type">Organization type</Label>
            <Select value={orgType} onValueChange={setOrgType}>
              <SelectTrigger id="org-type" aria-label="Organization type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {ORG_TYPE_OPTIONS.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="org-desc">Description (optional)</Label>
            <Textarea id="org-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={1500} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="org-website">Website (optional)</Label>
              <Input id="org-website" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="org-city">City (optional)</Label>
              <Input id="org-city" value={city} onChange={e => setCity(e.target.value)} maxLength={80} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function JoinInvitationDialog({
  open,
  onOpenChange,
  onJoined,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onJoined: () => void
}) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (token.trim().length < 20) {
      setError('Paste the full invitation link or token you received.')
      return
    }
    setBusy(true)
    try {
      // Accept either a bare token or a full invite URL pasted by the student.
      const raw = token.trim()
      const bare = raw.includes('token=') ? raw.split('token=')[1].split('&')[0] : raw
      const res = await api.acceptInvitation(bare)
      toast({
        title:
          res.status === 'ACTIVE'
            ? `Welcome to ${res.organizationName}`
            : `Invitation accepted — ${res.organizationName} administrators will approve your ${res.role.toLowerCase()} access.`,
      })
      setToken('')
      onJoined()
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
          <DialogTitle className="font-display text-foreground">Join with an invitation</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Paste the invitation link an administrator shared with you. There is no public joining — invitations are
            personal, expiring and revocable.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="invite-token">Invitation link or token</Label>
          <div className="flex gap-2">
            <Input id="invite-token" value={token} onChange={e => setToken(e.target.value)} placeholder="bean://invite?token=… or the raw token" />
            <Button
              type="button"
              variant="outline"
              className="border-border text-muted-foreground hover:bg-elevated"
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText()
                  setToken(text)
                } catch { /* clipboard unavailable */ }
              }}
              aria-label="Paste from clipboard"
            >
              <Copy className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={submit}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Accept invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type { PublicOrganizationDTO }

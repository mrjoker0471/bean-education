'use client'

// ─── Phase 7 — Admin organizations (#/admin/organizations) ───────────────────
// The organization verification queue: institution and employer applications
// with the evidence the admin APIs actually return (owner, members, groups,
// classes, org profile) plus the append-only audit history for each org.
// Decisions are deliberate human actions — approve / reject (reason 10+ chars)
// / suspend (reason required) / reinstate — recorded server-side inside the
// decision transaction; the UI never bypasses it. Teacher trust records are
// untouched here — verification contexts stay separate by design.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { AdminOrganizationRow } from '@/lib/types'
import type { AdminOrganizationAuditResponse } from '@/lib/institution-dto'
import { toast } from '@/hooks/use-toast'
import {
  adminVerificationActionLabel,
  auditActionLabel,
  humanizeStatus,
  legalAdminVerificationActions,
  minReasonLength,
  reasonValidationError,
  type AdminVerificationAction,
} from '@/lib/employer-ui'
import { Building2, FileClock, History, Loader2, ShieldCheck } from 'lucide-react'

const STATUS_FILTERS = ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DRAFT', 'ALL']

const STATUS_BADGE: Record<string, string> = {
  APPROVED: 'border-success/40 bg-success/10 text-success',
  PENDING_REVIEW: 'border-gold/40 bg-gold/10 text-gold',
  REJECTED: 'border-destructive/40 bg-destructive/10 text-destructive',
  SUSPENDED: 'border-destructive/40 bg-destructive/10 text-destructive',
  DRAFT: 'border-border bg-elevated text-muted-foreground',
}

export function AdminOrganizationsView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const isAdmin = authedStudent?.role === 'ADMIN'

  const [status, setStatus] = useState('PENDING_REVIEW')
  const [data, setData] = useState<AdminOrganizationRow[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [detailFor, setDetailFor] = useState<AdminOrganizationRow | null>(null)
  const [decision, setDecision] = useState<{ org: AdminOrganizationRow; action: AdminVerificationAction } | null>(null)

  const load = useCallback((filter: string) => {
    setData(null)
    api.adminOrganizations(filter)
      .then(res => { setData(res.organizations); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load the verification queue.'))
  }, [])

  useEffect(() => {
    if (!authChecked || !isAdmin) return
    const t = setTimeout(() => load(status), 0)
    return () => clearTimeout(t)
  }, [authChecked, isAdmin, status, load])

  if (!authChecked) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={ShieldCheck} title="Administrators only" description="Organization verification is restricted to BEAN administrators (server-enforced)." actionLabel="Go home" onAction={() => navigate({ view: 'home' })} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Admin</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Organization verification</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Approval is a deliberate human decision — email-domain matches are never sufficient proof. &ldquo;Verified&rdquo;
        means identity reviewed by BEAN, never government recognition or accreditation.
      </p>

      <div className="mt-6 w-full max-w-xs">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter status"><SelectValue /></SelectTrigger>
          <SelectContent className="border-border bg-popover">
            {STATUS_FILTERS.map(s => <SelectItem key={s} value={s}>{humanizeStatus(s) === 'all' ? 'All statuses' : humanizeStatus(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {failed ? (
        <div className="mt-6"><EmptyState icon={Building2} title="Could not load queue" description={failed} actionLabel="Try again" onAction={() => load(status)} /></div>
      ) : !data ? (
        <div className="mt-6 flex min-h-[30vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
      ) : data.length === 0 ? (
        <div className="mt-6"><EmptyState icon={Building2} title="Nothing in this queue" description="No organizations match this filter." /></div>
      ) : (
        <ul className="mt-6 space-y-3">
          {data.map(o => {
            const actions = legalAdminVerificationActions(o.verificationStatus)
            return (
              <li key={o.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold text-foreground">{o.displayName || o.name}</h2>
                      <Badge variant="outline" className="border-gold/30 bg-gold/5 text-gold">{humanizeStatus(o.orgType)}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[o.city, o.country].filter(Boolean).join(', ') || 'location not given'} · owner {o.owner ?? 'unknown'} · {o.memberCount} member(s) · {o.groupCount} group(s) · {o.classCount} class(es) · created {new Date(o.createdAt).toLocaleDateString()}
                    </p>
                    {o.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{o.description}</p> : null}
                  </div>
                  <Badge variant="outline" className={STATUS_BADGE[o.verificationStatus] ?? 'border-border text-muted-foreground'}>
                    {humanizeStatus(o.verificationStatus)}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {actions.map(a => (
                    <Button
                      key={a}
                      size="sm"
                      variant={a === 'APPROVE' || a === 'REINSTATE' ? 'default' : 'outline'}
                      className={
                        a === 'APPROVE' || a === 'REINSTATE'
                          ? 'bg-success/90 text-white hover:bg-success'
                          : a === 'REJECT' || a === 'SUSPEND'
                            ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
                            : 'border-border text-muted-foreground hover:bg-elevated'
                      }
                      onClick={() => setDecision({ org: o, action: a })}
                    >
                      {adminVerificationActionLabel(a)}
                    </Button>
                  ))}
                  <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setDetailFor(o)}>
                    <FileClock className="mr-1 h-3.5 w-3.5" aria-hidden /> Review evidence
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {detailFor ? (
        <OrgDetailDialog
          org={detailFor}
          onDecide={action => { setDetailFor(null); setDecision({ org: detailFor, action }) }}
          onClose={() => setDetailFor(null)}
        />
      ) : null}

      {decision ? (
        <VerificationDecisionDialog
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={() => { setDecision(null); load(status) }}
        />
      ) : null}
    </div>
  )
}

// ─── Evidence + audit history dialog ─────────────────────────────────────────

function OrgDetailDialog({ org, onDecide, onClose }: { org: AdminOrganizationRow; onDecide: (a: AdminVerificationAction) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'evidence' | 'audit'>('evidence')
  const actions = legalAdminVerificationActions(org.verificationStatus)

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">{org.displayName || org.name}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Everything below is exactly what the admin APIs return for this organization — nothing is inferred.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => setTab(v as 'evidence' | 'audit')}>
          <TabsList className="bg-elevated">
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="audit">Audit history</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === 'evidence' ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={STATUS_BADGE[org.verificationStatus] ?? 'border-border text-muted-foreground'}>
                {humanizeStatus(org.verificationStatus)}
              </Badge>
              <Badge variant="outline" className="border-gold/30 bg-gold/5 text-gold">{humanizeStatus(org.orgType)}</Badge>
              {org.isActive ? (
                <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Active</Badge>
              ) : (
                <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Inactive (operations blocked)</Badge>
              )}
            </div>
            <dl className="grid gap-1.5 text-sm">
              <EvidenceRow label="Canonical name" value={org.name} />
              <EvidenceRow label="Display name" value={org.displayName} />
              <EvidenceRow label="Owner" value={org.owner} />
              <EvidenceRow label="Description" value={org.description} />
              <EvidenceRow label="Website" value={org.website} />
              <EvidenceRow label="Public contact" value={org.publicContact} />
              <EvidenceRow label="Location" value={[org.city, org.state, org.country].filter(Boolean).join(', ') || null} />
              <EvidenceRow label="Slug" value={org.slug} />
              <EvidenceRow label="Logo text" value={org.logoText} />
              <EvidenceRow label="Members" value={String(org.memberCount)} />
              <EvidenceRow label="Groups" value={String(org.groupCount)} />
              <EvidenceRow label="Classes" value={String(org.classCount)} />
              <EvidenceRow label="Created" value={new Date(org.createdAt).toLocaleString()} />
              <EvidenceRow label="Last updated" value={new Date(org.updatedAt).toLocaleString()} />
            </dl>
            <p className="text-xs text-muted-foreground">
              Written decision reasons (rejections, suspensions) live in the append-only audit history — open the
              &ldquo;Audit history&rdquo; tab to read them.
            </p>
          </div>
        ) : (
          <OrgAuditHistory orgId={org.id} />
        )}

        <DialogFooter className="flex flex-wrap gap-2">
          {actions.map(a => (
            <Button
              key={a}
              size="sm"
              variant="outline"
              className={a === 'APPROVE' || a === 'REINSTATE' ? 'border-success/40 text-success hover:bg-success/10' : 'border-destructive/40 text-destructive hover:bg-destructive/10'}
              onClick={() => onDecide(a)}
            >
              {adminVerificationActionLabel(a)}
            </Button>
          ))}
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EvidenceRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}:</dt>
      <dd className="text-xs text-foreground">{value && value.trim() ? value : <span className="text-muted-foreground">not provided</span>}</dd>
    </div>
  )
}

function OrgAuditHistory({ orgId }: { orgId: string }) {
  const [data, setData] = useState<AdminOrganizationAuditResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    setData(null)
    setFailed(null)
    api.adminOrganizationAudit(orgId)
      .then(res => setData(res))
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load the audit trail.'))
  }, [orgId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  if (failed) {
    return <EmptyState icon={History} title="Could not load the audit trail" description={failed} actionLabel="Try again" onAction={load} />
  }
  if (!data) {
    return <div className="flex min-h-[20vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
  }
  if (data.audit.length === 0) {
    return <EmptyState icon={History} title="No audit events yet" description="Every decision on this organization is recorded append-only — events will appear here." />
  }
  return (
    <ul className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="Organization audit history">
      {data.audit.map(e => (
        <li key={e.id} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{auditActionLabel(e.action)}</p>
            <p className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            by {e.actorDisplayName ?? 'unknown actor'}
            {e.actorRole ? ` (${humanizeStatus(e.actorRole)})` : ''}
            {e.detail ? ` — ${e.detail}` : ''}
          </p>
        </li>
      ))}
    </ul>
  )
}

// ─── Decision dialog ─────────────────────────────────────────────────────────

function VerificationDecisionDialog({ decision, onClose, onDone }: {
  decision: { org: AdminOrganizationRow; action: AdminVerificationAction }
  onClose: () => void
  onDone: () => void
}) {
  const { org, action } = decision
  const [chosen, setChosen] = useState<AdminVerificationAction>(action)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)

  const legal = legalAdminVerificationActions(org.verificationStatus)
  const required = minReasonLength('verification', chosen)
  const validation = reasonValidationError(required, reason)
  const invalid = validation !== null

  const submit = async () => {
    setAttempted(true)
    if (invalid) return
    setBusy(true)
    setError(null)
    try {
      await api.adminOrganizationDecision(org.id, { action: chosen, reason: reason.trim() || undefined })
      toast({ title: 'Decision recorded in the organization audit history' })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The decision could not be recorded — try again.')
    } finally {
      setBusy(false)
    }
  }

  const destructive = chosen === 'REJECT' || chosen === 'SUSPEND'

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-md border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Verification decision — {org.displayName || org.name}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            This changes institution visibility platform-wide: approved organizations can run classes, issue credentials
            and (for employers) publish listings. The decision is stored in the append-only audit history.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="org-decision-action">Decision (only legal transitions are offered)</Label>
            <Select value={chosen} onValueChange={v => setChosen(v as AdminVerificationAction)}>
              <SelectTrigger id="org-decision-action" aria-label="Decision"><SelectValue /></SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {(legal.includes(chosen) ? legal : [...legal, chosen]).map(a => (
                  <SelectItem key={a} value={a}>{adminVerificationActionLabel(a)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Current status: {humanizeStatus(org.verificationStatus)}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="org-decision-reason">
              {required > 0 ? `Reason (required, ${required}+ characters)` : 'Note (optional)'}
            </Label>
            <Textarea
              id="org-decision-reason"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              maxLength={1000}
              aria-invalid={attempted && invalid}
              aria-describedby="org-decision-reason-help"
            />
            <p id="org-decision-reason-help" className={attempted && invalid ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'} role={attempted && invalid ? 'alert' : undefined}>
              {validation ?? `Stored in the audit history — ${reason.trim().length} character(s).`}
            </p>
          </div>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button
            className={destructive ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
            disabled={busy || invalid}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

// ─── Phase 7 — Admin organizations (#/admin/organizations) ───────────────────
// The organization verification queue: pending institution and employer
// applications with an evidence summary (owner, members, groups, classes),
// and deliberate human decisions (approve / reject with required reason /
// suspend / reinstate). Every decision is recorded append-only on the server;
// this UI never bypasses it. Teacher trust records are untouched here —
// verification contexts stay separate by design.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { AdminOrganizationRow } from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import { Building2, Loader2, ShieldCheck } from 'lucide-react'

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
  const [decision, setDecision] = useState<{ org: AdminOrganizationRow; action: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'REINSTATE' } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

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

  const decide = async () => {
    if (!decision) return
    setBusy(true)
    try {
      await api.adminOrganizationDecision(decision.org.id, { action: decision.action, reason: reason.trim() || undefined })
      toast({ title: 'Decision recorded in the organization audit history' })
      setDecision(null); setReason('')
      load(status)
    } catch (e) {
      toast({ title: 'Could not record decision', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

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
            {STATUS_FILTERS.map(s => <SelectItem key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</SelectItem>)}
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
          {data.map(o => (
            <li key={o.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-foreground">{o.displayName || o.name}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.orgType.replace(/_/g, ' ').toLowerCase()} · {o.city || o.country || 'location not given'} · owner {o.owner ?? 'unknown'} · {o.memberCount} member(s) · {o.groupCount} group(s) · {o.classCount} class(es)
                  </p>
                  {o.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{o.description}</p> : null}
                  {o.website ? <p className="text-xs text-muted-foreground">{o.website}</p> : null}
                </div>
                <Badge variant="outline" className={STATUS_BADGE[o.verificationStatus] ?? 'border-border text-muted-foreground'}>{o.verificationStatus.replace('_', ' ').toLowerCase()}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {o.verificationStatus === 'PENDING_REVIEW' ? (
                  <>
                    <Button size="sm" className="bg-success/90 text-white hover:bg-success" onClick={() => setDecision({ org: o, action: 'APPROVE' })}>
                      <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setDecision({ org: o, action: 'REJECT' })}>
                      Reject
                    </Button>
                  </>
                ) : null}
                {o.verificationStatus === 'APPROVED' ? (
                  <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setDecision({ org: o, action: 'SUSPEND' })}>
                    Suspend
                  </Button>
                ) : null}
                {o.verificationStatus === 'SUSPENDED' ? (
                  <Button size="sm" variant="outline" className="border-success/40 text-success hover:bg-success/10" onClick={() => setDecision({ org: o, action: 'REINSTATE' })}>
                    Reinstate
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!decision} onOpenChange={o => !o && !busy && setDecision(null)}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">
              {decision?.action === 'APPROVE' && `Approve ${decision.org.displayName || decision.org.name}?`}
              {decision?.action === 'REJECT' && `Reject ${decision.org.displayName || decision.org.name}?`}
              {decision?.action === 'SUSPEND' && `Suspend ${decision.org.displayName || decision.org.name}?`}
              {decision?.action === 'REINSTATE' && `Reinstate ${decision.org.displayName || decision.org.name}?`}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Written reasons are required for rejections and suspensions (10+ characters) and are stored in the
              append-only decision history.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="org-decision-reason">Reason / note</Label>
            <Textarea id="org-decision-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setDecision(null)}>Cancel</Button>
            <Button
              className={decision?.action === 'REJECT' || decision?.action === 'SUSPEND' ? 'bg-destructive text-white hover:bg-destructive/90' : 'bg-gold text-primary-foreground hover:bg-gold-hover'}
              disabled={busy || ((decision?.action === 'REJECT' || decision?.action === 'SUSPEND') && reason.trim().length < 10)}
              onClick={decide}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Record decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

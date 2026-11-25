'use client'

// ─── BEAN Classroom Intelligence (CI-4G): teacher-facing observer controls ───
// The missing teacher interface for the CI-3D observer API (GET/POST/DELETE
// /api/teach/classes/:id/live/observer). Honest by construction:
//   • the availability prerequisites are stated (LIVE room, CI consent, pool
//     capacity, provider configured) — the API's typed refusals render as
//     first-class states, never hidden;
//   • structured-only observation is explained in plain words: the observer
//     CANNOT hear or see media (no subscribe grants), records aggregate
//     structured signals only;
//   • connection status, reconnect gaps and failures come from the real
//     observer session row — nothing decorative, no fake metrics.
// Owner-only: the server re-checks ownership on every call (the API guard is
// the authority; this UI is convenience, not security).

import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2, ShieldCheck, AlertTriangle, Radio } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
/** Client-safe mirror of the CI-3D observer DTO (server rows never leak). */
interface ObserverSessionDTO {
  observerSessionId: string
  status: string
  leftReason: string | null
  consentMode: string
  transcriptionEnabled: boolean
  canPublishMedia: boolean
  reconnectCount: number
  connectedSeconds: number
  dispatchedAt: string
  connectedAt: string | null
  leftAt: string | null
  hasEvidence: boolean
}

interface ObserverStatusResponse {
  liveStatus: string | null
  observer: ObserverSessionDTO | null
  error?: string
}

function statusTone(status: string): 'live' | 'warn' | 'bad' | 'muted' {
  switch (status) {
    case 'OBSERVING':
      return 'live'
    case 'CONNECTING':
    case 'PLANNED':
      return 'warn'
    case 'FAILED':
      return 'bad'
    default:
      return 'muted'
  }
}

export function ObserverControls({ classId, liveStatus }: { classId: string; liveStatus: string | null }) {
  const [observer, setObserver] = useState<ObserverSessionDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await api.observerStatus(classId)
      setObserver(res.observer ?? null)
      setApiError(null)
    } catch (err) {
      // The typed API refusals (403/404/409/503) surface here honestly.
      setApiError(err instanceof Error ? err.message : 'Observer status unavailable.')
    } finally {
      setLoading(false)
    }
  }, [classId])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      void refresh()
    }, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  const enable = async () => {
    setActing(true)
    try {
      await api.observerEnable(classId)
      toast({ title: 'Observer joining', description: 'The visible observer is connecting to your live class (structured signals only).' })
      await refresh()
    } catch (err) {
      toast({ title: 'Observer could not be dispatched', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setActing(false)
    }
  }

  const withdraw = async () => {
    setActing(true)
    try {
      await api.observerWithdraw(classId)
      toast({ title: 'Observer withdrawn', description: 'The observer left your class. Attendance and booking records are unaffected.' })
      await refresh()
    } catch (err) {
      toast({ title: 'Withdrawal failed', description: err instanceof Error ? err.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setActing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Checking observer status…
      </div>
    )
  }

  const isActive = observer !== null && ['PLANNED', 'CONNECTING', 'OBSERVING'].includes(observer.status)
  const tone = observer ? statusTone(observer.status) : 'muted'

  return (
    <section aria-label="Classroom observer controls" className="rounded-xl border border-border bg-elevated p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isActive ? <Eye className="h-4 w-4 text-gold" aria-hidden /> : <EyeOff className="h-4 w-4 text-muted-foreground" aria-hidden />}
          <h3 className="text-sm font-semibold text-foreground">Classroom observer</h3>
        </div>
        {observer ? (
          <Badge
            className={cnTone(tone)}
            variant="outline"
          >
            <Radio className="mr-1 h-3 w-3" aria-hidden />
            {observer.status}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-border bg-elevated text-muted-foreground">Not attached</Badge>
        )}
      </header>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        A single, visible observer can join this class. It is <strong className="text-foreground">structured-only</strong>: it cannot
        listen or watch (no audio/video access), cannot publish anything, and records only aggregate, identity-free signals that feed
        the post-class evaluation. Its presence is disclosed to everyone in the room. Consent and eligibility are re-checked server-side
        on every action.
      </p>

      {observer && (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <dt className="font-medium text-foreground">Connection</dt>
            <dd>{observer.status === 'OBSERVING' ? 'Connected and observing' : observer.status === 'FAILED' ? 'Connection failed' : observer.status}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Reconnects</dt>
            <dd>{observer.reconnectCount ?? 0}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Media access</dt>
            <dd>{observer.canPublishMedia ? 'yes' : 'none (cannot publish or subscribe)'}</dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Transcription</dt>
            <dd>{observer.transcriptionEnabled ? 'enabled' : 'disabled — no audio is processed'}</dd>
          </div>
          {observer.leftReason && (
            <div className="col-span-2">
              <dt className="font-medium text-foreground">Left because</dt>
              <dd>{observer.leftReason}</dd>
            </div>
          )}
          {observer.status === 'FAILED' && (
            <div className="col-span-2 flex items-start gap-1.5 text-destructive" role="alert">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <dd>The observer failed to connect or was dropped — see the failure reason above. You can re-enable it; class records are unaffected.</dd>
            </div>
          )}
        </dl>
      )}

      {apiError && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {apiError}
        </p>
      )}

      <div className="mt-3">
        {isActive ? (
          <Button size="sm" variant="outline" onClick={withdraw} disabled={acting} className="border-border">
            {acting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <EyeOff className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
            Withdraw observer
          </Button>
        ) : liveStatus === 'LIVE' ? (
          <Button size="sm" onClick={enable} disabled={acting} className="bg-gold text-obsidian hover:bg-gold/90">
            {acting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
            Enable observer
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">The observer can only join while the class is live{liveStatus ? ` (current state: ${liveStatus})` : ''}.</p>
        )}
      </div>
    </section>
  )
}

function cnTone(tone: 'live' | 'warn' | 'bad' | 'muted'): string {
  switch (tone) {
    case 'live':
      return 'border-success/40 bg-success/10 text-success'
    case 'warn':
      return 'border-gold/40 bg-gold/10 text-gold'
    case 'bad':
      return 'border-destructive/40 bg-destructive/10 text-destructive'
    default:
      return 'border-border bg-elevated text-muted-foreground'
  }
}

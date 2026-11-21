'use client'

// ─── BEAN Live Classroom (Phase 5): entry points on existing pages ────────────
// Small, additive live-state widgets embedded in the EXISTING class detail,
// teacher dashboard and My Bookings surfaces. Each fetches the safe public
// status for its own class and renders the honest state:
//   • students: "Classroom not started yet" / "Join Live Classroom" /
//     "Class completed"
//   • teachers: "Start Live Class" / "Open Classroom" / "Classroom ended"
// Access is always re-derived server-side; these widgets only render.

import { useCallback, useEffect, useRef, useState } from 'react'
import { GraduationCap, Loader2, Radio, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { LiveStatusDTO } from '@/lib/types'

function useLiveStatusPolling(classId: string, enabled: boolean, intervalMs = 15_000) {
  const [status, setStatus] = useState<LiveStatusDTO | null>(null)
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.liveStatus(classId)
      setStatus(res.status)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [classId])

  useEffect(() => {
    if (!enabled) return
    // First tick deferred past the effect body (React Compiler: no
    // synchronous setState during effects); then poll on the interval.
    const first = setTimeout(() => { void load() }, 0)
    timerRef.current = setInterval(() => { void load() }, intervalMs)
    return () => {
      clearTimeout(first)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [enabled, load, intervalMs])

  return { status, failed, reload: load }
}

/** Class detail sidebar card: live state + join/start actions. */
export function ClassroomEntryCard({ classId, isOwner }: { classId: string; isOwner: boolean }) {
  const navigate = useAppStore((s) => s.navigate)
  const { status, failed } = useLiveStatusPolling(classId, true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (failed || !status) {
    return (
      <p className="mt-4 flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Live classroom status is unavailable right now.
      </p>
    )
  }

  if (status.mayJoin) {
    return (
      <Button
        className="mt-3 w-full bg-gold text-primary-foreground hover:bg-gold-hover"
        onClick={() => navigate({ view: 'classroom', classId })}
      >
        <Radio className="mr-2 h-4 w-4" aria-hidden /> Join Live Classroom
      </Button>
    )
  }

  if (isOwner) {
    const now = Date.now()
    const insideWindow = new Date(status.windowOpens).getTime() <= now && now < new Date(status.windowCloses).getTime()
    const ended = status.liveState === 'ENDED' || now >= new Date(status.windowCloses).getTime()
    if (status.liveState === 'LIVE') {
      return (
        <Button
          className="mt-3 w-full bg-gold text-primary-foreground hover:bg-gold-hover"
          onClick={() => navigate({ view: 'classroom', classId })}
        >
          <Radio className="mr-2 h-4 w-4" aria-hidden /> Open Classroom
        </Button>
      )
    }
    if (!ended && insideWindow && status.configurationStatus !== 'NOT_CONFIGURED') {
      return (
        <div className="mt-3">
          <Button
            className="w-full bg-gold text-primary-foreground hover:bg-gold-hover"
            disabled={starting}
            onClick={async () => {
              setStarting(true)
              setError(null)
              try {
                await api.liveStart(classId)
                navigate({ view: 'classroom', classId })
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not start the live classroom.')
              } finally {
                setStarting(false)
              }
            }}
          >
            {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" aria-hidden />}
            Start Live Class
          </Button>
          {error && <p className="mt-2 text-[11px] text-destructive" role="alert">{error}</p>}
        </div>
      )
    }
    return (
      <p className="mt-3 text-[11px] text-muted-foreground">
        {ended ? 'Classroom ended' : 'Classroom not started yet'}
        {status.configurationStatus === 'NOT_CONFIGURED' ? ' · live rooms need LiveKit credentials (operators)' : ''}
      </p>
    )
  }

  // Student / guest states — honest, no fake controls.
  const ended = status.liveState === 'ENDED' || Date.now() >= new Date(status.windowCloses).getTime()
  return (
    <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
      <Video className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      {status.configurationStatus === 'NOT_CONFIGURED'
        ? 'The in-platform live classroom is being set up — nothing is recorded in any case.'
        : ended
          ? 'Class completed.'
          : status.liveState === 'LIVE'
            ? status.joinBlockReason ?? 'The classroom is live — reserve a seat and sign in to enter.'
            : 'Classroom not started yet — the join button appears here when the teacher opens the room.'}
    </p>
  )
}

/** My Bookings badge: live-now highlight with a join action for eligible seats. */
export function BookingLiveBadge({ classId }: { classId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const authedStudent = useAppStore((s) => s.authedStudent)
  const { status } = useLiveStatusPolling(classId, !!authedStudent)
  if (!status) return null
  if (status.liveState === 'LIVE') {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
          <Radio className="mr-1 h-3 w-3" aria-hidden /> Live now
        </Badge>
        {status.mayJoin && (
          <Button size="sm" className="h-7 bg-gold px-2 text-xs text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'classroom', classId })}>
            Join
          </Button>
        )}
      </div>
    )
  }
  if (status.liveState === 'ENDED') {
    return <Badge variant="outline" className="border-border text-muted-foreground">Completed</Badge>
  }
  return <Badge variant="outline" className="border-border text-muted-foreground">Scheduled</Badge>
}

/** Teacher dashboard compact action: start / open / ended per class row. */
export function TeacherLiveClassButton({ classId }: { classId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const { status } = useLiveStatusPolling(classId, true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!status) {
    return (
      <Button size="sm" variant="outline" className="border-border text-muted-foreground" disabled>
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Live…
      </Button>
    )
  }

  const now = Date.now()
  const insideWindow = new Date(status.windowOpens).getTime() <= now && now < new Date(status.windowCloses).getTime()
  const ended = status.liveState === 'ENDED' || now >= new Date(status.windowCloses).getTime()

  if (status.liveState === 'LIVE') {
    return (
      <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'classroom', classId })}>
        <Radio className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Open Classroom
      </Button>
    )
  }
  if (!ended && insideWindow && status.configurationStatus !== 'NOT_CONFIGURED') {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          size="sm"
          className="bg-gold text-primary-foreground hover:bg-gold-hover"
          disabled={starting}
          onClick={async () => {
            setStarting(true)
            setError(null)
            try {
              await api.liveStart(classId)
              navigate({ view: 'classroom', classId })
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Start failed.')
            } finally {
              setStarting(false)
            }
          }}
        >
          {starting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Radio className="mr-1.5 h-3.5 w-3.5" aria-hidden />}
          Start Live Class
        </Button>
        {error && <span className="text-[10px] text-destructive" role="alert">{error}</span>}
      </div>
    )
  }
  if (ended) {
    return (
      <Badge variant="outline" className="border-border text-muted-foreground">
        <GraduationCap className="mr-1 h-3 w-3" aria-hidden /> Classroom ended
      </Badge>
    )
  }
  if (status.configurationStatus === 'NOT_CONFIGURED') {
    return (
      <Badge variant="outline" className="border-gold/40 text-gold" title="Add LiveKit credentials to enable live classrooms (docs/PHASE5_LIVEKIT_SETUP.md)">
        Live rooms need LiveKit credentials
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-border text-muted-foreground">
      Classroom not started yet
    </Badge>
  )
}

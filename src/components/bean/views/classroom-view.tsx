'use client'

// ─── BEAN Live Classroom (Phase 5): classroom route view ──────────────────────
// Entry orchestration for #/classroom/:classId:
//   • guests get a sign-in prompt (guest browsing stays fully available)
//   • live status is polled until the user is inside the room (honest states:
//     not started / completed / window closed / not configured)
//   • the owner teacher can START the room when the scheduled window opens
//   • eligible participants get the pre-join consent screen, then the room
// Access is re-derived server-side on every call — this view only renders.
// The caller's classroom role comes from the server: isOwner on the class
// detail DTO, confirmed by the token response's participant.role.

import { useCallback, useEffect, useRef, useState } from 'react'
import { GraduationCap, Loader2, Radio, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { LiveStatusDTO } from '@/lib/types'
import { ClassroomPreJoin, ClassroomErrorState } from '@/components/bean/classroom/classroom-states'
import { ClassroomShell } from '@/components/bean/classroom/classroom-shell'
import { formatClassLocal } from '@/components/bean/teach-format'

interface ClassMeta {
  title: string
  teacherName: string
  timeZone: string
  startsAt: string
  durationMinutes: number
  isOwner: boolean
}

export function ClassroomView({ classId }: { classId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const authedStudent = useAppStore((s) => s.authedStudent)
  const authChecked = useAppStore((s) => s.authChecked)

  const [status, setStatus] = useState<LiveStatusDTO | null>(null)
  const [classMeta, setClassMeta] = useState<ClassMeta | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [roomRole, setRoomRole] = useState<'TEACHER' | 'STUDENT'>('STUDENT')
  const [inRoom, setInRoom] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    api.teachClass(classId)
      .then((res) => {
        setClassMeta({
          title: res.class.title,
          teacherName: res.class.teacher.teachingName,
          timeZone: res.class.timeZone,
          startsAt: res.class.startsAt,
          durationMinutes: res.class.durationMinutes,
          isOwner: res.class.isOwner,
        })
        setFailed(null)
      })
      .catch((e) => setFailed(e instanceof Error ? e.message : 'Could not open this classroom.'))
  }, [classId])

  const loadStatus = useCallback(async (): Promise<LiveStatusDTO | null> => {
    try {
      const res = await api.liveStatus(classId)
      setStatus(res.status)
      setFailed(null)
      return res.status
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not load the classroom status.')
      return null
    }
  }, [classId])

  useEffect(() => {
    load()
    void loadStatus()
  }, [load, loadStatus])

  // Poll while outside the room so "live now" appears promptly.
  useEffect(() => {
    if (inRoom) {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
      return
    }
    pollRef.current = setInterval(() => { void loadStatus() }, 15_000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [inRoom, loadStatus])

  if (!authChecked) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading classroom">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  if (!authedStudent) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <ShieldAlert className="mb-4 h-10 w-10 text-gold" aria-hidden />
        <h1 className="font-display text-xl font-semibold text-foreground">Sign in to enter the classroom</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Guests can browse classes freely, but a live classroom requires a signed-in account with a confirmed reservation.
        </p>
        <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>
          Sign in
        </Button>
      </div>
    )
  }

  if (failed && !classMeta) {
    return <ClassroomErrorState title="Could not open this classroom" description={failed} onBack={() => {}} />
  }
  if (!status || !classMeta) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading classroom status">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  const isOwner = classMeta.isOwner
  const now = Date.now()
  const insideWindow = new Date(status.windowOpens).getTime() <= now && now < new Date(status.windowCloses).getTime()

  // ─── Room ──────────────────────────────────────────────────────────────────
  if (inRoom) {
    return (
      <ClassroomShell
        classId={classId}
        classTitle={classMeta.title}
        teacherName={classMeta.teacherName}
        startsAt={classMeta.startsAt}
        timeZone={classMeta.timeZone}
        localRole={roomRole}
      />
    )
  }

  // ─── Pre-join ──────────────────────────────────────────────────────────────
  if (status.mayJoin) {
    return (
      <ClassroomPreJoin
        classTitle={classMeta.title}
        teacherName={classMeta.teacherName}
        startsAt={classMeta.startsAt}
        timeZone={classMeta.timeZone}
        durationMinutes={classMeta.durationMinutes}
        role={isOwner ? 'TEACHER' : 'STUDENT'}
        configurationStatus={status.configurationStatus}
        joining={joining}
        joinError={joinError}
        onJoin={async () => {
          setJoining(true)
          setJoinError(null)
          try {
            // The token route is the authority: it re-derives the role and the
            // booking/ownership/window state from the BEAN database. If it
            // refuses, the message shown here is the server's own.
            const access = await api.liveToken(classId)
            setRoomRole(access.participant.role)
            setInRoom(true)
          } catch (e) {
            setJoinError(e instanceof Error ? e.message : 'Could not join the classroom.')
          } finally {
            setJoining(false)
          }
        }}
        onBack={() => navigate({ view: 'class', classId })}
      />
    )
  }

  // ─── Gate (honest states) ──────────────────────────────────────────────────
  const ended = status.liveState === 'ENDED' || now >= new Date(status.windowCloses).getTime()
  const ownerCanStart = isOwner && status.liveState !== 'ENDED' && insideWindow && status.configurationStatus !== 'NOT_CONFIGURED'

  const startClass = async () => {
    setStarting(true)
    setJoinError(null)
    try {
      await api.liveStart(classId)
      await loadStatus()
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Could not start the live classroom.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      {ended ? <GraduationCap className="mb-4 h-10 w-10 text-gold" aria-hidden /> : <Radio className="mb-4 h-10 w-10 text-muted-foreground" aria-hidden />}
      <h1 className="font-display text-xl font-semibold text-foreground">
        {status.configurationStatus === 'NOT_CONFIGURED'
          ? 'Live classroom not configured yet'
          : ended
            ? 'Class completed'
            : 'Classroom not started yet'}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {status.configurationStatus === 'NOT_CONFIGURED'
          ? 'BEAN operators still need to add LiveKit credentials — this class runs as scheduled and nothing is recorded.'
          : status.joinBlockReason ?? 'The teacher has not opened the room. This page updates automatically.'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Scheduled: {formatClassLocal(status.scheduledStart)}</p>

      {joinError && (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {joinError}
        </p>
      )}

      {ownerCanStart && (
        <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" disabled={starting} onClick={() => void startClass()}>
          {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" />}
          Start Live Class
        </Button>
      )}

      <div className="mt-6 flex gap-2">
        <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => navigate({ view: 'class', classId })}>
          Back to class
        </Button>
      </div>

      <Badge variant="outline" className="mt-8 border-border text-muted-foreground">
        Free pilot — live classroom only, never recorded
      </Badge>
    </div>
  )
}

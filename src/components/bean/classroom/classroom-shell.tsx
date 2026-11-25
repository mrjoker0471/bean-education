'use client'

// ─── BEAN Live Classroom (Phase 5): assembled live room ───────────────────────
// The BEAN-styled classroom surface: header with live status, screen share,
// whiteboard, responsive video grid, control bar, participant panel, teacher
// end-class confirmation, and honest reconnection handling.

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, GraduationCap, Loader2, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useLiveClassroom, type ClassroomConnection } from './use-live-classroom'
import { VideoGrid, ScreenShareView } from './participant-media'
import { WhiteboardCanvas } from './whiteboard-canvas'
import { ClassroomControlBar, ConnectionStatus } from './classroom-controls'
import { ObserverDisclosure, isObserverIdentity } from './observer-disclosure'
import { ParticipantPanel } from './participant-panel'
import { formatClassInZone } from '@/components/bean/teach-format'

interface ClassroomShellProps {
  classId: string
  classTitle: string
  teacherName: string
  startsAt: string
  timeZone: string
  localRole: 'TEACHER' | 'STUDENT'
}

export function ClassroomShell({ classId, classTitle, teacherName, startsAt, timeZone, localRole }: ClassroomShellProps) {
  const navigate = useAppStore((s) => s.navigate)
  const classroom = useLiveClassroom({ classId })
  const [boardOpen, setBoardOpen] = useState(true)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  const [micDevices, setMicDevices] = useState<{ deviceId: string; kind: MediaDeviceKind; label: string }[]>([])
  const [camDevices, setCamDevices] = useState<{ deviceId: string; kind: MediaDeviceKind; label: string }[]>([])
  const [activeMicDevice, setActiveMicDevice] = useState('default')
  const [activeCamDevice, setActiveCamDevice] = useState('default')

  const participants = classroom.participants.map((p) => ({
    ...p,
    handRaised: !!classroom.hands[p.identity] || (p.isLocal && classroom.localHandRaised),
  }))
  const teacherParticipant = participants.find((p) => p.role === 'TEACHER')
  const screenShare = participants.find((p) => p.screenSharing)
  // CI-4G: the visible observer is disclosed to everyone when present. The
  // observer never counts toward attendance (webhook-side exclusion) and the
  // disclosure states plainly that nothing is recorded.
  const observerParticipant = participants.find((p) => isObserverIdentity(p.identity))

  // Enumerate devices for the selectors (labels appear after permission grants).
  useEffect(() => {
    let cancelled = false
    const list = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (cancelled) return
        setMicDevices(devices.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label || 'Microphone' })))
        setCamDevices(devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label || 'Camera' })))
      } catch { /* best-effort */ }
    }
    void list()
    return () => { cancelled = true }
  }, [])

  const endClass = useCallback(async () => {
    setEnding(true)
    try {
      await api.liveEnd(classId)
      await classroom.leave()
      navigate({ view: 'teach-dashboard' })
    } catch (e) {
      classroom.setError(e instanceof Error ? e.message : 'Could not end the class — please try again.')
    } finally {
      setEnding(false)
      setConfirmEnd(false)
    }
  }, [classId, classroom, navigate])

  const backToClass = () => navigate({ view: 'class', classId })

  // ─── Ended / disconnected screens ──────────────────────────────────────────
  if (classroom.connection === 'SESSION_ENDED') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <GraduationCap className="mb-4 h-10 w-10 text-gold" aria-hidden />
        <h1 className="font-display text-xl font-semibold text-foreground">The class has ended</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {localRole === 'TEACHER'
            ? 'Your classroom is closed and its verified usage has been recorded.'
            : 'The teacher ended the live classroom. Attendance evidence is kept from your verified connection time.'}
        </p>
        <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={backToClass}>
          Back to class
        </Button>
      </div>
    )
  }

  const showReconnect = classroom.connection === 'DISCONNECTED' || classroom.connection === 'CONNECTION_FAILED'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
              <Radio className="mr-1 h-3 w-3" aria-hidden /> LIVE
            </Badge>
            <ConnectionStatus connection={classroom.connection} />
            <Badge variant="outline" className="border-border text-muted-foreground">
              {classroom.participants.length} in room
            </Badge>
          </div>
          <h1 className="mt-2 truncate font-display text-lg font-semibold text-foreground sm:text-xl">{classTitle}</h1>
          <p className="text-xs text-muted-foreground">Taught by {teacherName} · {formatClassInZone(startsAt, timeZone)} · live only, not recorded</p>
        </div>
        <Button variant="ghost" size="sm" className="self-start text-muted-foreground hover:text-foreground" onClick={backToClass}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Class page
        </Button>
      </div>

      {classroom.error && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {classroom.error}
        </p>
      )}

      {showReconnect && (
        <div className="mt-3 flex flex-col items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gold">
            {classroom.connection === 'RECONNECTING'
              ? 'Reconnecting to the classroom…'
              : 'You were disconnected. Re-entry is safe — attendance evidence never double-counts.'}
          </p>
          <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => void classroom.connect()}>
            Retry connection
          </Button>
        </div>
      )}

      {/* Main surface */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-4">
          {screenShare && classroom.getScreenShareTrack(screenShare.identity, screenShare.isLocal)?.track && (
            <ScreenShareView
              screenTrack={classroom.getScreenShareTrack(screenShare.identity, screenShare.isLocal)}
              presenterName={screenShare.name}
            />
          )}

          {observerParticipant && (
            <ObserverDisclosure observerName={observerParticipant.name} />
          )}

          {boardOpen && (
            <WhiteboardCanvas
              strokes={classroom.strokes}
              isTeacher={localRole === 'TEACHER'}
              onAddStroke={classroom.addStroke}
              onUndo={classroom.undoStroke}
              onClear={classroom.clearBoard}
            />
          )}

          <VideoGrid participants={classroom.participants} getCameraTrack={classroom.getCameraTrack} getMicrophoneTrack={classroom.getMicrophoneTrack} />
        </div>

        {/* Participant panel (desktop side, mobile overlay) */}
        <aside
          className={cn(
            'rounded-xl border border-border bg-card p-4 lg:block',
            participantsOpen ? 'block' : 'hidden lg:block',
          )}
          aria-label="Participants"
        >
          <h2 className="font-display text-sm font-semibold text-foreground">Participants ({classroom.participants.length})</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {teacherParticipant ? `${teacherParticipant.name} controls the board and screen share.` : 'Waiting for the teacher…'}
          </p>
          <div className="mt-3">
            <ParticipantPanel
              participants={participants}
              isTeacher={localRole === 'TEACHER'}
              onMute={classroom.muteParticipant}
              onRemove={classroom.removeParticipant}
            />
          </div>
        </aside>
      </div>

      {/* Control bar */}
      <div className="mt-4">
        <ClassroomControlBar
          connection={classroom.connection as ClassroomConnection}
          micEnabled={classroom.micEnabled}
          camEnabled={classroom.camEnabled}
          screenSharing={classroom.screenSharing}
          handRaised={classroom.localHandRaised}
          isTeacher={localRole === 'TEACHER'}
          boardOpen={boardOpen}
          participantsOpen={participantsOpen}
          micDevices={micDevices}
          camDevices={camDevices}
          activeMicDevice={activeMicDevice}
          activeCamDevice={activeCamDevice}
          onToggleMic={() => void classroom.toggleMic()}
          onToggleCam={() => void classroom.toggleCam()}
          onToggleScreenShare={() => void classroom.toggleScreenShare()}
          onToggleHand={classroom.toggleHand}
          onToggleBoard={() => setBoardOpen((v) => !v)}
          onToggleParticipants={() => setParticipantsOpen((v) => !v)}
          onSwitchMic={(id) => { setActiveMicDevice(id); void classroom.switchDevice('audioinput', id) }}
          onSwitchCam={(id) => { setActiveCamDevice(id); void classroom.switchDevice('videoinput', id) }}
          onLeave={() => {
            if (localRole === 'TEACHER') {
              setConfirmEnd(true) // teacher ending is a confirmed, finalising action
            } else {
              void classroom.leave()
              backToClass()
            }
          }}
          leaveLabel={localRole === 'TEACHER' ? 'End class' : 'Leave'}
        />
      </div>

      {/* Teacher end-class confirmation */}
      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">End the live class?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Everyone is disconnected from the room, your verified usage is recorded once, and the classroom cannot restart. Students keep their verified attendance evidence.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border bg-transparent text-muted-foreground hover:bg-elevated" disabled={ending}>
              Keep teaching
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={ending}
              onClick={(e) => { e.preventDefault(); void endClass() }}
            >
              {ending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              End class for everyone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

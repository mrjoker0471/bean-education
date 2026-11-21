'use client'

// ─── BEAN Live Classroom (Phase 5): participant media tiles ───────────────────
// Real LiveKit tracks rendered inside BEAN's obsidian/champagne design —
// no imported generic conference UI. Local video is muted to prevent echo;
// remote video attaches through the SDK's attach()/detach() so cleanup is
// deterministic when tracks unsubscribe.

import { useEffect, useRef } from 'react'
import { MicOff, MonitorUp, VideoOff, Hand, GraduationCap } from 'lucide-react'
import type { LocalTrackPublication, RemoteTrackPublication } from 'livekit-client'
import { cn } from '@/lib/utils'
import type { ClassroomParticipant } from './use-live-classroom'

type AnyTrackPublication = LocalTrackPublication | RemoteTrackPublication | undefined

function VideoTrack({ publication, className, mirror }: { publication: AnyTrackPublication; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const el = ref.current
    const track = publication?.track
    if (!el || !track) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [publication?.track])

  if (!publication?.track) {
    return (
      <div className={cn('flex h-full w-full items-center justify-center bg-elevated', className)}>
        <VideoOff className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
    )
  }
  return (
    <video
      ref={ref}
      className={cn('h-full w-full bg-black object-cover', mirror && 'scale-x-[-1]', className)}
      autoPlay
      playsInline
      muted={publication.isLocal}
      aria-label="Participant video"
    />
  )
}

function AudioTrack({ publication }: { publication: AnyTrackPublication }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    const el = ref.current
    const track = publication?.track
    if (!el || !track || publication?.isLocal) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [publication?.track])
  if (!publication?.track || publication.isLocal) return null
  return <audio ref={ref} autoPlay className="hidden" aria-hidden />
}

export function ParticipantTile({
  participant,
  cameraTrack,
  microphoneTrack,
  compact,
}: {
  participant: ClassroomParticipant
  cameraTrack: AnyTrackPublication
  microphoneTrack: AnyTrackPublication
  compact?: boolean
}) {
  const isTeacher = participant.role === 'TEACHER'
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border bg-card',
        isTeacher ? 'border-gold/50' : 'border-border',
      )}
    >
      <div className={cn('relative w-full', compact ? 'aspect-video' : 'aspect-video')}>
        {participant.cameraEnabled ? (
          <VideoTrack publication={cameraTrack} mirror={participant.isLocal} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-elevated">
            <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', isTeacher ? 'border border-gold/40 bg-gold/10' : 'border border-border bg-card')}>
              <GraduationCap className={cn('h-6 w-6', isTeacher ? 'text-gold' : 'text-muted-foreground')} aria-hidden />
            </div>
            <span className="text-xs text-muted-foreground">Camera off</span>
          </div>
        )}
        {/* Audio element for remote participants (hidden). */}
        <AudioTrack publication={microphoneTrack} />

        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium backdrop-blur',
              isTeacher ? 'border-gold/40 bg-black/70 text-gold' : 'border-border bg-black/70 text-foreground',
            )}
          >
            {isTeacher && <GraduationCap className="h-3.5 w-3.5" aria-hidden />}
            {participant.name}
            {participant.isLocal && <span className="text-muted-foreground">(you)</span>}
          </span>
          <span className="flex items-center gap-1.5">
            {participant.handRaised && (
              <span className="flex items-center rounded-md border border-gold/40 bg-black/70 px-1.5 py-1 text-gold" aria-label="Hand raised">
                <Hand className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}
            {!participant.micEnabled && (
              <span className="flex items-center rounded-md border border-border bg-black/70 px-1.5 py-1 text-muted-foreground" aria-label="Microphone muted">
                <MicOff className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

export function ScreenShareView({ screenTrack, presenterName }: { screenTrack: AnyTrackPublication; presenterName: string }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const el = ref.current
    const track = screenTrack?.track
    if (!el || !track) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [screenTrack?.track])

  if (!screenTrack?.track) return null
  return (
    <div className="overflow-hidden rounded-xl border border-gold/40 bg-black">
      <div className="flex items-center gap-1.5 border-b border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
        <MonitorUp className="h-3.5 w-3.5 text-gold" aria-hidden />
        {presenterName} is sharing their screen
      </div>
      <video ref={ref} autoPlay playsInline className="max-h-[50vh] w-full bg-black object-contain" aria-label="Screen share" />
    </div>
  )
}

export function VideoGrid({
  participants,
  getCameraTrack,
  getMicrophoneTrack,
}: {
  participants: ClassroomParticipant[]
  getCameraTrack: (identity: string, isLocal: boolean) => AnyTrackPublication
  getMicrophoneTrack: (identity: string, isLocal: boolean) => AnyTrackPublication
}) {
  return (
    <div
      className={cn(
        'grid gap-3',
        participants.length === 1 && 'grid-cols-1',
        participants.length === 2 && 'grid-cols-1 sm:grid-cols-2',
        participants.length > 2 && participants.length <= 4 && 'grid-cols-1 sm:grid-cols-2',
        participants.length > 4 && 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
      )}
    >
      {participants.map((p) => (
        <ParticipantTile
          key={p.identity}
          participant={p}
          cameraTrack={getCameraTrack(p.identity, p.isLocal)}
          microphoneTrack={getMicrophoneTrack(p.identity, p.isLocal)}
        />
      ))}
    </div>
  )
}

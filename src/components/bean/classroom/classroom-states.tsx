'use client'

// ─── BEAN Live Classroom (Phase 5): pre-join screen & states ──────────────────
// Before connecting, students and teachers see an explicit, honest gate:
//   • what camera/microphone permissions are for
//   • an OPT-IN camera preview (never auto-activated — consent first)
//   • a microphone test with a live level meter
//   • the available devices + the class details + the booking state
// Media is only acquired for the room after the user presses Join.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  CameraOff,
  GraduationCap,
  Loader2,
  Mic,
  MicOff,
  MonitorX,
  ShieldCheck,
  Signal,
  Video,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'
import { formatClassInZone, formatClassLocal, formatDuration } from '@/components/bean/teach-format'
import type { LiveConfigStatus } from '@/lib/types'

interface MediaDeviceInfoLite {
  deviceId: string
  kind: MediaDeviceKind
  label: string
}

const CONFIG_STATUS_LABELS: Record<LiveConfigStatus, string> = {
  NOT_CONFIGURED: 'Live classroom is not configured yet — BEAN operators need to add LiveKit credentials.',
  CONFIGURED: 'Live classroom is configured but the free-pilot allowance is fully reserved for this month.',
  CONNECTION_ERROR: 'The realtime provider could not be reached — try again shortly.',
  AVAILABLE: 'Live classroom ready (free pilot).',
}

export function ClassroomPreJoin({
  classTitle,
  teacherName,
  startsAt,
  timeZone,
  durationMinutes,
  role,
  configurationStatus,
  joining,
  joinError,
  onJoin,
  onBack,
}: {
  classTitle: string
  teacherName: string
  startsAt: string
  timeZone: string
  durationMinutes: number
  role: 'TEACHER' | 'STUDENT'
  configurationStatus: LiveConfigStatus
  joining: boolean
  joinError: string | null
  onJoin: () => void
  onBack: () => void
}) {
  const [previewOn, setPreviewOn] = useState(false)
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [micTestOn, setMicTestOn] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfoLite[]>([])
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)

  const stopEverything = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined)
      audioCtxRef.current = null
    }
    previewStream?.getTracks().forEach((t) => t.stop())
  }, [previewStream])

  useEffect(() => stopEverything, [stopEverything])

  const listDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(
        list
          .filter((d) => d.kind === 'videoinput' || d.kind === 'audioinput')
          .map((d) => ({ deviceId: d.deviceId, kind: d.kind, label: d.label || (d.kind === 'videoinput' ? 'Camera' : 'Microphone') })),
      )
    } catch { /* enumeration is best-effort */ }
  }, [])

  const startPreview = useCallback(async () => {
    setPreviewError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      setPreviewStream(stream)
      setPreviewOn(true)
      if (videoRef.current) videoRef.current.srcObject = stream
      await listDevices()
    } catch (e) {
      setPreviewError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Camera permission was denied — enable it in your browser settings to appear on video.'
          : 'No camera is available on this device.',
      )
    }
  }, [listDevices])

  const stopPreview = useCallback(() => {
    previewStream?.getTracks().forEach((t) => t.stop())
    setPreviewStream(null)
    setPreviewOn(false)
  }, [previewStream])

  const startMicTest = useCallback(async () => {
    setPreviewError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((s, v) => s + v, 0) / data.length
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      setMicTestOn(true)
      stream.getTracks().forEach((t) => (t.onended = () => setMicTestOn(false)))
      await listDevices()
    } catch (e) {
      setPreviewError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Microphone permission was denied — enable it in your browser settings to speak.'
          : 'No microphone is available on this device.',
      )
    }
  }, [listDevices])

  const stopMicTest = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined)
      audioCtxRef.current = null
    }
    setMicTestOn(false)
    setMicLevel(0)
  }, [])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" onClick={onBack}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to class
      </Button>

      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-gold/40 text-gold">{role === 'TEACHER' ? 'Teacher' : 'Student'}</Badge>
          <Badge variant="outline" className="border-border text-muted-foreground">Free pilot — live only, no recording</Badge>
        </div>
        <h1 className="mt-3 font-display text-xl font-semibold text-foreground sm:text-2xl">{classTitle}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Taught by {teacherName} · {formatClassLocal(startsAt)} · {formatClassInZone(startsAt, timeZone)} · {formatDuration(durationMinutes)}
        </p>
        <p className={cn('mt-3 rounded-lg border px-3 py-2 text-xs', configurationStatus === 'AVAILABLE' ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-elevated text-muted-foreground')}>
          {CONFIG_STATUS_LABELS[configurationStatus]}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Camera preview (explicit opt-in) */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
            <Video className="h-4 w-4 text-gold" aria-hidden /> Camera
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            The browser will ask for camera permission when you turn the preview on. Your camera only activates for the class after you press Join — and only if you keep it on.
          </p>
          <div className="mt-3 aspect-video overflow-hidden rounded-lg border border-border bg-elevated">
            {previewOn ? (
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full scale-x-[-1] object-cover" aria-label="Camera preview" />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <CameraOff className="h-8 w-8" aria-hidden />
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-border text-muted-foreground hover:bg-elevated"
            onClick={() => (previewOn ? stopPreview() : void startPreview())}
          >
            {previewOn ? <CameraOff className="mr-1.5 h-4 w-4" /> : <Camera className="mr-1.5 h-4 w-4" />}
            {previewOn ? 'Turn preview off' : 'Turn camera preview on'}
          </Button>
        </div>

        {/* Microphone test (explicit opt-in) */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
            <Mic className="h-4 w-4 text-gold" aria-hidden /> Microphone
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Speak normally after starting the test — the meter should move. You can stay muted for the whole class and use chat-free participation.
          </p>
          <div className="mt-4 h-3 overflow-hidden rounded-full border border-border bg-elevated">
            <div
              className={cn('h-full rounded-full transition-all', micLevel > 8 ? 'bg-gold' : 'bg-muted-foreground/30')}
              style={{ width: `${micLevel}%` }}
              aria-hidden
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground" aria-live="polite">
            {micTestOn ? (micLevel > 8 ? 'We can hear you.' : 'Waiting for sound…') : 'Microphone test is off.'}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-border text-muted-foreground hover:bg-elevated"
            onClick={() => (micTestOn ? stopMicTest() : void startMicTest())}
          >
            {micTestOn ? <MicOff className="mr-1.5 h-4 w-4" /> : <Mic className="mr-1.5 h-4 w-4" />}
            {micTestOn ? 'Stop microphone test' : 'Test microphone'}
          </Button>
        </div>
      </div>

      {previewError && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {previewError}
        </p>
      )}

      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-semibold text-foreground">Devices detected</h2>
        <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
          {devices.length === 0 ? (
            <li>No devices listed yet — allow a permission above to see names (a browser privacy rule).</li>
          ) : (
            devices.map((d) => (
              <li key={`${d.kind}-${d.deviceId}`} className="flex items-center gap-1.5">
                {d.kind === 'videoinput' ? <Video className="h-3 w-3 shrink-0" aria-hidden /> : <Mic className="h-3 w-3 shrink-0" aria-hidden />}
                {d.label}
              </li>
            ))
          )}
        </ul>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          Entry is server-authorised from your BEAN booking. No class media is recorded — this classroom is live-only.
        </p>
      </div>

      {joinError && (
        <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {joinError}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button
          className="flex-1 bg-gold text-primary-foreground hover:bg-gold-hover"
          disabled={joining}
          onClick={onJoin}
        >
          {joining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Signal className="mr-2 h-4 w-4" />}
          {joining ? 'Connecting…' : role === 'TEACHER' ? 'Enter your classroom' : 'Join live classroom'}
        </Button>
        <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={onBack}>
          <MonitorX className="mr-1.5 h-4 w-4" /> Not now
        </Button>
      </div>
    </div>
  )
}

export function ClassroomErrorState({ title, description, onBack }: { title: string; description: string; onBack: () => void }) {
  const navigate = useAppStore((s) => s.navigate)
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <GraduationCap className="mb-4 h-10 w-10 text-gold" aria-hidden />
      <h1 className="font-display text-xl font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => { onBack(); navigate({ view: 'classes' }) }}>
        Back to classes
      </Button>
    </div>
  )
}

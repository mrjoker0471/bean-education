'use client'

// ─── BEAN Live Classroom (Phase 5): control bar & connection status ───────────
// BEAN-styled controls over real LiveKit actions. Screen share is rendered
// ONLY for teachers (students already lack the publish grant server-side —
// hiding the button is convenience, not security).

import { Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX, Hand, Users, PhoneOff, Wifi, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ClassroomConnection, ClassroomParticipant } from './use-live-classroom'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const CONNECTION_LABELS: Record<ClassroomConnection, { label: string; tone: 'live' | 'warn' | 'bad' | 'muted' }> = {
  IDLE: { label: 'Not connected', tone: 'muted' },
  CONNECTING: { label: 'Connecting…', tone: 'warn' },
  CONNECTED: { label: 'Connected', tone: 'live' },
  RECONNECTING: { label: 'Reconnecting…', tone: 'warn' },
  DISCONNECTED: { label: 'Disconnected', tone: 'bad' },
  CONNECTION_FAILED: { label: 'Connection failed', tone: 'bad' },
  SESSION_ENDED: { label: 'Class ended', tone: 'muted' },
}

export function ConnectionStatus({ connection }: { connection: ClassroomConnection }) {
  const { label, tone } = CONNECTION_LABELS[connection]
  const Icon = tone === 'live' ? Wifi : tone === 'muted' ? WifiOff : WifiOff
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
        tone === 'live' && 'border-success/40 bg-success/10 text-success',
        tone === 'warn' && 'border-gold/40 bg-gold/10 text-gold',
        tone === 'bad' && 'border-destructive/40 bg-destructive/10 text-destructive',
        tone === 'muted' && 'border-border bg-elevated text-muted-foreground',
      )}
      aria-live="polite"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  )
}

function DeviceSelector({
  devices,
  value,
  onChange,
  label,
  icon,
}: {
  devices: MediaDeviceInfoLite[]
  value: string
  onChange: (deviceId: string) => void
  label: string
  icon: React.ReactNode
}) {
  if (devices.length === 0) return null
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-8 w-[180px] border-border bg-card text-xs text-muted-foreground" aria-label={label}>
        {icon}
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className="border-border bg-card">
        {devices.map((d) => (
          <SelectItem key={d.deviceId} value={d.deviceId} className="text-xs">
            {d.label.slice(0, 32)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface MediaDeviceInfoLite {
  deviceId: string
  kind: MediaDeviceKind
  label: string
}

export function ClassroomControlBar({
  connection,
  micEnabled,
  camEnabled,
  screenSharing,
  handRaised,
  isTeacher,
  boardOpen,
  participantsOpen,
  micDevices,
  camDevices,
  activeMicDevice,
  activeCamDevice,
  onToggleMic,
  onToggleCam,
  onToggleScreenShare,
  onToggleHand,
  onToggleBoard,
  onToggleParticipants,
  onSwitchMic,
  onSwitchCam,
  onLeave,
  leaveLabel,
}: {
  connection: ClassroomConnection
  micEnabled: boolean
  camEnabled: boolean
  screenSharing: boolean
  handRaised: boolean
  isTeacher: boolean
  boardOpen: boolean
  participantsOpen: boolean
  micDevices: MediaDeviceInfoLite[]
  camDevices: MediaDeviceInfoLite[]
  activeMicDevice: string
  activeCamDevice: string
  onToggleMic: () => void
  onToggleCam: () => void
  onToggleScreenShare: () => void
  onToggleHand: () => void
  onToggleBoard: () => void
  onToggleParticipants: () => void
  onSwitchMic: (deviceId: string) => void
  onSwitchCam: (deviceId: string) => void
  onLeave: () => void
  leaveLabel: string
}) {
  const connected = connection === 'CONNECTED'
  const iconBtn = (active: boolean, destructive?: boolean) =>
    cn(
      'h-10 w-10 rounded-lg border p-0',
      destructive
        ? 'border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20'
        : active
          ? 'border-gold/50 bg-gold/15 text-gold hover:bg-gold/25'
          : 'border-border bg-card text-muted-foreground hover:bg-elevated hover:text-foreground',
    )

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-between">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            className={iconBtn(micEnabled, !micEnabled && connected)}
            onClick={onToggleMic}
            disabled={!connected}
            aria-pressed={micEnabled}
            aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
            title={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            {micEnabled ? <Mic className="h-4 w-4" aria-hidden /> : <MicOff className="h-4 w-4" aria-hidden />}
          </Button>
          <Button
            className={iconBtn(camEnabled, !camEnabled && connected)}
            onClick={onToggleCam}
            disabled={!connected}
            aria-pressed={camEnabled}
            aria-label={camEnabled ? 'Turn camera off' : 'Turn camera on'}
            title={camEnabled ? 'Turn camera off' : 'Turn camera on'}
          >
            {camEnabled ? <Video className="h-4 w-4" aria-hidden /> : <VideoOff className="h-4 w-4" aria-hidden />}
          </Button>
          {isTeacher && (
            <Button
              className={iconBtn(screenSharing)}
              onClick={onToggleScreenShare}
              disabled={!connected}
              aria-pressed={screenSharing}
              aria-label={screenSharing ? 'Stop screen share' : 'Share your screen (teacher only)'}
              title={screenSharing ? 'Stop screen share' : 'Share your screen'}
            >
              {screenSharing ? <MonitorX className="h-4 w-4" aria-hidden /> : <MonitorUp className="h-4 w-4" aria-hidden />}
            </Button>
          )}
          <Button
            className={iconBtn(handRaised)}
            onClick={onToggleHand}
            disabled={!connected}
            aria-pressed={handRaised}
            aria-label={handRaised ? 'Lower hand' : 'Raise hand'}
            title={handRaised ? 'Lower hand' : 'Raise hand'}
          >
            <Hand className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          <DeviceSelector
            devices={micDevices}
            value={activeMicDevice}
            onChange={onSwitchMic}
            label="Microphone"
            icon={<Mic className="h-3.5 w-3.5 text-gold" aria-hidden />}
          />
          <DeviceSelector
            devices={camDevices}
            value={activeCamDevice}
            onChange={onSwitchCam}
            label="Camera"
            icon={<Video className="h-3.5 w-3.5 text-gold" aria-hidden />}
          />
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button
            className={cn(iconBtn(boardOpen))}
            onClick={onToggleBoard}
            aria-pressed={boardOpen}
            aria-label={boardOpen ? 'Hide whiteboard' : 'Show whiteboard'}
            title={boardOpen ? 'Hide whiteboard' : 'Show whiteboard'}
          >
            <span className="flex h-4 w-4 items-center justify-center rounded-[3px] border border-current text-[9px] font-bold" aria-hidden>WB</span>
          </Button>
          <Button
            className={cn(iconBtn(participantsOpen))}
            onClick={onToggleParticipants}
            aria-pressed={participantsOpen}
            aria-label={participantsOpen ? 'Hide participants' : 'Show participants'}
            title={participantsOpen ? 'Hide participants' : 'Show participants'}
          >
            <Users className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            className="h-10 rounded-lg border border-destructive/50 bg-destructive px-3 text-sm font-medium text-white hover:bg-destructive/90"
            onClick={onLeave}
            aria-label={leaveLabel}
          >
            <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden />
            {leaveLabel}
          </Button>
        </div>
      </div>
      <p className="text-center text-[11px] text-muted-foreground sm:text-left">
        Live only — nothing in this classroom is recorded. Screen sharing is a teacher tool.
      </p>
    </div>
  )
}

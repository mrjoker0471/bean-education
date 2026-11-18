'use client'

// ─── BEAN Live Classroom (Phase 5): participant panel ─────────────────────────
// Lists everyone in the room with their state. Teacher-only moderation (mute
// audio / remove with a mandatory reason) calls the BEAN server, which audits
// every action and re-checks ownership — the panel is never the authority.

import { useState } from 'react'
import { GraduationCap, Hand, MicOff, MoreVertical, ShieldAlert, UserMinus, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ClassroomParticipant } from './use-live-classroom'
import { MODERATION_REASON_MAX } from '@/lib/livekit/live'

export function ParticipantPanel({
  participants,
  isTeacher,
  onMute,
  onRemove,
}: {
  participants: ClassroomParticipant[]
  isTeacher: boolean
  onMute: (identity: string) => Promise<boolean>
  onRemove: (identity: string, reason: string) => Promise<boolean>
}) {
  const [target, setTarget] = useState<ClassroomParticipant | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const confirmRemove = async () => {
    if (!target) return
    setBusy(true)
    const ok = await onRemove(target.identity, reason.trim())
    setBusy(false)
    if (ok) {
      setNotice(`${target.name} was removed from the classroom.`)
      setTarget(null)
      setReason('')
    } else {
      setNotice('The removal failed on the realtime provider — try again.')
    }
  }

  const mute = async (p: ClassroomParticipant) => {
    const ok = await onMute(p.identity)
    setNotice(ok ? `${p.name} was muted.` : 'The mute failed on the realtime provider — try again.')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
        {participants.map((p) => (
          <div key={p.identity} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
                  p.role === 'TEACHER' ? 'border-gold/40 bg-gold/10 text-gold' : 'border-border bg-card text-muted-foreground',
                )}
                aria-hidden
              >
                <GraduationCap className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">
                  {p.name}
                  {p.isLocal && <span className="text-muted-foreground"> (you)</span>}
                </p>
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {p.role === 'TEACHER' && <span className="text-gold">Teacher</span>}
                  {!p.micEnabled && <span className="inline-flex items-center gap-0.5"><MicOff className="h-3 w-3" aria-hidden /> muted</span>}
                  {p.handRaised && <span className="inline-flex items-center gap-0.5 text-gold"><Hand className="h-3 w-3" aria-hidden /> hand raised</span>}
                </p>
              </div>
            </div>
            {isTeacher && !p.isLocal && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground hover:bg-elevated hover:text-foreground"
                  onClick={() => void mute(p)}
                  aria-label={`Mute ${p.name}'s audio`}
                >
                  <VolumeX className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => { setTarget(p); setReason('') }}
                  aria-label={`Remove ${p.name}`}
                >
                  <MoreVertical className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {notice && <p className="text-[11px] text-muted-foreground" aria-live="polite">{notice}</p>}
      {isTeacher && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
          Mutes and removals go through the BEAN server and are permanently audited.
        </p>
      )}

      <Dialog open={!!target} onOpenChange={(open) => { if (!open) setTarget(null) }}>
        <DialogContent className="border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Remove {target?.name}?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              The student is disconnected from the live classroom immediately. Their booking and attendance record remain unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <label htmlFor="removal-reason" className="text-xs text-muted-foreground">Reason (required, shown in the audit trail)</label>
            <Textarea
              id="removal-reason"
              value={reason}
              maxLength={MODERATION_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. disruptive behaviour during the class"
              className="mt-1.5 min-h-[72px] border-border bg-elevated text-foreground"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border bg-transparent text-muted-foreground hover:bg-elevated" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button className="bg-destructive text-white hover:bg-destructive/90" disabled={busy || !reason.trim()} onClick={() => void confirmRemove()}>
              <UserMinus className="mr-1.5 h-4 w-4" aria-hidden /> Remove student
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function LiveCountBadge({ count }: { count: number }) {
  return (
    <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
      {count} in room
    </Badge>
  )
}

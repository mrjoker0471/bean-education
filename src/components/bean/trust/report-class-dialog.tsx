'use client'

// ─── BEAN Trust & Quality (Phase 6): report a class (private complaint) ──────
// Dialog composer over POST /api/teach/complaints. Available from booking
// rows (My bookings) and the class detail page. The server enforces the
// legitimate-relationship rule and derives severity/sensitivity — the UI
// only helps the student express the concern. Safeguarding/harassment/
// discrimination selections show priority guidance and never expose the
// student to the reported party.

import { useState } from 'react'
import { Loader2, ShieldAlert, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'

const CATEGORIES: { value: string; label: string; sensitive?: boolean }[] = [
  { value: 'TEACHING_QUALITY', label: 'Teaching quality' },
  { value: 'MISLEADING_CLASS_DESCRIPTION', label: 'Misleading class description' },
  { value: 'TEACHER_CONDUCT', label: 'Teacher conduct' },
  { value: 'STUDENT_CONDUCT', label: 'Student conduct' },
  { value: 'SAFEGUARDING', label: 'Safeguarding', sensitive: true },
  { value: 'HARASSMENT', label: 'Harassment or threats', sensitive: true },
  { value: 'DISCRIMINATION', label: 'Discrimination', sensitive: true },
  { value: 'CLASS_CANCELLATION', label: 'Class cancellation' },
  { value: 'TECHNICAL_PROBLEM', label: 'Technical problem' },
  { value: 'ATTENDANCE_DISPUTE', label: 'Attendance dispute' },
  { value: 'OTHER', label: 'Other' },
]

const SAFEGUARDING_GUIDANCE =
  'If anyone is in immediate danger, contact your local emergency services or a trusted adult right away. BEAN operators review safeguarding reports as a priority, but BEAN is not an emergency service.'

export function ReportClassDialog({
  classId,
  classTitle,
  open,
  onOpenChange,
  onFiled,
}: {
  classId: string
  classTitle: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onFiled?: () => void
}) {
  const [category, setCategory] = useState('TEACHING_QUALITY')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filed, setFiled] = useState(false)

  const sensitive = CATEGORIES.find(c => c.value === category)?.sensitive ?? false

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.fileComplaint({ category, classSessionId: classId, subject: subject.trim(), description })
      setFiled(true)
      onFiled?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file your report.')
    } finally {
      setBusy(false)
    }
  }

  const close = (v: boolean) => {
    if (!v) {
      setFiled(false)
      setSubject('')
      setDescription('')
      setError(null)
      setCategory('TEACHING_QUALITY')
    }
    onOpenChange(v)
  }

  const valid = subject.trim().length >= 8 && description.trim().length >= 30

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-border bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">Report “{classTitle}”</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Reports are confidential — only authorised BEAN administrators can read them. The teacher and other students never see your report or your identity. Reports never automatically change ratings, bookings or teacher status.
          </DialogDescription>
        </DialogHeader>

        {filed ? (
          <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success" role="status">
            Your report was filed securely. Track it any time under <strong>My reports</strong> — administrators will respond there.
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="report-category" className="text-xs text-muted-foreground">What is this report about?</Label>
              <select
                id="report-category"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="h-10 rounded-md border border-border bg-elevated px-3 text-sm text-foreground"
                aria-label="Report category"
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            {sensitive && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5">
                <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Priority handling — restricted access
                </p>
                <p className="mt-1 text-xs text-destructive/90">{SAFEGUARDING_GUIDANCE}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Only authorised administrators can open this report. Your identity is protected.
                </p>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="report-subject" className="text-xs text-muted-foreground">Subject <span className="text-muted-foreground/70">(8–120 characters)</span></Label>
              <Input
                id="report-subject"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                maxLength={120}
                className="border-border bg-elevated text-foreground"
                placeholder="Short summary of the concern"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-description" className="text-xs text-muted-foreground">
                What happened? <span className="text-muted-foreground/70">(30–4000 characters)</span>
              </Label>
              <Textarea
                id="report-description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
                maxLength={4000}
                className="border-border bg-elevated text-foreground"
                placeholder="Describe the facts: what happened, when, and anything administrators should check."
              />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" className="text-muted-foreground hover:bg-elevated" onClick={() => close(false)} disabled={busy}>
            {filed ? 'Close' : 'Cancel'}
          </Button>
          {!filed && (
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={!valid || busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldQuestion className="mr-2 h-4 w-4" aria-hidden />}
              Submit confidential report
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

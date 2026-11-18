'use client'

// ─── BEAN Teach (Phase 4A): class detail + free reservation ──────────────────
// Shows the full class description, the teacher's approved public profile
// (qualifications + experience), schedule in both the class's time zone and
// the viewer's local time, seats, minimum enrolment and booking state.
// Reservation rules mirror the server: guests get a sign-in prompt, students
// book free seats while capacity lasts, a teacher cannot book their own class,
// and the owner sees their enrolled students. Phase 5 adds the live classroom
// entry card (real, server-authorised) for seat-holders and the owner.

import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, GraduationCap, CalendarDays, Clock, Globe, Users, Signal, BadgeCheck, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { ClassroomEntryCard } from '@/components/bean/classroom/classroom-entry'
import { ReviewSection } from '@/components/bean/trust/review-section'
import { QualityLine } from '@/components/bean/trust/quality-metrics'
import { ReportClassDialog } from '@/components/bean/trust/report-class-dialog'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { TeachClassDetailDTO } from '@/lib/types'
import {
  TEACH_LEVEL_LABELS,
  bookingStatusBadgeClass,
  classEndTime,
  formatClassInZone,
  formatClassLocal,
  formatDuration,
  formatRupees,
  FREE_PILOT_PRICE_LABEL,
} from '@/components/bean/teach-format'

export function ClassDetailView({ classId }: { classId: string }) {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const [cls, setCls] = useState<TeachClassDetailDTO | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [bookingBusy, setBookingBusy] = useState(false)
  const [confirmCancelBooking, setConfirmCancelBooking] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const load = useCallback(() => {
    setCls(null)
    api.teachClass(classId)
      .then(res => { setCls(res.class); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load this class.'))
  }, [classId])

  useEffect(() => { load() }, [load])

  if (failed) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <EmptyState icon={GraduationCap} title="Could not open this class" description={failed} actionLabel="Back to classes" onAction={() => navigate({ view: 'classes' })} />
      </div>
    )
  }
  if (!cls) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading class">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  const started = new Date(cls.startsAt).getTime() <= Date.now()
  const ended = classEndTime(cls.startsAt, cls.durationMinutes).getTime() <= Date.now()
  const isCancelled = cls.status === 'CANCELLED'
  const isFull = cls.availableSeats <= 0
  const myBooking = cls.myBooking
  const holdsSeat = !!myBooking && myBooking.status !== 'CANCELLED' && !isCancelled

  const reserve = async () => {
    if (!authedStudent) {
      navigate({ view: 'auth' })
      return
    }
    setBookingBusy(true)
    try {
      await api.teachBook(cls.id)
      load()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not reserve your seat.')
      setCls(null)
    } finally {
      setBookingBusy(false)
    }
  }

  const release = async () => {
    setBookingBusy(true)
    try {
      await api.teachCancelBooking(cls.id)
      setConfirmCancelBooking(false)
      load()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not cancel the reservation.')
      setCls(null)
    } finally {
      setBookingBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'classes' })}>
        <ArrowLeft className="mr-1.5 h-4 w-4" /> Return to classes
      </Button>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-gold/40 text-gold">{cls.subject}</Badge>
            <Badge variant="outline" className="border-border text-muted-foreground">{TEACH_LEVEL_LABELS[cls.targetLevel] ?? cls.targetLevel}</Badge>
            <Badge variant="outline" className="border-border text-muted-foreground">{cls.language}</Badge>
            {isCancelled && <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Cancelled</Badge>}
            {cls.status === 'COMPLETED' && <Badge variant="outline" className="border-border text-muted-foreground">Completed</Badge>}
            {!isCancelled && cls.status === 'PUBLISHED' && !ended && (
              <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Free pilot</Badge>
            )}
          </div>
          <h1 className="mt-3 font-display text-2xl font-semibold text-foreground sm:text-3xl">{cls.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Taught by {cls.teacher.teachingName}{cls.teacherVerified ? ' · verified teacher' : ''}</p>
        </div>
        {cls.isOwner && (
          <Button size="sm" className="shrink-0 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'teach-dashboard' })}>
            Manage in Teacher Dashboard
          </Button>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold text-foreground">About this class</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{cls.description}</p>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold text-foreground">About the teacher</h2>
            <div className="mt-3 flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
                <GraduationCap className="h-5 w-5 text-gold" aria-hidden />
              </div>
              <div>
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  {cls.teacher.teachingName}
                  {cls.teacherVerified && <BadgeCheck className="h-4 w-4 text-success" aria-label="Approved teacher" />}
                </p>
                <p className="text-xs text-muted-foreground">{cls.teacher.headline}</p>
                {/* Phase 6: verified quality indicators (server-computed). */}
                <QualityLine quality={cls.teacherQuality} />
              </div>
            </div>
            <Separator className="my-4 bg-border" />
            <dl className="grid gap-2 text-sm">
              <div className="flex gap-2">
                <dt className="w-36 shrink-0 text-muted-foreground">Qualifications</dt>
                <dd className="text-foreground">{cls.teacherQualifications}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-36 shrink-0 text-muted-foreground">Experience</dt>
                <dd className="text-foreground">{cls.teacherExperienceYears} year{cls.teacherExperienceYears === 1 ? '' : 's'} of teaching or professional experience</dd>
              </div>
            </dl>
          </section>

          {cls.isOwner && cls.ownerBookings.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="font-display text-lg font-semibold text-foreground">Enrolled students ({cls.ownerBookings.filter(b => b.status !== 'CANCELLED').length})</h2>
              <div className="mt-3 flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
                {cls.ownerBookings.map(b => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg border border-border bg-elevated px-3 py-2 text-sm">
                    <span className="text-foreground">{b.studentName ?? 'Student'}</span>
                    <Badge variant="outline" className={bookingStatusBadgeClass(b.status)}>{b.status.replace('_', ' ')}</Badge>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">Attendance marking lives in your Teacher Dashboard once the class has ended.</p>
            </section>
          )}
        </div>

        {/* Booking panel */}
        <aside className="lg:col-span-1">
          <div className="rounded-xl border border-border bg-card p-5 lg:sticky lg:top-24">
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5 text-gold" aria-hidden /> Your local time</dt>
                <dd className="mt-1 font-medium text-foreground">{formatClassLocal(cls.startsAt)}</dd>
                <dd className="mt-0.5 text-xs text-muted-foreground">{formatClassInZone(cls.startsAt, cls.timeZone)} (class time zone)</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-muted-foreground"><Clock className="h-3.5 w-3.5 text-gold" aria-hidden />Duration</dt>
                <dd className="text-foreground">{formatDuration(cls.durationMinutes)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-muted-foreground"><Users className="h-3.5 w-3.5 text-gold" aria-hidden />Seats</dt>
                <dd className="text-foreground">{isCancelled ? '—' : `${cls.availableSeats} of ${cls.capacity} available`}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-muted-foreground"><Signal className="h-3.5 w-3.5 text-gold" aria-hidden />Minimum class</dt>
                <dd className="text-foreground">{cls.minimumStudents} student{cls.minimumStudents === 1 ? '' : 's'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Price</dt>
                <dd className="text-foreground">{cls.plannedPricePaise > 0 ? `${formatRupees(cls.plannedPricePaise)} planned` : 'Free pilot'}</dd>
              </div>
            </dl>

            {cls.plannedPricePaise > 0 && (
              <p className="mt-3 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-[11px] text-gold">{FREE_PILOT_PRICE_LABEL}</p>
            )}

            <div className="mt-4">
              {/* Live classroom entry — real, server-authorised (Phase 5). */}
              {(holdsSeat || cls.isOwner) && (
                <ClassroomEntryCard classId={cls.id} isOwner={cls.isOwner} />
              )}

              {isCancelled ? (
                <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">This class was cancelled{holdsSeat ? ' — your reservation was released automatically' : ''}.</p>
              ) : holdsSeat ? (
                <div className="mt-4 flex flex-col gap-2">
                  <p className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
                    <BadgeCheck className="h-4 w-4" aria-hidden /> Your seat is reserved{myBooking.status !== 'CONFIRMED' ? ` · ${myBooking.status.replace('_', ' ')}` : ''}
                  </p>
                  {!started && (
                    <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setConfirmCancelBooking(true)}>
                      Cancel reservation
                    </Button>
                  )}
                </div>
              ) : cls.isOwner ? (
                <p className="mt-4 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-muted-foreground">This is your own class — manage it from the Teacher Dashboard.</p>
              ) : (
                <>
                  {!authedStudent && (
                    <p className="mt-4 flex items-start gap-1.5 rounded-lg border border-border bg-elevated px-3 py-2 text-xs text-muted-foreground">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
                      Sign in to reserve your free seat — guest browsing stays available.
                    </p>
                  )}
                  <Button
                    className="mt-3 w-full bg-gold text-primary-foreground hover:bg-gold-hover"
                    disabled={bookingBusy || started || isFull || cls.status !== 'PUBLISHED'}
                    onClick={() => void reserve()}
                  >
                    {bookingBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {started ? 'Class already started' : isFull ? 'Class is full' : cls.status !== 'PUBLISHED' ? 'Not open for booking' : authedStudent ? 'Reserve your seat — free' : 'Sign in to reserve'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Phase 6: verified reviews + report action (additive section). */}
      <div className="mt-6 grid gap-6">
        <ReviewSection classId={cls.id} isOwnerTeacher={cls.isOwner} />
        {!cls.isOwner && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
            <p className="text-xs text-muted-foreground">
              Something wrong with this class or its teacher? Reports are confidential — only authorised BEAN administrators read them, and the teacher never sees who reported.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-border text-muted-foreground hover:bg-elevated"
              onClick={() => (authedStudent ? setReportOpen(true) : navigate({ view: 'auth' }))}
            >
              <ShieldAlert className="mr-1.5 h-3.5 w-3.5" aria-hidden />Report a concern
            </Button>
          </div>
        )}
      </div>

      <ReportClassDialog
        classId={cls.id}
        classTitle={cls.title}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />

      <AlertDialog open={confirmCancelBooking} onOpenChange={setConfirmCancelBooking}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Cancel this reservation?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Your free seat in “{cls.title}” will be released for another student. You can rebook later if seats remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bookingBusy} className="border-border bg-transparent text-muted-foreground hover:bg-elevated">Keep seat</AlertDialogCancel>
            <AlertDialogAction disabled={bookingBusy} className="bg-destructive text-white hover:bg-destructive/90" onClick={e => { e.preventDefault(); void release() }}>
              {bookingBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Cancel reservation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

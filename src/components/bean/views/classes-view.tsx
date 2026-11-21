'use client'

// ─── BEAN Teach (Phase 4A): student classes marketplace ──────────────────────
// Public browsing for guests AND signed-in students (guest mode is preserved —
// reservation just asks for a sign-in at the moment of intent). Two tabs:
//   • Browse — filterable, searchable, paginated marketplace of free pilot classes
//   • My bookings — the signed-in student's own reservations + attendance status
// A signed-in student also gets the teacher pathway CTA ("Become a BEAN
// Teacher" / pending status / Teacher Dashboard) and admins get Teacher Review.
// Styling reuses the existing obsidian/champagne tokens and shadcn components —
// no new design system.

import { useEffect, useMemo, useState } from 'react'
import { Loader2, GraduationCap, Search, ChevronLeft, ChevronRight, CalendarDays, Clock, Users, Globe, BookMarked, Signal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ReportClassDialog } from '@/components/bean/trust/report-class-dialog'
import { ShieldQuestion } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { BookingLiveBadge } from '@/components/bean/classroom/classroom-entry'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { MyBookingDTO, PublicClassDTO, TeachApplicationDTO } from '@/lib/types'
import {
  TEACH_LEVEL_OPTIONS,
  TEACH_LEVEL_LABELS,
  bookingStatusBadgeClass,
  formatClassLocal,
  formatDuration,
  formatRupees,
  FREE_PILOT_PRICE_LABEL,
} from '@/components/bean/teach-format'

const SUBJECT_FILTERS = ['Mathematics', 'Science', 'English', 'Coding', 'Accounts', 'Economics', 'History', 'Geography']
const LANGUAGE_FILTERS = ['English', 'Hindi', 'Bengali', 'Tamil', 'Telugu', 'Marathi']
const DURATION_FILTERS = [
  { value: 'SHORT', label: 'Short (1–1.5h)' },
  { value: 'MEDIUM', label: 'Medium (2–3h)' },
  { value: 'LONG', label: 'Long (3.5–6h)' },
]

export function ClassesView({ initialTab }: { initialTab?: 'browse' | 'bookings' }) {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const [tab, setTab] = useState<'browse' | 'bookings'>(initialTab ?? 'browse')
  const [application, setApplication] = useState<TeachApplicationDTO | null>(null)

  useEffect(() => {
    if (!authedStudent) return
    let cancelled = false
    api.teachApplication().then(res => {
      if (!cancelled) setApplication(res.application)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [authedStudent, tab])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Teach</p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Classes</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Discover verified teachers and reserve a free seat in upcoming live classes. Every class in this release is a free pilot — nothing is ever charged.
          </p>
        </div>
        <TeacherPathwayCta application={application} navigate={navigate} />
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as 'browse' | 'bookings')} className="mt-6">
        <TabsList className="bg-elevated">
          <TabsTrigger value="browse">Browse classes</TabsTrigger>
          <TabsTrigger value="bookings">My bookings</TabsTrigger>
        </TabsList>
        <TabsContent value="browse" className="mt-4">
          <BrowsePanel signedIn={!!authedStudent} navigate={navigate} />
        </TabsContent>
        <TabsContent value="bookings" className="mt-4">
          <MyBookingsPanel navigate={navigate} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Signed-in teacher-pathway CTA (application status aware). Guests see nothing here. */
function TeacherPathwayCta({
  application,
  navigate,
}: {
  application: TeachApplicationDTO | null
  navigate: (route: ReturnType<typeof useAppStore.getState>['route']) => void
}) {
  const authedStudent = useAppStore(s => s.authedStudent)
  const isAdmin = authedStudent?.role === 'ADMIN'
  if (!authedStudent) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isAdmin && (
        <Button variant="outline" size="sm" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'teach-review' })}>
          Teacher Review
        </Button>
      )}
      {application?.status === 'APPROVED' ? (
        <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'teach-dashboard' })}>
          Teacher Dashboard
        </Button>
      ) : application?.status === 'PENDING' ? (
        <Badge variant="outline" className="border-gold/40 text-gold">Application under review</Badge>
      ) : (
        <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'teach-apply' })}>
          Become a BEAN Teacher
        </Button>
      )}
    </div>
  )
}

interface Filters {
  q: string
  subject: string
  level: string
  language: string
  duration: string
  teacher: string
  date: string // YYYY-MM-DD
}

function BrowsePanel({ signedIn, navigate }: { signedIn: boolean; navigate: (route: ReturnType<typeof useAppStore.getState>['route']) => void }) {
  const [filters, setFilters] = useState<Filters>({ q: '', subject: '', level: '', language: '', duration: '', teacher: '', date: '' })
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ classes: PublicClassDTO[]; total: number; pageSize: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Debounced fetch — keeps bounded request sizes and a calm UI.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      setLoading(true)
      const from = filters.date ? new Date(`${filters.date}T00:00:00`).toISOString() : undefined
      const to = filters.date ? new Date(`${filters.date}T23:59:59.999`).toISOString() : undefined
      api
        .teachClasses({
          q: filters.q || undefined,
          subject: filters.subject || undefined,
          level: filters.level || undefined,
          language: filters.language || undefined,
          duration: (filters.duration || undefined) as 'SHORT' | 'MEDIUM' | 'LONG' | undefined,
          teacher: filters.teacher || undefined,
          from,
          to,
          page,
        })
        .then(res => {
          if (!cancelled) {
            setData({ classes: res.classes, total: res.total, pageSize: res.pageSize })
            setFailed(null)
            setLoading(false)
          }
        })
        .catch(e => {
          if (!cancelled) {
            setFailed(e instanceof Error ? e.message : 'Could not load classes.')
            setLoading(false)
          }
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [filters, page])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const activeFilters = useMemo(() => Object.values(filters).filter(Boolean).length, [filters])

  return (
    <div className="flex flex-col gap-4">
      {/* Search + filter bar (existing input/select styling) */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={filters.q}
              onChange={e => { setFilters(f => ({ ...f, q: e.target.value })); setPage(1) }}
              placeholder="Search classes, subjects or teachers"
              className="pl-9"
              aria-label="Search classes"
            />
          </div>
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => { setFilters({ q: '', subject: '', level: '', language: '', duration: '', teacher: '', date: '' }); setPage(1) }}>
              <X className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Select value={filters.subject} onValueChange={v => { setFilters(f => ({ ...f, subject: v === 'all' ? '' : v })); setPage(1) }}>
            <SelectTrigger aria-label="Filter by subject"><SelectValue placeholder="Subject" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {SUBJECT_FILTERS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.level} onValueChange={v => { setFilters(f => ({ ...f, level: v === 'all' ? '' : v })); setPage(1) }}>
            <SelectTrigger aria-label="Filter by level"><SelectValue placeholder="Level" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {TEACH_LEVEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.language} onValueChange={v => { setFilters(f => ({ ...f, language: v === 'all' ? '' : v })); setPage(1) }}>
            <SelectTrigger aria-label="Filter by language"><SelectValue placeholder="Language" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {LANGUAGE_FILTERS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.duration} onValueChange={v => { setFilters(f => ({ ...f, duration: v === 'all' ? '' : v })); setPage(1) }}>
            <SelectTrigger aria-label="Filter by duration"><SelectValue placeholder="Duration" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any duration</SelectItem>
              {DURATION_FILTERS.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={filters.date}
            onChange={e => { setFilters(f => ({ ...f, date: e.target.value })); setPage(1) }}
            aria-label="Filter by date"
            className="[color-scheme:dark]"
          />
          <Input
            value={filters.teacher}
            onChange={e => { setFilters(f => ({ ...f, teacher: e.target.value })); setPage(1) }}
            placeholder="Teacher"
            aria-label="Filter by teacher"
          />
        </div>
      </div>

      {loading && !data ? (
        <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading classes">
          <Loader2 className="h-6 w-6 animate-spin text-gold" />
        </div>
      ) : failed ? (
        <EmptyState icon={GraduationCap} title="Could not load classes" description={failed} actionLabel="Try again" onAction={() => setFilters(f => ({ ...f }))} />
      ) : !data || data.classes.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={activeFilters ? 'No classes match these filters' : 'No classes yet'}
          description={
            activeFilters
              ? 'Try widening your filters — new free pilot classes appear here as soon as teachers publish them.'
              : 'The marketplace is just opening. As soon as an approved teacher publishes a class, it will appear here.'
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground" role="status">
            {data.total} class{data.total === 1 ? '' : 'es'} found{loading ? ' — updating…' : ''}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.classes.map(c => <ClassCard key={c.id} cls={c} onOpen={() => navigate({ view: 'class', classId: c.id })} />)}
          </div>
          <div className="flex items-center justify-between pt-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </>
      )}
      {!signedIn && (
        <p className="text-center text-xs text-muted-foreground">Browsing as a guest — you will be asked to sign in only when reserving a seat.</p>
      )}
    </div>
  )
}

function ClassCard({ cls, onOpen }: { cls: PublicClassDTO; onOpen: () => void }) {
  const full = cls.availableSeats <= 0
  return (
    <button
      type="button"
      onClick={onOpen}
      className="exam-card-hover flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40"
      aria-label={`Open class: ${cls.title}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Badge variant="outline" className="border-gold/40 text-gold">{cls.subject}</Badge>
        {full ? (
          <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">Full</Badge>
        ) : (
          <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Free pilot</Badge>
        )}
      </div>
      <h3 className="mt-3 font-display text-base font-semibold leading-snug text-foreground">{cls.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">by {cls.teacher.teachingName}</p>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-gold" aria-hidden />{formatClassLocal(cls.startsAt)}</span>
        <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-gold" aria-hidden />{formatDuration(cls.durationMinutes)}</span>
        <span className="flex items-center gap-1.5"><BookMarked className="h-3.5 w-3.5 text-gold" aria-hidden />{TEACH_LEVEL_LABELS[cls.targetLevel] ?? cls.targetLevel}</span>
        <span className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-gold" aria-hidden />{cls.language}</span>
        <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-gold" aria-hidden />{cls.availableSeats}/{cls.capacity} seats</span>
        <span className="flex items-center gap-1.5"><Signal className="h-3.5 w-3.5 text-gold" aria-hidden />min {cls.minimumStudents}</span>
      </div>
      {cls.plannedPricePaise > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {formatRupees(cls.plannedPricePaise)} — {FREE_PILOT_PRICE_LABEL}
        </p>
      )}
    </button>
  )
}

function MyBookingsPanel({ navigate }: { navigate: (route: ReturnType<typeof useAppStore.getState>['route']) => void }) {
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const [bookings, setBookings] = useState<MyBookingDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<MyBookingDTO | null>(null)
  const [reporting, setReporting] = useState<MyBookingDTO | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setBookings(null)
    api.teachMyBookings()
      .then(res => { setBookings(res.bookings); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your bookings.'))
  }

  useEffect(() => {
    if (!authChecked) return
    if (!authedStudent) return
    load()
  }, [authChecked, authedStudent])

  if (!authChecked) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
        <CalendarDays className="mb-4 h-10 w-10 text-gold" />
        <h2 className="font-display text-xl font-semibold text-foreground">Your reservations live with your account</h2>
        <p className="mt-2 text-sm text-muted-foreground">Sign in to see upcoming, completed and cancelled reservations. Guest browsing stays available everywhere else.</p>
        <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>Sign in</Button>
      </div>
    )
  }
  if (bookings === null && !failed) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading bookings"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (failed) {
    return <EmptyState icon={CalendarDays} title="Could not load your bookings" description={failed} actionLabel="Try again" onAction={load} />
  }
  const list = bookings ?? []
  if (list.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No reservations yet"
        description="Browse the marketplace and reserve a free seat in an upcoming class — reservations are always free during the pilot."
        actionLabel="Browse classes"
        onAction={() => navigate({ view: 'classes' })}
      />
    )
  }

  const now = Date.now()
  const upcoming = list.filter(b => b.status === 'CONFIRMED' && new Date(b.classSession.startsAt).getTime() > now && b.classSession.status !== 'CANCELLED')
  const past = list.filter(b => (b.status === 'ATTENDED' || b.status === 'NO_SHOW') || (b.status === 'CONFIRMED' && new Date(b.classSession.startsAt).getTime() <= now))
  const cancelled = list.filter(b => b.status === 'CANCELLED' || b.classSession.status === 'CANCELLED')

  const doCancel = async () => {
    if (!cancelling) return
    setBusy(true)
    try {
      await api.teachCancelBooking(cancelling.classSession.id)
      setCancelling(null)
      load()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not cancel the reservation.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Phase 6: confidential reporting entry + own reports tracker. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">
          Had a problem with a class? File a confidential report — only authorised BEAN administrators read reports, and the other party never sees your identity.
        </p>
        <Button size="sm" variant="outline" className="shrink-0 border-border text-muted-foreground hover:bg-elevated" onClick={() => navigate({ view: 'my-reports' })}>
          <ShieldQuestion className="mr-1.5 h-3.5 w-3.5" aria-hidden />My reports &amp; appeals
        </Button>
      </div>

      <BookingGroup title="Upcoming reservations" empty="No upcoming reservations." bookings={upcoming} onCancel={setCancelling} onReport={setReporting} navigate={navigate} />
      <BookingGroup title="Completed sessions" empty="Completed sessions with attendance will appear here." bookings={past} onCancel={setCancelling} onReport={setReporting} navigate={navigate} />
      <BookingGroup title="Cancelled" empty="Nothing cancelled." bookings={cancelled} onCancel={setCancelling} onReport={setReporting} navigate={navigate} />

      {reporting && (
        <ReportClassDialog
          classId={reporting.classSession.id}
          classTitle={reporting.classSession.title}
          open={!!reporting}
          onOpenChange={v => !v && setReporting(null)}
        />
      )}

      <AlertDialog open={!!cancelling} onOpenChange={open => !open && setCancelling(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Cancel this reservation?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {cancelling && `Your free seat in “${cancelling.classSession.title}” will be released for another student. You can rebook later if seats remain.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} className="border-border bg-transparent text-muted-foreground hover:bg-elevated">Keep seat</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-destructive text-white hover:bg-destructive/90" onClick={e => { e.preventDefault(); void doCancel() }}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Cancel reservation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function BookingGroup({
  title,
  empty,
  bookings,
  onCancel,
  onReport,
  navigate,
}: {
  title: string
  empty: string
  bookings: MyBookingDTO[]
  onCancel: (b: MyBookingDTO) => void
  onReport: (b: MyBookingDTO) => void
  navigate: (route: ReturnType<typeof useAppStore.getState>['route']) => void
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {bookings.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {bookings.map(b => (
            <div key={b.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <button type="button" className="font-medium text-foreground hover:text-gold" onClick={() => navigate({ view: 'class', classId: b.classSession.id })}>
                  {b.classSession.title}
                </button>
                <p className="mt-1 text-xs text-muted-foreground">
                  {b.classSession.teacherName} · {formatClassLocal(b.classSession.startsAt)} · {formatDuration(b.classSession.durationMinutes)}
                  {b.classSession.status === 'CANCELLED' ? ' · class cancelled by teacher' : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* Phase 5: live state (Scheduled / Live now / Completed) with the
                    join action only when the server says this seat is eligible. */}
                {b.classSession.status !== 'CANCELLED' && (
                  <BookingLiveBadge classId={b.classSession.id} />
                )}
                <Badge variant="outline" className={bookingStatusBadgeClass(b.status)}>{b.status.replace('_', ' ')}</Badge>
                {b.status === 'CONFIRMED' && b.classSession.status !== 'CANCELLED' && new Date(b.classSession.startsAt).getTime() > Date.now() && (
                  <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => onCancel(b)}>
                    Cancel
                  </Button>
                )}
                {/* Phase 6: confidential report entry for any booking history. */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:bg-elevated"
                  aria-label={`Report a concern about ${b.classSession.title}`}
                  onClick={() => onReport(b)}
                >
                  <ShieldQuestion className="mr-1 h-3.5 w-3.5" aria-hidden />Report
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

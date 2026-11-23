'use client'

// ─── BEAN Teach (Phase 4A): teacher dashboard ────────────────────────────────
// Only APPROVED teachers get past the gate (server enforces the same rule).
// Tabs:
//   • Profile — public profile view + edits (verification-relevant edits warn
//     that the profile returns to re-review and classes leave the marketplace
//     until re-approved)
//   • My classes — draft/published/upcoming/completed/cancelled list with the
//     full class lifecycle: edit draft, publish, unpublish (no held seats),
//     cancel (with confirmation + audit), and mark attendance after a class
//     has ended. Teachers only ever see and modify their OWN classes.
// New classes are created as DRAFT through the create dialog; publishing is an
// explicit, separately-confirmed action. All money fields are metadata only —
// the free pilot never charges anything.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, GraduationCap, Plus, Users, CalendarDays, Clock, Globe, Pencil, Rocket, Undo2, Ban, CheckCircle2, XCircle, Eye, EyeOff, AlertTriangle, ShieldCheck } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { TeacherClassroomIntelligencePanel } from '@/components/bean/classroom-intelligence/teacher-ci-panel'
import { TeacherLiveClassButton } from '@/components/bean/classroom/classroom-entry'
import { RatingStars } from '@/components/bean/trust/quality-metrics'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { GroupDTO, LiveEvidenceDTO, MyClassDTO, TeachApplicationDTO, TeachOwnerBookingDTO, TeacherTrustSummaryResponse } from '@/lib/types'
import {
  COMMON_TIMEZONES,
  FREE_PILOT_PRICE_LABEL,
  TEACH_LEVEL_LABELS,
  TEACH_LEVEL_OPTIONS,
  bookingStatusBadgeClass,
  classEndTime,
  formatClassInZone,
  formatClassLocal,
  formatDuration,
  formatRupees,
  guessTimeZone,
} from '@/components/bean/teach-format'

// ─────────────────────────────────────────────────────────────────────────────
// Shared class form state (create + edit dialog)
interface ClassForm {
  title: string
  description: string
  subject: string
  targetLevel: string
  language: string
  durationMinutes: string // hours + minutes assembled
  durationHours: string
  durationMinutesPart: string
  startsAtLocal: string // datetime-local value
  timeZone: string
  capacity: string
  minimumStudents: string
  plannedPriceRupees: string
  // Phase 7 — audience: PUBLIC | ORGANIZATION | GROUP (create only; an
  // existing class's audience is fixed at creation and never edited here).
  audience: string
  organizationId: string
  organizationGroupId: string
}

function emptyClassForm(): ClassForm {
  const tz = guessTimeZone()
  const fallback = COMMON_TIMEZONES.includes(tz) ? tz : 'Asia/Kolkata'
  return {
    title: '',
    description: '',
    subject: '',
    targetLevel: '',
    language: '',
    durationMinutes: '',
    durationHours: '2',
    durationMinutesPart: '0',
    startsAtLocal: '',
    timeZone: fallback,
    capacity: '10',
    minimumStudents: '1',
    plannedPriceRupees: '',
    audience: 'PUBLIC',
    organizationId: '',
    organizationGroupId: '',
  }
}

function classFormFromClass(cls: MyClassDTO): ClassForm {
  const f = emptyClassForm()
  return {
    ...f,
    title: cls.title,
    description: cls.description,
    subject: cls.subject,
    targetLevel: cls.targetLevel,
    language: cls.language,
    durationHours: String(Math.floor(cls.durationMinutes / 60)),
    durationMinutesPart: String(cls.durationMinutes % 60),
    // datetime-local wants local time; the class was scheduled in its own zone,
    // so prefill from the local rendering and let the teacher re-adjust.
    startsAtLocal: toLocalInputValue(cls.startsAt),
    timeZone: cls.timeZone,
    capacity: String(cls.capacity),
    minimumStudents: String(cls.minimumStudents),
    plannedPriceRupees: cls.plannedPricePaise > 0 ? String(cls.plannedPricePaise / 100) : '',
    // The owning org/group ids are not exposed on the teacher's own-class DTO;
    // audience is display-only while editing (the server never changes it).
    audience: cls.audience ?? 'PUBLIC',
  }
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TeacherDashboardView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const [application, setApplication] = useState<TeachApplicationDTO | null | undefined>(undefined)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    api.teachApplication()
      .then(res => { setApplication(res.application); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your teacher profile.'))
  }, [authChecked, authedStudent])

  if (!authChecked) {
    return <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!authedStudent) {
    return (
      <GatePanel
        icon={GraduationCap}
        title="Teachers sign in first"
        description="Sign in with the account that holds your approved teacher profile."
        cta="Sign in"
        onCta={() => navigate({ view: 'auth' })}
      />
    )
  }
  if (application === undefined && !failed) {
    return <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading dashboard"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (failed) {
    return <GatePanel icon={GraduationCap} title="Could not load your dashboard" description={failed} />
  }
  if (!application) {
    return (
      <GatePanel
        icon={GraduationCap}
        title="Become a BEAN Teacher first"
        description="Submit a teacher application — an administrator reviews it before classes can be created."
        cta="Apply to teach"
        onCta={() => navigate({ view: 'teach-apply' })}
      />
    )
  }
  if (application.status === 'PENDING') {
    return <GatePanel icon={GraduationCap} title="Your application is under review" description="Once an administrator approves it, your teacher dashboard unlocks here." cta="View application" onCta={() => navigate({ view: 'teach-apply' })} />
  }
  if (application.status === 'REJECTED') {
    return <GatePanel icon={GraduationCap} title="Your application was not approved" description="Correct your information and resubmit — the administrator's reason is shown on the application page." cta="Fix and resubmit" onCta={() => navigate({ view: 'teach-apply' })} />
  }

  return <DashboardPanel onProfileChanged={() => { api.teachApplication().then(res => setApplication(res.application)).catch(() => undefined) }} />
}

function GatePanel({ icon: Icon, title, description, cta, onCta }: { icon: typeof GraduationCap; title: string; description: string; cta?: string; onCta?: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <EmptyState icon={Icon} title={title} description={description} actionLabel={cta} onAction={onCta} />
    </div>
  )
}

// ─── Approved dashboard ──────────────────────────────────────────────────────

function DashboardPanel({ onProfileChanged }: { onProfileChanged: () => void }) {
  const navigate = useAppStore(s => s.navigate)
  const [classes, setClasses] = useState<MyClassDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [editing, setEditing] = useState<MyClassDTO | null>(null)
  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<MyClassDTO | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setClasses(null)
    api.teachMyClasses()
      .then(res => { setClasses(res.classes); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your classes.'))
  }, [])

  useEffect(() => { load() }, [load])

  const lifecycle = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await fn()
      toast({ title: success })
      load()
    } catch (e) {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : 'Please try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const now = Date.now()
  const upcoming = (classes ?? []).filter(c => c.status === 'PUBLISHED' && new Date(c.startsAt).getTime() > now)
  const drafts = (classes ?? []).filter(c => c.status === 'DRAFT')
  const completed = (classes ?? []).filter(c => c.status === 'COMPLETED' || (c.status === 'PUBLISHED' && classEndTime(c.startsAt, c.durationMinutes).getTime() <= now))
  const cancelled = (classes ?? []).filter(c => c.status === 'CANCELLED')

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Teach</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Teacher Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">Manage your public profile and your free pilot classes. Publishing is always explicit; students see changes immediately.</p>
        </div>
        <Button className="shrink-0 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Create class
        </Button>
      </div>

      <Tabs defaultValue="profile" className="mt-6">
        <TabsList className="bg-elevated">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="classes">My classes</TabsTrigger>
          <TabsTrigger value="trust">Trust &amp; Quality</TabsTrigger>
          <TabsTrigger value="intelligence">Classroom Intelligence</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <ProfilePanel onChanged={onProfileChanged} />
        </TabsContent>

        {/* Phase 6: Trust & Quality — verified metrics, reviews, responses,
            anonymous open-complaint count, restrictions and appeal status. */}
        <TabsContent value="trust" className="mt-4">
          <TrustPanel />
        </TabsContent>

        {/* CI-1: Classroom Intelligence — consent-gated, evidence-backed class
            evaluations. Advisory only; never modifies ratings or reviews. */}
        <TabsContent value="intelligence" className="mt-4">
          <TeacherClassroomIntelligencePanel />
        </TabsContent>

        <TabsContent value="classes" className="mt-4">
          {classes === null && !failed ? (
            <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading classes"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
          ) : failed ? (
            <EmptyState icon={CalendarDays} title="Could not load your classes" description={failed} actionLabel="Try again" onAction={load} />
          ) : (
            <div className="flex flex-col gap-6">
              <ClassGroup
                title="Drafts"
                empty="No drafts — create a class to get started."
                classes={drafts}
                busy={busy}
                onChanged={load}
                onEdit={setEditing}
                actions={c => (
                  <>
                    <Button size="sm" className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={() => void lifecycle(() => api.teachPublishClass(c.id), 'Class published')}>
                      <Rocket className="mr-1.5 h-3.5 w-3.5" /> Publish
                    </Button>
                    <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setEditing(c)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                  </>
                )}
              />
              <ClassGroup
                title="Upcoming published classes"
                empty="Nothing published yet — publish a draft so students can find it."
                classes={upcoming}
                busy={busy}
                onEdit={setEditing}
                actions={c => (
                  <>
                    <TeacherLiveClassButton classId={c.id} />
                    <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => void lifecycle(() => api.teachUnpublishClass(c.id), 'Class unpublished — it is hidden from the marketplace')}>
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Unpublish
                    </Button>
                    <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" disabled={busy} onClick={() => setCancelling(c)}>
                      <Ban className="mr-1.5 h-3.5 w-3.5" /> Cancel class
                    </Button>
                  </>
                )}
                renderBookings
                onChanged={load}
              />
              <ClassGroup
                title="Completed"
                empty="Completed classes appear here with attendance status."
                classes={completed}
                busy={busy}
                onEdit={null}
                renderBookings
                attendance
                onChanged={load}
              />
              <ClassGroup
                title="Cancelled"
                empty="Nothing cancelled."
                classes={cancelled}
                busy={busy}
                onChanged={load}
                onEdit={null}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Create a class</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Saved as a draft first — publishing is a separate, explicit step after you review the details.
            </DialogDescription>
          </DialogHeader>
          <ClassFormPanel
            submitLabel="Save draft"
            onSubmit={async payload => {
              await api.teachCreateClass(payload)
              setCreating(false)
              toast({ title: 'Draft saved' })
              load()
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Edit class</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editing?.status === 'PUBLISHED' ? 'Students can see this class now — capacity can never drop below reserved seats.' : 'Editing your draft — publish when ready.'}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <ClassFormPanel
              initial={classFormFromClass(editing)}
              submitLabel="Save changes"
              onSubmit={async payload => {
                await api.teachUpdateClass(editing.id, payload)
                setEditing(null)
                toast({ title: 'Class updated' })
                load()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel-class confirmation */}
      <AlertDialog open={!!cancelling} onOpenChange={open => !open && setCancelling(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Cancel this class?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {cancelling && `“${cancelling.title}” will be removed from the marketplace and every reserved student will see the cancellation in their bookings. This is audited.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} className="border-border bg-transparent text-muted-foreground hover:bg-elevated">Keep class</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={e => {
                e.preventDefault()
                if (!cancelling) return
                const target = cancelling
                setCancelling(null)
                void lifecycle(() => api.teachCancelClass(target.id), 'Class cancelled — reserved students were informed')
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Cancel class
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Want to step back?{' '}
        <button className="text-gold hover:underline" onClick={() => navigate({ view: 'classes' })}>Return to the classes marketplace</button>
      </p>
    </div>
  )
}

// ─── Profile tab ─────────────────────────────────────────────────────────────

function ProfilePanel({ onChanged }: { onChanged: () => void }) {
  const [app, setApp] = useState<TeachApplicationDTO | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.teachApplication().then(res => setApp(res.application)).catch(() => undefined)
  }, [])

  if (!app) {
    return <EmptyState icon={GraduationCap} title="Profile unavailable" description="Your teacher profile could not be loaded." />
  }

  const toggleVisibility = async () => {
    if (!app) return
    setBusy(true)
    try {
      await api.teachUpdateApplication({ isPublished: !app.isPublished })
      const res = await api.teachApplication()
      setApp(res.application)
      toast({ title: res.application?.isPublished ? 'Profile published to the marketplace' : 'Profile hidden from the marketplace' })
      onChanged()
    } catch (e) {
      toast({ title: 'Could not update visibility', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">{app.teachingName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{app.headline}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={app.isPublished ? 'border-success/40 bg-success/10 text-success' : 'border-border text-muted-foreground'}>
            {app.isPublished ? <><Eye className="mr-1 h-3 w-3" /> Public</> : <><EyeOff className="mr-1 h-3 w-3" /> Hidden</>}
          </Badge>
          <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => void toggleVisibility()}>
            {app.isPublished ? 'Unpublish profile' : 'Publish profile'}
          </Button>
          {!editing && (
            <Button variant="outline" size="sm" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Subjects</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">{app.subjects.map(s => <Badge key={s} variant="outline" className="border-gold/40 text-gold">{s}</Badge>)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Levels</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">{app.levels.map(l => <Badge key={l} variant="outline" className="border-border text-muted-foreground">{TEACH_LEVEL_LABELS[l] ?? l}</Badge>)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Languages</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">{app.languages.map(l => <Badge key={l} variant="outline" className="border-border text-muted-foreground">{l}</Badge>)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Experience</dt>
          <dd className="mt-1 text-foreground">{app.experienceYears} year{app.experienceYears === 1 ? '' : 's'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Biography</dt>
          <dd className="mt-1 whitespace-pre-wrap text-foreground">{app.bio}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">Qualifications</dt>
          <dd className="mt-1 whitespace-pre-wrap text-foreground">{app.qualificationsText}</dd>
        </div>
        {app.portfolioUrl && (
          <div className="sm:col-span-2">
            <dt className="text-xs uppercase tracking-wider text-muted-foreground">Portfolio</dt>
            <dd className="mt-1"><a href={app.portfolioUrl} target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">{app.portfolioUrl}</a></dd>
          </div>
        )}
      </dl>

      {editing && (
        <div className="mt-5 border-t border-border pt-5">
          <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Changing qualifications, experience, subjects, levels, languages, your teaching name or biography returns your profile to review — your classes disappear from the marketplace until an administrator re-approves you.
          </p>
          <ProfileEditForm
            app={app}
            onDone={() => { setEditing(false); api.teachApplication().then(res => setApp(res.application)).catch(() => undefined); onChanged() }}
          />
        </div>
      )}
    </section>
  )
}

function ProfileEditForm({ app, onDone }: { app: TeachApplicationDTO; onDone: () => void }) {
  const [headline, setHeadline] = useState(app.headline)
  const [bio, setBio] = useState(app.bio)
  const [subjects, setSubjects] = useState<string[]>([])
  const [languages, setLanguages] = useState<string[]>([])
  const [levels, setLevels] = useState<string[]>([])
  const [qualifications, setQualifications] = useState(app.qualificationsText)
  const [portfolio, setPortfolio] = useState(app.portfolioUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSubjects(app.subjects)
    setLanguages(app.languages)
    setLevels(app.levels)
  }, [app])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.teachUpdateApplication({ headline, bio, subjects, levels, languages, qualificationsText: qualifications, portfolioUrl: portfolio || null })
      toast({ title: 'Profile updated' })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="t-headline">Headline</Label>
        <Input id="t-headline" value={headline} onChange={e => setHeadline(e.target.value)} maxLength={120} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="t-bio">Biography</Label>
        <Textarea id="t-bio" value={bio} onChange={e => setBio(e.target.value)} rows={4} maxLength={2000} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="t-subjects">Subjects (comma-separated)</Label>
        <Input
          id="t-subjects"
          value={subjects.join(', ')}
          onChange={e => setSubjects(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="t-languages">Languages (comma-separated)</Label>
        <Input
          id="t-languages"
          value={languages.join(', ')}
          onChange={e => setLanguages(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
        />
      </div>
      <div className="grid gap-1.5">
        <Label>Education levels served</Label>
        <div className="flex flex-wrap gap-1.5">
          {TEACH_LEVEL_OPTIONS.map(o => {
            const active = levels.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setLevels(ls => (active ? ls.filter(l => l !== o.value) : [...ls, o.value]))}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${active ? 'border-gold/60 bg-gold/10 text-gold' : 'border-border text-muted-foreground hover:bg-elevated'}`}
                aria-pressed={active}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="t-quals">Qualifications</Label>
        <Textarea id="t-quals" value={qualifications} onChange={e => setQualifications(e.target.value)} rows={3} maxLength={2000} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="t-portfolio">Portfolio URL (optional)</Label>
        <Input id="t-portfolio" type="url" value={portfolio} onChange={e => setPortfolio(e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div>
        <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy} onClick={() => void save()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Save profile
        </Button>
      </div>
    </div>
  )
}

// ─── Class list groups ───────────────────────────────────────────────────────

function ClassGroup({
  title,
  empty,
  classes,
  busy,
  onEdit,
  actions,
  renderBookings,
  attendance,
  onChanged,
}: {
  title: string
  empty: string
  classes: MyClassDTO[]
  busy: boolean
  onEdit: ((c: MyClassDTO) => void) | null
  actions?: (c: MyClassDTO) => React.ReactNode
  renderBookings?: boolean
  attendance?: boolean
  onChanged: () => void
}) {
  return (
    <section>
      <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title} ({classes.length})</h2>
      {classes.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {classes.map(c => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-foreground">{c.title}</h3>
                    <Badge variant="outline" className="border-gold/40 text-gold">{c.subject}</Badge>
                    {c.plannedPricePaise > 0 && <Badge variant="outline" className="border-border text-muted-foreground">{formatRupees(c.plannedPricePaise)} planned</Badge>}
                  </div>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-gold" aria-hidden />{formatClassLocal(c.startsAt)}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-gold" aria-hidden />{formatDuration(c.durationMinutes)}</span>
                    <span className="flex items-center gap-1"><Globe className="h-3.5 w-3.5 text-gold" aria-hidden />{c.language}</span>
                    <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5 text-gold" aria-hidden />{c.bookedCount}/{c.capacity} seats · min {c.minimumStudents}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{formatClassInZone(c.startsAt, c.timeZone)} (class time zone)</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {actions?.(c)}
                  {onEdit && c.status === 'PUBLISHED' && (
                    <Button size="sm" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => onEdit(c)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                </div>
              </div>
              {renderBookings && <BookingsStrip cls={c} attendance={attendance} onChanged={onChanged} />}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function BookingsStrip({ cls, attendance, onChanged }: { cls: MyClassDTO; attendance?: boolean; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const ended = classEndTime(cls.startsAt, cls.durationMinutes).getTime() <= Date.now()
  const active = cls.bookings.filter(b => b.status !== 'CANCELLED')
  const [evidence, setEvidence] = useState<LiveEvidenceDTO[] | null>(null)

  // Verified live participation evidence (Phase 5): fetched once for the
  // attendance view. Suggestions are advisory — the teacher confirms/overrides
  // via the buttons below, exactly as before.
  useEffect(() => {
    if (!attendance || !ended) return
    let cancelled = false
    api.liveAttendanceEvidence(cls.id)
      .then(res => { if (!cancelled) setEvidence(res.attendance) })
      .catch(() => { if (!cancelled) setEvidence(null) })
    return () => { cancelled = true }
  }, [attendance, ended, cls.id])

  const mark = async (bookingId: string, status: 'ATTENDED' | 'NO_SHOW') => {
    setBusyId(bookingId)
    try {
      await api.teachMarkAttendance(cls.id, bookingId, status)
      toast({ title: status === 'ATTENDED' ? 'Marked as attended' : 'Marked as no-show' })
      onChanged()
    } catch (e) {
      toast({ title: 'Could not mark attendance', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  if (active.length === 0) {
    return <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">No students enrolled yet{cls.status === 'DRAFT' ? ' — publish the class so students can reserve seats' : ''}.</p>
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Enrolled students ({active.length})</p>
      <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto pr-1">
        {active.map(b => {
          const ev = evidence?.find(e => e.studentId === b.studentId)
          return (
            <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-sm">
              <span className="truncate text-foreground">
                {b.studentName ?? 'Student'}
                {ev && ev.totalConnectedSeconds >= 30 && (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    live evidence: {Math.floor(ev.totalConnectedSeconds / 60)}m connected · {ev.reconnectCount} reconnect{ev.reconnectCount === 1 ? '' : 's'}
                    {ev.suggestedAttendance && ev.bookingStatus === 'CONFIRMED' ? ` · suggested ${ev.suggestedAttendance.replace('_', ' ').toLowerCase()}` : ''}
                  </span>
                )}
                {ev && ev.totalConnectedSeconds < 30 && (
                  <span className="ml-2 text-[11px] text-muted-foreground">live evidence: never meaningfully connected</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant="outline" className={bookingStatusBadgeClass(b.status)}>{b.status.replace('_', ' ')}</Badge>
                {attendance && ended && (b.status === 'CONFIRMED' || b.status === 'ATTENDED' || b.status === 'NO_SHOW') && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 border-success/40 px-2 text-success hover:bg-success/10" disabled={busyId === b.id} onClick={() => void mark(b.id, 'ATTENDED')}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 border-destructive/40 px-2 text-destructive hover:bg-destructive/10" disabled={busyId === b.id} onClick={() => void mark(b.id, 'NO_SHOW')}>
                      <XCircle className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
      {evidence && evidence.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">Connection evidence comes from verified provider events — never from a student simply opening the page. You always confirm or override the final status.</p>
      )}
      {attendance && !ended && cls.status === 'PUBLISHED' && (
        <p className="mt-2 text-[11px] text-muted-foreground">Attendance unlocks after the class ends ({formatClassLocal(classEndTime(cls.startsAt, cls.durationMinutes).toISOString())}).</p>
      )}
    </div>
  )
}

// ─── Class create/edit form ──────────────────────────────────────────────────

function ClassFormPanel({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: ClassForm
  submitLabel: string
  onSubmit: (payload: {
    title: string
    description: string
    subject: string
    targetLevel: string
    language: string
    durationMinutes: number
    startsAt: string
    timeZone: string
    capacity: number
    minimumStudents: number
    plannedPricePaise?: number
    // Phase 7 — audience fields. Only set (and only sent) when the teacher
    // picks a private audience during CREATE; the PUBLIC flow is unchanged.
    audience?: 'PUBLIC' | 'ORGANIZATION' | 'GROUP'
    organizationId?: string
    organizationGroupId?: string
  }) => Promise<void>
}) {
  const [form, setForm] = useState<ClassForm>(initial ?? emptyClassForm())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Approved orgs where the teacher holds an instructor-level membership
  // (OWNER/ADMIN/INSTRUCTOR) — only these can own a private class.
  const [orgOptions, setOrgOptions] = useState<{ id: string; label: string }[] | null>(null)
  const [groupOptions, setGroupOptions] = useState<GroupDTO[]>([])

  const isEdit = !!initial
  const set = <K extends keyof ClassForm>(key: K, value: ClassForm[K]) => setForm(f => ({ ...f, [key]: value }))
  const durationMinutes = (Number.parseInt(form.durationHours, 10) || 0) * 60 + (Number.parseInt(form.durationMinutesPart, 10) || 0)

  // Load the teacher's eligible organizations once a private audience is picked
  // in create mode. `null` while loading; `[]` = no approved org membership.
  useEffect(() => {
    if (isEdit || form.audience === 'PUBLIC') return
    let cancelled = false
    api.myOrganizations()
      .then(res => {
        if (cancelled) return
        const eligible = res.organizations
          .filter(o =>
            ['OWNER', 'ADMIN', 'INSTRUCTOR'].includes(o.membership.role) &&
            o.membership.status === 'ACTIVE' &&
            o.organization.verificationStatus === 'APPROVED')
          .map(o => ({ id: o.organization.id, label: o.organization.displayName || o.organization.name }))
        setOrgOptions(eligible)
      })
      .catch(() => { if (!cancelled) setOrgOptions([]) })
    return () => { cancelled = true }
  }, [isEdit, form.audience])

  // Group audience additionally needs the org's active groups.
  useEffect(() => {
    if (form.audience !== 'GROUP' || !form.organizationId) {
      setGroupOptions([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      api.organizationGroups(form.organizationId)
        .then(res => { if (!cancelled) setGroupOptions(res.groups.filter(g => g.status === 'ACTIVE')) })
        .catch(() => { if (!cancelled) setGroupOptions([]) })
    }, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.audience, form.organizationId])

  const noEligibleOrgs = orgOptions !== null && orgOptions.length === 0

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const startsAtLocal = form.startsAtLocal
      if (!startsAtLocal) throw new Error('Pick a date and time for the class.')
      const audience = form.audience as 'PUBLIC' | 'ORGANIZATION' | 'GROUP'
      if (!isEdit && audience !== 'PUBLIC') {
        if (!form.organizationId) throw new Error('Pick the organization that owns this class.')
        if (audience === 'GROUP' && !form.organizationGroupId) throw new Error('Pick the group this class is visible to.')
      }
      const startsAtIso = new Date(startsAtLocal).toISOString()
      const priceRupees = Number.parseFloat(form.plannedPriceRupees)
      const payload: Parameters<typeof onSubmit>[0] = {
        title: form.title.trim(),
        description: form.description.trim(),
        subject: form.subject.trim(),
        targetLevel: form.targetLevel,
        language: form.language.trim(),
        durationMinutes,
        startsAt: startsAtIso,
        timeZone: form.timeZone,
        capacity: Number.parseInt(form.capacity, 10),
        minimumStudents: Number.parseInt(form.minimumStudents, 10),
        plannedPricePaise: form.plannedPriceRupees.trim() && !Number.isNaN(priceRupees) ? Math.round(priceRupees * 100) : 0,
      }
      // PUBLIC stays byte-identical to the pre-Phase-7 payload; private
      // audiences add exactly the fields the teach schema validates.
      if (!isEdit && audience !== 'PUBLIC') {
        payload.audience = audience
        payload.organizationId = form.organizationId
        if (audience === 'GROUP') payload.organizationGroupId = form.organizationGroupId
      }
      await onSubmit(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the class.')
    } finally {
      setBusy(false)
    }
  }

  const invalidDuration = durationMinutes < 60 || durationMinutes > 360 || durationMinutes % 30 !== 0

  const audienceExplanation =
    form.audience === 'PUBLIC'
      ? 'Visible in the public BEAN Teach marketplace — anyone browsing classes can find and reserve it.'
      : form.audience === 'ORGANIZATION'
        ? 'Visible to eligible members of your organization only — never listed in the public marketplace. Booking re-checks membership on the server.'
        : 'Visible to eligible members of the selected group only — never listed publicly. Booking additionally requires an active enrollment in that group.'

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="c-title">Class title</Label>
        <Input id="c-title" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Quadratic equations — problem sprint" maxLength={120} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="c-desc">Detailed description</Label>
        <Textarea id="c-desc" value={form.description} onChange={e => set('description', e.target.value)} placeholder="What you will cover, what students should bring, how the session runs (50–4000 characters)" rows={5} maxLength={4000} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="c-subject">Subject</Label>
          <Input id="c-subject" value={form.subject} onChange={e => set('subject', e.target.value)} maxLength={60} />
        </div>
        <div className="grid gap-1.5">
          <Label>Target level</Label>
          <Select value={form.targetLevel} onValueChange={v => set('targetLevel', v)}>
            <SelectTrigger aria-label="Target level"><SelectValue placeholder="Pick a level" /></SelectTrigger>
            <SelectContent>
              {TEACH_LEVEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-language">Language</Label>
          <Input id="c-language" value={form.language} onChange={e => set('language', e.target.value)} maxLength={30} />
        </div>
      </div>

      {/* Phase 7 — audience. Fixed at creation; shown read-only while editing. */}
      {isEdit ? (
        <div className="grid gap-1.5">
          <Label>Audience</Label>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={form.audience === 'PUBLIC' ? 'border-border text-muted-foreground' : 'border-gold/40 text-gold'}>
              {form.audience === 'PUBLIC' ? 'Public marketplace' : form.audience === 'ORGANIZATION' ? 'Organization members only' : 'Group members only'}
            </Badge>
            <span className="text-xs text-muted-foreground">Audience is fixed at creation and cannot be changed.</span>
          </div>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label>Audience</Label>
          <Select
            value={form.audience}
            onValueChange={v => setForm(f => ({
              ...f,
              audience: v,
              organizationId: v === 'PUBLIC' ? '' : f.organizationId,
              organizationGroupId: v === 'GROUP' ? f.organizationGroupId : '',
            }))}
          >
            <SelectTrigger aria-label="Class audience"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="PUBLIC">Public — BEAN Teach marketplace</SelectItem>
              <SelectItem value="ORGANIZATION" disabled={noEligibleOrgs}>Organization — your institution&apos;s members</SelectItem>
              <SelectItem value="GROUP" disabled={noEligibleOrgs}>Group — selected batch members only</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{audienceExplanation}</p>
          {noEligibleOrgs ? (
            <p className="text-xs text-muted-foreground" role="note">
              You have no approved organization where you hold an instructor-level membership — public classes remain available.
            </p>
          ) : null}
          {form.audience !== 'PUBLIC' && orgOptions === null ? (
            <p className="flex items-center text-xs text-muted-foreground" role="status"><Loader2 className="mr-2 h-3 w-3 animate-spin text-gold" aria-hidden /> Loading your organizations…</p>
          ) : null}
          {form.audience !== 'PUBLIC' && orgOptions !== null && orgOptions.length > 0 ? (
            <div className="grid gap-1.5">
              <Label htmlFor="c-org">Owning organization</Label>
              <Select value={form.organizationId} onValueChange={v => setForm(f => ({ ...f, organizationId: v, organizationGroupId: '' }))}>
                <SelectTrigger id="c-org" aria-label="Owning organization"><SelectValue placeholder="Pick your organization" /></SelectTrigger>
                <SelectContent>
                  {orgOptions.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {form.audience === 'GROUP' && form.organizationId ? (
            <div className="grid gap-1.5">
              <Label htmlFor="c-group">Group</Label>
              {groupOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">This organization has no active groups yet — create one in the institution workspace first.</p>
              ) : (
                <Select value={form.organizationGroupId} onValueChange={v => set('organizationGroupId', v)}>
                  <SelectTrigger id="c-group" aria-label="Owning group"><SelectValue placeholder="Pick the group" /></SelectTrigger>
                  <SelectContent>
                    {groupOptions.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : null}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label>Duration</Label>
          <div className="flex items-center gap-2">
            <Select value={form.durationHours} onValueChange={v => set('durationHours', v)}>
              <SelectTrigger aria-label="Duration hours"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map(h => <SelectItem key={h} value={String(h)}>{h}h</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.durationMinutesPart} onValueChange={v => set('durationMinutesPart', v)}>
              <SelectTrigger aria-label="Duration minutes"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[0, 30].map(m => <SelectItem key={m} value={String(m)}>{m}m</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <p className={`text-xs ${invalidDuration ? 'text-destructive' : 'text-muted-foreground'}`}>
            {formatDuration(durationMinutes)} — allowed range is 1h to 6h in 30-minute steps
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-starts">Date &amp; time (your local device time)</Label>
          <Input id="c-starts" type="datetime-local" value={form.startsAtLocal} onChange={e => set('startsAtLocal', e.target.value)} className="[color-scheme:dark]" />
        </div>
        <div className="grid gap-1.5">
          <Label>Time zone</Label>
          <Select value={form.timeZone} onValueChange={v => set('timeZone', v)}>
            <SelectTrigger aria-label="Time zone"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(COMMON_TIMEZONES.includes(form.timeZone) ? COMMON_TIMEZONES : [form.timeZone, ...COMMON_TIMEZONES]).map(tz => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Stored as UTC and shown to students in their local time.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="c-capacity">Capacity (1–50)</Label>
          <Input id="c-capacity" type="number" min={1} max={50} value={form.capacity} onChange={e => set('capacity', e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-minimum">Minimum enrolment</Label>
          <Input id="c-minimum" type="number" min={1} max={50} value={form.minimumStudents} onChange={e => set('minimumStudents', e.target.value)} />
          <p className="text-xs text-muted-foreground">Cannot exceed capacity.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="c-price">Planned regular price (₹, optional)</Label>
          <Input id="c-price" type="number" min={0} step="1" value={form.plannedPriceRupees} onChange={e => set('plannedPriceRupees', e.target.value)} placeholder="e.g. 499" />
          <p className="text-xs text-muted-foreground">{FREE_PILOT_PRICE_LABEL}</p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <DialogFooter>
        <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || invalidDuration} onClick={() => void submit()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{submitLabel}
        </Button>
      </DialogFooter>
    </div>
  )
}

// ─── Phase 6: teacher Trust & Quality panel ──────────────────────────────────
// Loads GET /api/teach/trust (server-authoritative). Shows the verified
// quality metrics, recent public reviews (with the teacher's own responses),
// an ANONYMOUS open-complaint count (never complaint content or reporter
// identity), any trust restrictions with their reasons, and appeal status.
// Teachers respond to reviews and file appeals from here; review responses
// are edited in place via the shared review section primitives.

function TrustPanel() {
  const navigate = useAppStore(s => s.navigate)
  const [summary, setSummary] = useState<TeacherTrustSummaryResponse | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    api.teacherTrust()
      .then(res => { setSummary(res); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your trust dashboard.'))
  }, [])

  useEffect(() => { load() }, [load])

  if (failed && !summary) {
    return <EmptyState icon={ShieldCheck} title="Could not load trust data" description={failed} actionLabel="Try again" onAction={load} />
  }
  if (!summary) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading trust data"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }

  const q = summary.quality
  return (
    <div className="flex flex-col gap-6">
      {/* Verified quality metrics — server-computed, complaint-free. */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Your verified quality metrics</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Computed from real records only — published verified reviews and class outcomes. Complaints never affect these numbers.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-elevated px-3 py-3">
            <p className="text-xs text-muted-foreground">Verified rating</p>
            <p className="mt-1 font-display text-xl font-semibold text-foreground">
              {q.sampleSufficient ? q.averageRating?.toFixed(1) : '—'}
            </p>
            {!q.sampleSufficient && <p className="mt-1 text-[11px] text-muted-foreground">New teacher — not enough reviews yet</p>}
          </div>
          <div className="rounded-lg border border-border bg-elevated px-3 py-3">
            <p className="text-xs text-muted-foreground">Verified reviews</p>
            <p className="mt-1 font-display text-xl font-semibold text-foreground">{q.reviewCount}</p>
          </div>
          <div className="rounded-lg border border-border bg-elevated px-3 py-3">
            <p className="text-xs text-muted-foreground">Classes completed</p>
            <p className="mt-1 font-display text-xl font-semibold text-foreground">{q.completedClasses}</p>
          </div>
          <div className="rounded-lg border border-border bg-elevated px-3 py-3">
            <p className="text-xs text-muted-foreground">Completion rate</p>
            <p className="mt-1 font-display text-xl font-semibold text-foreground">
              {q.completionRate !== null ? `${Math.round(q.completionRate * 100)}%` : '—'}
            </p>
          </div>
        </div>
      </section>

      {/* Anonymous open-complaint notification — content stays confidential. */}
      <section className={`rounded-xl border p-5 ${summary.openComplaintCount > 0 ? 'border-gold/40 bg-gold/5' : 'border-border bg-card'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Open concerns</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.openComplaintCount === 0
                ? 'No open concerns right now. Filing a report never changes your classes or ratings automatically — administrators investigate before any decision.'
                : `You have ${summary.openComplaintCount} open concern${summary.openComplaintCount === 1 ? '' : 's'} under administrator review. Report details stay confidential — only authorised administrators can read them, and decisions are documented before anything changes.`}
            </p>
          </div>
          <ShieldCheck className={`h-8 w-8 shrink-0 ${summary.openComplaintCount > 0 ? 'text-gold' : 'text-border'}`} aria-hidden />
        </div>
      </section>

      {/* Trust restrictions + appeal status (records with reasons). */}
      {summary.restrictions.length > 0 && (
        <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
          <h2 className="font-display text-lg font-semibold text-foreground">Trust records &amp; restrictions</h2>
          <div className="mt-3 flex flex-col gap-2">
            {summary.restrictions.map(r => (
              <div key={r.id} className="rounded-lg border border-border bg-elevated px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={r.currentlyEnforced ? 'border-destructive/40 text-destructive' : 'border-border text-muted-foreground'}>
                    {r.action.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(r.startsAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                    {r.endsAt ? ` → until ${new Date(r.endsAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}` : ' → until reinstated'}
                  </span>
                  {!r.isActive && <span className="text-[11px] text-muted-foreground">(ended)</span>}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{r.reason}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            You can appeal a restriction from{' '}
            <button className="font-medium text-gold underline-offset-2 hover:underline" onClick={() => navigate({ view: 'my-reports' })}>My reports &amp; appeals</button>.
          </p>
        </section>
      )}
      {summary.appealStatus !== 'NONE' && (
        <p className="rounded-lg border border-border bg-elevated px-4 py-3 text-xs text-muted-foreground">
          Latest appeal status: <span className="font-medium text-foreground">{summary.appealStatus.replace(/_/g, ' ')}</span>
        </p>
      )}

      {/* Recent public reviews with the teacher's own responses. */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold text-foreground">Recent verified reviews</h2>
        {summary.recentReviews.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            No verified reviews yet — reviews appear after classes end and attendance is confirmed.
          </p>
        ) : (
          <div className="mt-3 flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
            {summary.recentReviews.map(review => (
              <article key={review.id} className="rounded-lg border border-border bg-elevated p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <RatingStars rating={review.rating} />
                  {review.title && <span className="text-sm font-medium text-foreground">{review.title}</span>}
                  <span className="text-xs text-muted-foreground">{new Date(review.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  {review.ownStatus === 'FLAGGED' && <Badge variant="outline" className="border-gold/40 text-gold">Under moderation — still visible</Badge>}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {review.reviewer.displayName ? `${review.reviewer.displayName} · ` : ''}{review.reviewer.label}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{review.reviewText}</p>
                {review.response && (
                  <div className="mt-2.5 rounded-md border border-gold/30 bg-gold/5 px-3 py-2">
                    <p className="text-xs font-medium text-gold">Your response</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{review.response.responseText}</p>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Respond to reviews from each class page — one public response per review, editable for 7 days. Teachers can never edit a student&apos;s review.
        </p>
      </section>
    </div>
  )
}

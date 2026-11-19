'use client'

// ─── Phase 7 — Career portfolio (#/career/portfolio) ─────────────────────────
// Truthfully-labelled skills, student-owned projects and institution-issued
// credentials. Verification labels are rendered from server data only:
// SELF_DECLARED skills are shown exactly as self-declared (the label is
// immutable — no client control can ever change it), and revoked credentials
// never render as active achievements.
//
// Server contract honoured here (verified against src/lib/career-schema.ts and
// the skills/projects routes):
//   • proficiency is FREE TEXT (max 40 chars) — the schema defines no levels,
//     so the UI never invents a fixed proficiency scale.
//   • startsAt/endsAt are ISO datetimes with offset; date inputs are converted
//     to .toISOString() before submitting, and null clears them.
//   • skillsUsed is a list of ≤ 30 labels of ≤ 60 characters each.
//   • projectUrl must be a valid URL (client additionally requires https://).
//   • Reordering swaps `position` values of adjacent rows via PATCH; the
//     server sorts by (position asc, createdAt asc).
//   • The employer-eye project preview replicates the server's discovery query
//     exactly: visibility = SHARED AND status = ACTIVE (src/lib/career-dto.ts
//     toDiscoverableCandidateDTO + candidates route where-clause).

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/bean/empty-state'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { CareerCredentialClientDTO, CareerProjectClientDTO, CareerSkillClientDTO } from '@/lib/types'
import { toast } from '@/hooks/use-toast'
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Award,
  Eye,
  FolderKanban,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'

function skillBadge(label: string): string {
  switch (label) {
    case 'INSTITUTION_ISSUED': return 'border-success/40 bg-success/10 text-success'
    case 'BEAN_ASSESSMENT_VERIFIED': return 'border-success/40 bg-success/10 text-success'
    default: return 'border-border bg-elevated text-muted-foreground'
  }
}

function skillLabel(label: string): string {
  switch (label) {
    case 'INSTITUTION_ISSUED': return 'Issued by institution'
    case 'BEAN_ASSESSMENT_VERIFIED': return 'Verified by BEAN assessment'
    default: return 'Self-declared'
  }
}

/** YYYY-MM-DD (date input) → ISO datetime string the server accepts, or null. */
function dateInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** ISO datetime → YYYY-MM-DD for a date input. */
function isoToDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : ''
}

const SKILLS_USED_MAX = 30
const SKILL_LABEL_MAX = 60

export function CareerPortfolioView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)

  const [skills, setSkills] = useState<CareerSkillClientDTO[] | null>(null)
  const [projects, setProjects] = useState<CareerProjectClientDTO[] | null>(null)
  const [credentials, setCredentials] = useState<CareerCredentialClientDTO[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const load = useCallback(() => {
    setSkills(null); setProjects(null); setCredentials(null)
    Promise.all([api.careerSkills(), api.careerProjects(), api.careerCredentials()])
      .then(([s, p, c]) => { setSkills(s.skills); setProjects(p.projects); setCredentials(c.credentials); setFailed(null) })
      .catch(e => setFailed(e instanceof Error ? e.message : 'Could not load your portfolio.'))
  }, [])

  useEffect(() => {
    if (!authChecked || !authedStudent) return
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [authChecked, authedStudent, load])

  if (!authChecked) {
    return <div className="flex min-h-[40vh] items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <EmptyState icon={FolderKanban} title="Sign in required" description="Build your portfolio after signing in." actionLabel="Sign in" onAction={() => navigate({ view: 'auth' })} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Button variant="ghost" className="-ml-2 mb-3 text-muted-foreground hover:text-foreground" onClick={() => navigate({ view: 'career' })}>
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Career
      </Button>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">BEAN Career</p>
      <h1 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">Skills, projects & credentials</h1>
      <p className="mt-2 text-sm text-muted-foreground">Honest labels only — a self-declared skill is never shown as verified, and revoked credentials never masquerade as achievements.</p>

      {failed ? (
        <div className="mt-8"><EmptyState icon={FolderKanban} title="Could not load your portfolio" description={failed} actionLabel="Try again" onAction={load} /></div>
      ) : (
        <div className="mt-8 space-y-8">
          <SkillsSection skills={skills} reload={load} />
          <ProjectsSection projects={projects} reload={load} />
          <CredentialsSection credentials={credentials} reload={load} />
        </div>
      )}
    </div>
  )
}

// ─── Skills ──────────────────────────────────────────────────────────────────

function SkillsSection({ skills, reload }: { skills: CareerSkillClientDTO[] | null; reload: () => void }) {
  const [name, setName] = useState('')
  const [proficiency, setProficiency] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<CareerSkillClientDTO | null>(null)
  const [editing, setEditing] = useState<CareerSkillClientDTO | null>(null)
  const [editName, setEditName] = useState('')
  const [editProficiency, setEditProficiency] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [reorderingId, setReorderingId] = useState<string | null>(null)

  const add = async () => {
    if (name.trim().length < 1) return
    setBusy(true)
    try {
      await api.addCareerSkill({ skillName: name.trim(), proficiency: proficiency.trim() || undefined })
      toast({ title: 'Skill added (self-declared)' })
      setName(''); setProficiency('')
      reload()
    } catch (e) {
      toast({ title: 'Could not add skill', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (s: CareerSkillClientDTO) => {
    setEditing(s)
    setEditName(s.skillName)
    setEditProficiency(s.proficiency ?? '')
    setEditDescription(s.description ?? '')
  }

  const saveEdit = async () => {
    if (!editing || editName.trim().length < 1) return
    setBusy(true)
    try {
      await api.updateCareerSkill(editing.id, {
        skillName: editName.trim(),
        proficiency: editProficiency.trim() || undefined,
        description: editDescription.trim() || undefined,
      })
      toast({ title: 'Skill updated' })
      setEditing(null)
      reload()
    } catch (e) {
      toast({ title: 'Could not update skill', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  // Reorder by swapping `position` values of the two adjacent rows. The list is
  // refreshed AFTER both calls complete; a partial failure is surfaced
  // honestly as a non-fatal warning (the next reload shows the real order).
  const move = async (index: number, dir: -1 | 1) => {
    if (!skills) return
    const a = skills[index]
    const b = skills[index + dir]
    if (!a || !b) return
    setReorderingId(a.id)
    let failed = false
    try {
      await api.updateCareerSkill(a.id, { position: b.position })
    } catch (e) {
      failed = true
      toast({ title: 'Reorder failed', description: e instanceof Error ? e.message : 'The order did not change.', variant: 'destructive' })
    }
    if (!failed) {
      try {
        await api.updateCareerSkill(b.id, { position: a.position })
      } catch (e) {
        toast({
          title: 'Reorder partially applied',
          description: `${e instanceof Error ? e.message : 'One row did not update.'} The list below will refresh to the real order.`,
          variant: 'destructive',
        })
      }
    }
    setReorderingId(null)
    reload()
  }

  const remove = async (skill: CareerSkillClientDTO) => {
    setBusy(true)
    try {
      await api.deleteCareerSkill(skill.id)
      toast({ title: 'Skill removed' })
      setConfirmDelete(null)
      reload()
    } catch (e) {
      toast({ title: 'Could not remove', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="skills-heading">
      <div className="flex items-center justify-between">
        <h2 id="skills-heading" className="font-display text-lg font-semibold text-foreground">Skills</h2>
      </div>
      {!skills ? (
        <div className="mt-3 flex min-h-[10vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : skills.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            icon={Plus}
            title="No skills listed yet"
            description="Add 3–5 skills you can honestly defend in a conversation — for example financial modelling, Tally, GST filing or data analysis. Every skill you add yourself is labelled Self-declared and is never shown as verified."
          />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {skills.map((s, i) => (
            <li key={s.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{s.skillName}</p>
                  {s.proficiency ? <span className="text-xs text-muted-foreground">· {s.proficiency}</span> : null}
                  <Badge variant="outline" className={skillBadge(s.verificationLabel)}>{skillLabel(s.verificationLabel)}</Badge>
                </div>
                {s.description ? <p className="mt-1 text-xs text-muted-foreground">{s.description}</p> : null}
              </div>
              <div className="flex items-center gap-1 sm:self-center">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  disabled={i === 0 || reorderingId !== null}
                  onClick={() => void move(i, -1)}
                  aria-label={`Move ${s.skillName} up`}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  disabled={i === skills.length - 1 || reorderingId !== null}
                  onClick={() => void move(i, 1)}
                  aria-label={`Move ${s.skillName} down`}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={() => openEdit(s)} aria-label={`Edit ${s.skillName}`}>
                  <Pencil className="h-4 w-4" aria-hidden />
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(s)} aria-label={`Remove ${s.skillName}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
        <Input aria-label="Skill name" placeholder="e.g. Financial modelling" value={name} onChange={e => setName(e.target.value)} maxLength={60} />
        <Input aria-label="Proficiency (free text)" placeholder="e.g. Beginner / Advanced" value={proficiency} onChange={e => setProficiency(e.target.value)} maxLength={40} />
        <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || !name.trim()} onClick={add}>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Add
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Proficiency is free text (up to 40 characters) — there is no fixed scale, so describe it honestly.</p>

      {/* Edit dialog — verificationLabel is deliberately absent: it is immutable. */}
      <Dialog open={!!editing} onOpenChange={o => !busy && !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Edit skill</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Labelled <strong>{skillLabel(editing?.verificationLabel ?? 'SELF_DECLARED')}</strong> — verification labels come from institutions and
              BEAN assessments only and cannot be changed here.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="skill-edit-name">Skill name</Label>
              <Input id="skill-edit-name" value={editName} onChange={e => setEditName(e.target.value)} maxLength={60} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="skill-edit-proficiency">Proficiency (optional, free text)</Label>
              <Input id="skill-edit-proficiency" value={editProficiency} onChange={e => setEditProficiency(e.target.value)} maxLength={40} placeholder="e.g. Intermediate" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="skill-edit-desc">Description (optional)</Label>
              <Textarea id="skill-edit-desc" rows={3} value={editDescription} onChange={e => setEditDescription(e.target.value)} maxLength={500} placeholder="How you have used it — be concrete." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || editName.trim().length < 1} onClick={saveEdit}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Remove {confirmDelete?.skillName}?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">This removes the skill from your portfolio. It cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={e => { e.preventDefault(); if (confirmDelete) void remove(confirmDelete) }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ─── Projects ────────────────────────────────────────────────────────────────

const PROJECT_CATEGORIES = [
  { value: 'ACADEMIC', label: 'Academic' },
  { value: 'PERSONAL', label: 'Personal' },
  { value: 'PRACTICAL', label: 'Practical exercise' },
  { value: 'INTERNSHIP', label: 'Internship' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'SKILL_DEMO', label: 'Skill demonstration' },
]

function ProjectsSection({ projects, reload }: { projects: CareerProjectClientDTO[] | null; reload: () => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CareerProjectClientDTO | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [skillsUsedText, setSkillsUsedText] = useState('')
  const [projectUrl, setProjectUrl] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [shared, setShared] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<CareerProjectClientDTO | null>(null)
  const [confirmArchive, setConfirmArchive] = useState<CareerProjectClientDTO | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const parsedSkillsUsed = skillsUsedText.split(',').map(s => s.trim()).filter(Boolean)
  const urlOk = projectUrl.trim() === '' || /^https:\/\/.+/i.test(projectUrl.trim())
  const datesOk = !startsAt || !endsAt || new Date(startsAt) <= new Date(endsAt)

  const openAdd = () => {
    setEditing(null)
    setTitle(''); setDescription(''); setCategory(''); setSkillsUsedText(''); setProjectUrl(''); setStartsAt(''); setEndsAt(''); setShared(false)
    setFormError(null)
    setOpen(true)
  }

  const openEdit = (p: CareerProjectClientDTO) => {
    setEditing(p)
    setTitle(p.title)
    setDescription(p.description ?? '')
    setCategory(p.category ?? '')
    setSkillsUsedText(p.skillsUsed.join(', '))
    setProjectUrl(p.projectUrl ?? '')
    setStartsAt(isoToDateInput(p.startsAt))
    setEndsAt(isoToDateInput(p.endsAt))
    setShared(p.visibility === 'SHARED')
    setFormError(null)
    setOpen(true)
  }

  const save = async () => {
    if (title.trim().length < 4) return
    if (!urlOk) { setFormError('Project link must start with https://'); return }
    if (!datesOk) { setFormError('End date cannot be before the start date.'); return }
    if (parsedSkillsUsed.length > SKILLS_USED_MAX) { setFormError(`List up to ${SKILLS_USED_MAX} skills.`); return }
    if (parsedSkillsUsed.some(s => s.length > SKILL_LABEL_MAX)) { setFormError(`Each skill label must be ${SKILL_LABEL_MAX} characters or fewer.`); return }
    setBusy(true)
    setFormError(null)
    try {
      if (editing) {
        // NOTE: the server contract (projectUpdateSchema + PATCH route) accepts
        // null to CLEAR category/projectUrl/description; the api client's
        // TypeScript types don't encode null for these fields, so the nulls
        // are cast here deliberately — this is a type-level workaround only.
        await api.updateCareerProject(editing.id, {
          title: title.trim(),
          description: (description.trim() || null) as unknown as string | undefined,
          category: (category || null) as unknown as string | undefined,
          skillsUsed: parsedSkillsUsed,
          projectUrl: (projectUrl.trim() || null) as unknown as string | undefined,
          startsAt: dateInputToIso(startsAt), // null clears the date
          endsAt: dateInputToIso(endsAt),
          visibility: shared ? 'SHARED' : 'PRIVATE',
        })
        toast({ title: 'Project updated' })
      } else {
        await api.addCareerProject({
          title: title.trim(),
          description: description.trim() || undefined,
          category: category || undefined,
          skillsUsed: parsedSkillsUsed.length > 0 ? parsedSkillsUsed : undefined,
          projectUrl: projectUrl.trim() || undefined,
          ...(startsAt ? { startsAt: dateInputToIso(startsAt) ?? undefined } : {}),
          ...(endsAt ? { endsAt: dateInputToIso(endsAt) ?? undefined } : {}),
          visibility: shared ? 'SHARED' : 'PRIVATE',
        })
        toast({ title: shared ? 'Project added (shared)' : 'Project added (private)' })
      }
      setOpen(false)
      setEditing(null)
      reload()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save the project.')
    } finally {
      setBusy(false)
    }
  }

  const toggleShare = async (p: CareerProjectClientDTO) => {
    setBusy(true)
    try {
      await api.updateCareerProject(p.id, { visibility: p.visibility === 'SHARED' ? 'PRIVATE' : 'SHARED' })
      reload()
    } catch (e) {
      toast({ title: 'Could not update', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const setArchived = async (p: CareerProjectClientDTO, archived: boolean) => {
    setBusy(true)
    try {
      await api.updateCareerProject(p.id, { status: archived ? 'ARCHIVED' : 'ACTIVE' })
      toast({ title: archived ? 'Project archived — it is no longer part of discovery' : 'Project restored' })
      setConfirmArchive(null)
      reload()
    } catch (e) {
      toast({ title: 'Could not update', description: e instanceof Error ? e.message : '', variant: 'destructive' })
      setConfirmArchive(null)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: CareerProjectClientDTO) => {
    setBusy(true)
    try {
      await api.deleteCareerProject(p.id)
      toast({ title: 'Project removed' })
      setConfirmDelete(null)
      reload()
    } catch (e) {
      toast({ title: 'Could not remove', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const all = projects ?? null
  const activeCount = all?.filter(p => p.status === 'ACTIVE').length ?? 0
  const archivedCount = all?.filter(p => p.status === 'ARCHIVED').length ?? 0
  const shownList = all ? (showArchived ? all : all.filter(p => p.status === 'ACTIVE')) : []
  const sharedForDiscovery = all?.filter(p => p.visibility === 'SHARED' && p.status === 'ACTIVE') ?? []

  return (
    <section aria-labelledby="projects-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="projects-heading" className="font-display text-lg font-semibold text-foreground">Projects</h2>
        <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={openAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add project
        </Button>
      </div>
      {!all ? (
        <div className="mt-3 flex min-h-[10vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : all.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No projects yet — academic work, personal builds, internships or research all belong here.</p>
      ) : (
        <>
          {archivedCount > 0 ? (
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived projects" />
              Show archived ({archivedCount}) — {activeCount} active
            </label>
          ) : null}
          {shownList.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">All projects are archived. Toggle “Show archived” to see them.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {shownList.map(p => (
                <div key={p.id} className={`rounded-xl border border-border bg-card p-4 ${p.status === 'ARCHIVED' ? 'opacity-70' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-sm font-semibold text-foreground">{p.title}</h3>
                    <div className="flex shrink-0 gap-1">
                      {p.status === 'ARCHIVED' ? <Badge variant="outline" className="border-border text-muted-foreground">archived</Badge> : null}
                      <Badge variant="outline" className={p.visibility === 'SHARED' ? 'border-success/40 text-success' : 'border-border text-muted-foreground'}>
                        {p.visibility === 'SHARED' ? 'shared' : 'private'}
                      </Badge>
                    </div>
                  </div>
                  {p.category ? <p className="mt-1 text-xs text-gold">{p.category.toLowerCase().replace(/_/g, ' ')}</p> : null}
                  {p.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p> : null}
                  {p.skillsUsed.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">Skills: {p.skillsUsed.join(', ')}</p>
                  ) : null}
                  {p.startsAt || p.endsAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.startsAt ? new Date(p.startsAt).toLocaleDateString() : '?'} — {p.endsAt ? new Date(p.endsAt).toLocaleDateString() : 'present'}
                    </p>
                  ) : null}
                  {p.projectUrl ? (
                    <a href={p.projectUrl} target="_blank" rel="noreferrer noopener" className="mt-1 block break-all text-xs text-gold underline-offset-4 hover:underline">{p.projectUrl}</a>
                  ) : null}
                  {p.status === 'ACTIVE' ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Switch checked={p.visibility === 'SHARED'} onCheckedChange={() => void toggleShare(p)} disabled={busy} aria-label={`Share ${p.title}`} />
                      <span className="text-xs text-muted-foreground">Visible in discovery</span>
                      <span className="ml-auto flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => openEdit(p)} aria-label={`Edit ${p.title}`}>
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => setConfirmArchive(p)} aria-label={`Archive ${p.title}`}>
                          <Archive className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => setConfirmDelete(p)} aria-label={`Remove ${p.title}`}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </span>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Archived — hidden from discovery.</span>
                      <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-foreground" disabled={busy} onClick={() => void setArchived(p, false)}>
                        Restore
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => setConfirmDelete(p)} aria-label={`Remove ${p.title}`}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Privacy-safe preview: replicates the server's discovery query
              (SHARED + ACTIVE) so the student sees exactly what employers can. */}
          <div className="mt-4 rounded-xl border border-border bg-elevated p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              <Eye className="h-3.5 w-3.5 text-gold" aria-hidden /> As employers see it — projects
            </p>
            {sharedForDiscovery.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No shared projects — employers see none from your portfolio.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {sharedForDiscovery.map(p => (
                  <li key={p.id} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{p.title}</span>
                    {p.category ? ` · ${p.category.toLowerCase().replace(/_/g, ' ')}` : ''}
                    {p.skillsUsed.length > 0 ? ` · ${p.skillsUsed.join(', ')}` : ''}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Projects enter employer discovery only when marked shared and active, and only while your profile is
              DISCOVERABLE with an APPROVED adult-eligibility review.
            </p>
          </div>
        </>
      )}

      {/* Add / edit dialog (shared form) */}
      <Dialog open={open} onOpenChange={o => !busy && setOpen(o)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{editing ? 'Edit project' : 'Add a project'}</DialogTitle>
            <DialogDescription className="text-muted-foreground">Private by default — you choose what becomes visible in discovery.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="proj-title">Title</Label>
              <Input id="proj-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proj-desc">Description</Label>
              <Textarea id="proj-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={3000} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proj-skills">Skills used (comma-separated, up to {SKILLS_USED_MAX})</Label>
              <Input id="proj-skills" value={skillsUsedText} onChange={e => setSkillsUsedText(e.target.value)} placeholder="e.g. Excel, Financial modelling" aria-describedby="proj-skills-help" />
              <p id="proj-skills-help" className="text-xs text-muted-foreground">
                {parsedSkillsUsed.length}/{SKILLS_USED_MAX} labels · each up to {SKILL_LABEL_MAX} characters.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="proj-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="proj-category" aria-label="Category"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {PROJECT_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="proj-url">Project link (optional)</Label>
                <Input id="proj-url" type="url" value={projectUrl} onChange={e => setProjectUrl(e.target.value)} placeholder="https://" aria-invalid={!urlOk} />
                {!urlOk ? <p className="text-xs text-destructive">Link must start with https://</p> : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="proj-starts">Started (optional)</Label>
                <Input id="proj-starts" type="date" value={startsAt} onChange={e => setStartsAt(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="proj-ends">Ended (optional)</Label>
                <Input id="proj-ends" type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} aria-invalid={!datesOk} />
                {!datesOk ? <p className="text-xs text-destructive">End date cannot be before the start date.</p> : null}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={shared} onCheckedChange={setShared} aria-label="Share project" />
              Share in discovery
            </label>
            {formError ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || title.trim().length < 4 || !urlOk || !datesOk} onClick={save}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} {editing ? 'Save changes' : 'Add project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmArchive} onOpenChange={o => !o && !busy && setConfirmArchive(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Archive {confirmArchive?.title}?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Archived projects stay in your portfolio but leave employer discovery immediately. You can restore them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={e => { e.preventDefault(); if (confirmArchive) void setArchived(confirmArchive, true) }}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Remove {confirmDelete?.title}?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">This permanently removes the project from your portfolio.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={e => { e.preventDefault(); if (confirmDelete) void remove(confirmDelete) }}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ─── Credentials ─────────────────────────────────────────────────────────────

function CredentialsSection({ credentials, reload }: { credentials: CareerCredentialClientDTO[] | null; reload: () => void }) {
  const [busy, setBusy] = useState(false)

  const toggle = async (c: CareerCredentialClientDTO) => {
    setBusy(true)
    try {
      await api.shareCredential(c.id, !c.portfolioShared)
      reload()
    } catch (e) {
      toast({ title: 'Could not update sharing', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="credentials-heading">
      <h2 id="credentials-heading" className="font-display text-lg font-semibold text-foreground">Institution credentials</h2>
      {!credentials ? (
        <div className="mt-3 flex min-h-[10vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : credentials.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Credentials issued by your BEAN-verified institutions appear here — you always control whether each one is shared.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {credentials.map(c => (
            <li key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Award className="h-4 w-4 text-gold" aria-hidden />
                  <p className="text-sm font-medium text-foreground">{c.credentialName}</p>
                  <Badge variant="outline" className={c.status === 'ISSUED' ? 'border-success/40 text-success' : 'border-destructive/40 text-destructive'}>
                    {c.status === 'ISSUED' ? 'issued' : 'revoked'}
                  </Badge>
                </div>
                {c.credentialDescription ? <p className="mt-1 text-xs text-muted-foreground">{c.credentialDescription}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  Issued by {c.issuer.displayName || c.issuer.name} ({c.issuer.verificationStatus.toLowerCase().replace(/_/g, ' ')}) · issued {new Date(c.issuedDate).toLocaleDateString()}
                  {c.expiryDate ? ` · expires ${new Date(c.expiryDate).toLocaleDateString()}` : ''}
                </p>
                {c.credentialReference ? <p className="text-xs text-muted-foreground">Ref: {c.credentialReference}</p> : null}
              </div>
              <div className="flex items-center gap-3 sm:self-center">
                <Switch
                  checked={c.portfolioShared}
                  onCheckedChange={() => void toggle(c)}
                  disabled={busy || c.status !== 'ISSUED'}
                  aria-label={`Share ${c.credentialName}`}
                />
                <span className="text-xs text-muted-foreground">{c.status === 'ISSUED' ? (c.portfolioShared ? 'Shared' : 'Private') : 'Revoked — not shareable'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

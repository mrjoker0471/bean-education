'use client'

// ─── Phase 7 — Career portfolio (#/career/portfolio) ─────────────────────────
// Truthfully-labelled skills, student-owned projects and institution-issued
// credentials. Verification labels are rendered from server data only:
// SELF_DECLARED skills are shown exactly as self-declared, and revoked
// credentials never render as active achievements.
//
// Flow guarantees: values typed into forms survive recoverable failures (they
// clear only after the server confirms), every consequential action gets a
// confirmation dialog where it is not reversible, and archive/restore use the
// real project PATCH status transition (ACTIVE <-> ARCHIVED) — nothing
// outside the existing API is invented.

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
  allSkillsSelfDeclared, formatCareerDate, projectArchivedBadgeClass,
  projectCategoryBadgeClass, projectCategoryLabel, skillVerificationBadgeClass,
  skillVerificationLabel,
} from '@/lib/career-ui'
import { Archive, ArrowLeft, Award, ChevronDown, FolderKanban, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react'

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
  const [addError, setAddError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CareerSkillClientDTO | null>(null)

  const add = async () => {
    if (name.trim().length < 1) return
    setBusy(true)
    setAddError(null)
    try {
      await api.addCareerSkill({ skillName: name.trim(), proficiency: proficiency.trim() || undefined })
      toast({ title: 'Skill added (self-declared)' })
      setName(''); setProficiency('')
      reload()
    } catch (e) {
      // Recoverable failure — keep the typed values so the user can retry.
      const message = e instanceof Error ? e.message : 'Please try again.'
      setAddError(message)
      toast({ title: 'Could not add skill', description: message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
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

  const allSelfDeclared = allSkillsSelfDeclared(skills ?? [])

  return (
    <section aria-labelledby="skills-heading">
      <div className="flex items-center justify-between">
        <h2 id="skills-heading" className="font-display text-lg font-semibold text-foreground">Skills</h2>
      </div>
      {!skills ? (
        <div className="mt-3 flex min-h-[10vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : skills.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No skills listed yet.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {skills.map(s => (
              <li key={s.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{s.skillName}</p>
                    {s.proficiency ? <span className="text-xs text-muted-foreground">· {s.proficiency}</span> : null}
                    <Badge variant="outline" className={skillVerificationBadgeClass(s.verificationLabel)}>{skillVerificationLabel(s.verificationLabel)}</Badge>
                  </div>
                  {s.description ? <p className="mt-1 text-xs text-muted-foreground">{s.description}</p> : null}
                </div>
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive sm:self-center" onClick={() => setConfirmDelete(s)} aria-label={`Remove ${s.skillName}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          {allSelfDeclared ? (
            <p className="mt-2 text-xs text-muted-foreground">Skills you add are self-declared; institutions can issue verified credentials.</p>
          ) : null}
        </>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_150px_auto]">
        <Input aria-label="Skill name" placeholder="e.g. Financial modelling" value={name} onChange={e => setName(e.target.value)} maxLength={60} />
        <Input aria-label="Proficiency" placeholder="Beginner / Advanced" value={proficiency} onChange={e => setProficiency(e.target.value)} maxLength={40} />
        <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || !name.trim()} onClick={add}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Plus className="mr-1 h-4 w-4" aria-hidden />} Add
        </Button>
      </div>
      {addError ? (
        <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" role="alert">
          Could not add skill: {addError} Your entry is still here — try again.
        </p>
      ) : null}
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

function ProjectsSection({ projects, reload }: { projects: CareerProjectClientDTO[] | null; reload: () => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [projectUrl, setProjectUrl] = useState('')
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CareerProjectClientDTO | null>(null)
  // Sharing a project is consequential (it becomes visible in snapshots), so
  // turning SHARED on requires a confirmation; switching back to private is
  // immediate. Keyed per project id so only that row shows a spinner.
  const [confirmShare, setConfirmShare] = useState<CareerProjectClientDTO | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)

  const add = async () => {
    if (title.trim().length < 4) return
    setBusy(true)
    setAddError(null)
    try {
      await api.addCareerProject({
        title: title.trim(),
        description: description.trim() || undefined,
        category: category || undefined,
        projectUrl: projectUrl.trim() || undefined,
        visibility: shared ? 'SHARED' : 'PRIVATE',
      })
      toast({ title: shared ? 'Project added (shared)' : 'Project added (private)' })
      setOpen(false); setTitle(''); setDescription(''); setCategory(''); setProjectUrl(''); setShared(false)
      reload()
    } catch (e) {
      // Recoverable failure — the dialog stays open with every value intact.
      const message = e instanceof Error ? e.message : 'Please try again.'
      setAddError(message)
      toast({ title: 'Could not add project', description: message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const setProjectVisibility = async (p: CareerProjectClientDTO, visibility: 'PRIVATE' | 'SHARED') => {
    setBusyId(p.id)
    try {
      await api.updateCareerProject(p.id, { visibility })
      toast({ title: visibility === 'SHARED' ? 'Project shared — visible in application snapshots' : 'Project set to private' })
      setConfirmShare(null)
      reload()
    } catch (e) {
      toast({ title: 'Could not update', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  const setProjectStatus = async (p: CareerProjectClientDTO, status: 'ACTIVE' | 'ARCHIVED') => {
    setBusyId(p.id)
    try {
      await api.updateCareerProject(p.id, { status })
      toast({ title: status === 'ARCHIVED' ? 'Project archived — restore it anytime' : 'Project restored' })
      reload()
    } catch (e) {
      toast({ title: 'Could not update', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
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

  if (!projects) {
    return (
      <section aria-labelledby="projects-heading">
        <div className="flex items-center justify-between">
          <h2 id="projects-heading" className="font-display text-lg font-semibold text-foreground">Projects</h2>
        </div>
        <div className="mt-3 flex min-h-[10vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      </section>
    )
  }

  const active = projects.filter(p => p.status !== 'ARCHIVED')
  const archived = projects.filter(p => p.status === 'ARCHIVED')

  const renderCard = (p: CareerProjectClientDTO) => {
    const categoryLabel = projectCategoryLabel(p.category)
    const started = formatCareerDate(p.startsAt)
    const isBusy = busyId === p.id
    return (
      <div key={p.id} className={`rounded-xl border border-border bg-card p-4 ${p.status === 'ARCHIVED' ? 'opacity-70' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-semibold text-foreground">{p.title}</h3>
            {categoryLabel ? <Badge variant="outline" className={projectCategoryBadgeClass()}>{categoryLabel}</Badge> : null}
            {p.status === 'ARCHIVED' ? <Badge variant="outline" className={projectArchivedBadgeClass()}>Archived</Badge> : null}
          </div>
          <Badge variant="outline" className={p.visibility === 'SHARED' ? 'border-success/40 text-success' : 'border-border text-muted-foreground'}>
            {p.visibility === 'SHARED' ? 'shared' : 'private'}
          </Badge>
        </div>
        {p.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p> : null}
        {p.projectUrl ? (
          <a href={p.projectUrl} target="_blank" rel="noreferrer noopener" className="mt-1 block break-all text-xs text-gold underline-offset-4 hover:underline">{p.projectUrl}</a>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          {started ? `Started ${started}` : 'No start date recorded'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {p.status !== 'ARCHIVED' ? (
            <>
              <Switch
                checked={p.visibility === 'SHARED'}
                onCheckedChange={on => { if (on) setConfirmShare(p); else void setProjectVisibility(p, 'PRIVATE') }}
                disabled={isBusy}
                aria-label={`Share ${p.title}`}
              />
              <span className="text-xs text-muted-foreground">Visible in snapshots</span>
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={isBusy} onClick={() => void setProjectStatus(p, 'ARCHIVED')}>
                <Archive className="mr-1 h-3.5 w-3.5" aria-hidden /> Archive
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={isBusy} onClick={() => void setProjectStatus(p, 'ACTIVE')}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden /> Restore
            </Button>
          )}
          <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => setConfirmDelete(p)} aria-label={`Remove ${p.title}`}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <section aria-labelledby="projects-heading">
      <div className="flex items-center justify-between">
        <h2 id="projects-heading" className="font-display text-lg font-semibold text-foreground">Projects</h2>
        <Button size="sm" variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Add project
        </Button>
      </div>
      {active.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No active projects yet — academic work, personal builds, internships or research all belong here.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {active.map(renderCard)}
        </div>
      )}

      {archived.length > 0 ? (
        <Collapsible open={archivedOpen} onOpenChange={setArchivedOpen} className="mt-4">
          <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className={`h-4 w-4 transition-transform ${archivedOpen ? 'rotate-180' : ''}`} aria-hidden />
            Archived projects ({archived.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 grid gap-3 sm:grid-cols-2">
            {archived.map(renderCard)}
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <Dialog open={open} onOpenChange={o => { if (!busy) { setOpen(o); if (!o) setAddError(null) } }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Add a project</DialogTitle>
            <DialogDescription className="text-muted-foreground">Private by default — you choose what becomes visible in snapshots.</DialogDescription>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="proj-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="proj-category" aria-label="Category"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    <SelectItem value="ACADEMIC">Academic</SelectItem>
                    <SelectItem value="PERSONAL">Personal</SelectItem>
                    <SelectItem value="PRACTICAL">Practical exercise</SelectItem>
                    <SelectItem value="INTERNSHIP">Internship</SelectItem>
                    <SelectItem value="RESEARCH">Research</SelectItem>
                    <SelectItem value="SKILL_DEMO">Skill demonstration</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="proj-url">Project link (optional)</Label>
                <Input id="proj-url" value={projectUrl} onChange={e => setProjectUrl(e.target.value)} placeholder="https://" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={shared} onCheckedChange={setShared} aria-label="Share project" />
              Share in snapshots
            </label>
            {addError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" role="alert">
                Could not add project: {addError} Your entries are still here — try again.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" disabled={busy || title.trim().length < 4} onClick={add}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null} Add project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmShare} onOpenChange={o => !o && setConfirmShare(null)}>
        <AlertDialogContent className="border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">Share {confirmShare?.title}?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Shared projects are visible in your application snapshots. You can switch it back to private at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-muted-foreground hover:bg-elevated">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-gold text-primary-foreground hover:bg-gold-hover"
              onClick={e => { e.preventDefault(); if (confirmShare) void setProjectVisibility(confirmShare, 'SHARED') }}
            >
              Share
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
  const [busyId, setBusyId] = useState<string | null>(null)

  const toggle = async (c: CareerCredentialClientDTO) => {
    setBusyId(c.id)
    try {
      await api.shareCredential(c.id, !c.portfolioShared)
      toast({ title: !c.portfolioShared ? 'Credential shared — appears in application snapshots' : 'Credential set to private' })
      reload()
    } catch (e) {
      toast({ title: 'Could not update sharing', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="credentials-heading">
      <h2 id="credentials-heading" className="font-display text-lg font-semibold text-foreground">Institution credentials</h2>
      <p className="mt-1 text-xs text-muted-foreground">Shared credentials appear in application snapshots shared with employers. You always control each one.</p>
      {!credentials ? (
        <div className="mt-3 flex min-h-[10vh] items-center justify-center" role="status"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : credentials.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Credentials issued by your BEAN-verified institutions appear here — you always control whether each one is shared.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {credentials.map(c => {
            const revoked = c.status !== 'ISSUED'
            return (
              <li key={c.id} className={`flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between ${revoked ? 'opacity-60' : ''}`}>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Award className={`h-4 w-4 ${revoked ? 'text-muted-foreground' : 'text-gold'}`} aria-hidden />
                    <p className={`text-sm font-medium text-foreground ${revoked ? 'line-through' : ''}`}>{c.credentialName}</p>
                    <Badge variant="outline" className={revoked ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-success/40 bg-success/10 text-success'}>
                      {revoked ? 'Revoked' : 'Issued'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.issuerName} · issued {formatCareerDate(c.issuedDate) ?? ''}
                    {c.expiryDate && !revoked ? ` · expires ${formatCareerDate(c.expiryDate)}` : ''}
                  </p>
                  {c.credentialReference ? <p className="text-xs text-muted-foreground">Ref: {c.credentialReference}</p> : null}
                </div>
                <div className="flex items-center gap-3 sm:self-center">
                  <Switch
                    checked={c.portfolioShared}
                    onCheckedChange={() => void toggle(c)}
                    disabled={busyId === c.id || revoked}
                    aria-label={`Share ${c.credentialName}`}
                  />
                  <span className="text-xs text-muted-foreground">{revoked ? 'Revoked — not shareable' : c.portfolioShared ? 'Shared' : 'Private'}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

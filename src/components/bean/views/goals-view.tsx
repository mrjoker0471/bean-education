'use client'

// ─── Study goals & planning (Phase 2B, Milestone E) ────────────────────────────
// Full CRUD over the EXISTING /api/student/goals endpoints — no AI planner:
// planning is deterministic arithmetic over the user's own target date and
// daily study time (days left × preferred minutes). Goals are intentionally
// general (subjects, courses, projects, revision) — never exam-only.

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/bean/empty-state'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDate } from '@/components/bean/format'
import {
  Archive,
  CalendarDays,
  Check,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Target,
  Timer,
  Trash2,
} from 'lucide-react'
import type { GoalDTO, GoalStatus } from '@/lib/types'

function daysLeft(targetIso: string | null): number | null {
  if (!targetIso) return null
  const t = new Date(targetIso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000))
}

/** Deterministic plan hint: days left × the student's daily minutes. */
function planHint(goal: GoalDTO, dailyMinutes: number | null): string | null {
  const dl = daysLeft(goal.targetDate)
  if (dl === null) return null
  if (dailyMinutes && dailyMinutes > 0) {
    const hours = Math.round((dl * dailyMinutes) / 60)
    return `${dl} day${dl === 1 ? '' : 's'} left · at your ${dailyMinutes} min/day that is ~${hours} h of study time`
  }
  return `${dl} day${dl === 1 ? '' : 's'} left`
}

function GoalRow({
  goal,
  dailyMinutes,
  onEdit,
  onStatus,
  onDelete,
  busy,
}: {
  goal: GoalDTO
  dailyMinutes: number | null
  onEdit: (g: GoalDTO) => void
  onStatus: (g: GoalDTO, s: GoalStatus) => void
  onDelete: (g: GoalDTO) => void
  busy: boolean
}) {
  const hint = planHint(goal, dailyMinutes)
  const overdue = goal.targetDate ? (daysLeft(goal.targetDate) ?? 0) === 0 && goal.status === 'ACTIVE' : false
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{goal.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {goal.targetDate && (
              <span className={cn('flex items-center gap-1', overdue && 'text-gold')}>
                <CalendarDays className="h-3 w-3" aria-hidden />
                {overdue ? `target date ${formatDate(goal.targetDate)} (today)` : `target ${formatDate(goal.targetDate)}`}
              </span>
            )}
            {hint && (
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" aria-hidden /> {hint}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {goal.status === 'ACTIVE' && (
            <>
              <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => onEdit(goal)} aria-label={`Edit goal: ${goal.title}`}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Edit
              </Button>
              <Button variant="outline" size="sm" className="border-success/40 text-success hover:bg-success/10" onClick={() => onStatus(goal, 'COMPLETED')} disabled={busy} aria-label={`Mark goal complete: ${goal.title}`}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Complete
              </Button>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => onStatus(goal, 'ARCHIVED')} disabled={busy} aria-label={`Archive goal: ${goal.title}`}>
                <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Archive
              </Button>
            </>
          )}
          {goal.status === 'COMPLETED' && (
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => onStatus(goal, 'ACTIVE')} disabled={busy} aria-label={`Reopen goal: ${goal.title}`}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reopen
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={() => onDelete(goal)} disabled={busy} aria-label={`Delete goal: ${goal.title}`}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Delete
          </Button>
        </div>
      </div>
    </li>
  )
}

export function GoalsView() {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const [reloadKey, setReloadKey] = useState(0)

  if (!authChecked) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading goals">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }
  if (!authedStudent) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <Target className="mb-4 h-10 w-10 text-gold" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Goals live with your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to plan and track learning goals across devices. Guest mode keeps working everywhere else.
        </p>
        <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>
          Sign in or create an account
        </Button>
      </div>
    )
  }

  // Keyed child: data mutations bump the key so a clean panel re-mounts and
  // re-fetches (loading state derives from initial render, not sync setState).
  return <GoalsPanel key={reloadKey} onMutated={() => setReloadKey(k => k + 1)} />
}

function GoalsPanel({ onMutated }: { onMutated: () => void }) {
  const [goals, setGoals] = useState<GoalDTO[] | null>(null)
  const [dailyMinutes, setDailyMinutes] = useState<number | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState('')
  const [editing, setEditing] = useState<GoalDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.studentGoals(), api.studentProfile().catch(() => null)])
      .then(([goalRes, profileRes]) => {
        if (cancelled) return
        setGoals(goalRes.goals)
        setFailed(null)
        const pref = profileRes?.student.preferences.dailyMinutes
        if (typeof pref === 'number') setDailyMinutes(pref)
      })
      .catch(e => !cancelled && setFailed(e instanceof Error ? e.message : 'Could not load your goals.'))
    return () => {
      cancelled = true
    }
  }, [])

  const active = useMemo(() => (goals ?? []).filter(g => g.status === 'ACTIVE'), [goals])
  const completed = useMemo(() => (goals ?? []).filter(g => g.status === 'COMPLETED'), [goals])
  const archived = useMemo(() => (goals ?? []).filter(g => g.status === 'ARCHIVED'), [goals])

  const create = async () => {
    const title = newTitle.trim()
    if (title.length < 3) {
      setError('Give your goal a short title (at least 3 characters).')
      return
    }
    setError(null)
    try {
      await api.createStudentGoal({ title, targetDate: newDate || undefined })
      setNewTitle('')
      setNewDate('')
      setCreating(false)
      onMutated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the goal.')
    }
  }

  const setStatus = async (goal: GoalDTO, status: GoalStatus) => {
    setBusyId(goal.id)
    try {
      await api.updateStudentGoal(goal.id, { status })
      onMutated()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not update the goal.')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (goal: GoalDTO) => {
    if (!window.confirm(`Delete the goal “${goal.title}”? This cannot be undone.`)) return
    setBusyId(goal.id)
    try {
      await api.deleteStudentGoal(goal.id)
      onMutated()
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'Could not delete the goal.')
    } finally {
      setBusyId(null)
    }
  }

  if (!goals && !failed) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading goals">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <EmptyState icon={Target} title="Could not load your goals" description={failed} actionLabel="Try again" onAction={() => { setFailed(null); onMutated() }} />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">Study goals &amp; planning</p>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">My Goals</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {active.length} active · {completed.length} completed
            {dailyMinutes ? ` · planning with your ${dailyMinutes} min/day` : ' · set a daily time in onboarding for plan hints'}
          </p>
        </div>
        <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setCreating(c => !c)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New goal
        </Button>
      </header>

      {creating && (
        <section aria-label="Create a goal" className="mt-6 rounded-xl border border-border bg-card p-5">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="goal-title">Goal</Label>
              <Input
                id="goal-title"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                maxLength={140}
                placeholder="e.g. Understand calculus · Complete a Python course · Revise biology chapters"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void create()
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-date">
                Target date <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input id="goal-date" type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="sm:w-56" />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <div className="flex gap-2">
              <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={create}>
                <Check className="mr-1.5 h-4 w-4" aria-hidden /> Create goal
              </Button>
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={() => { setCreating(false); setError(null) }}>
                Cancel
              </Button>
            </div>
          </div>
        </section>
      )}

      <section aria-label="Active goals" className="mt-8">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <Target className="h-4 w-4 text-gold" aria-hidden /> Active
        </h2>
        {active.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={Target}
              title="No active goals"
              description="Any subject, any pace — “Understand calculus”, “Finish my college project”, “Study accounting 30 minutes daily”. General learning goals are first-class here."
              actionLabel="Create your first goal"
              onAction={() => setCreating(true)}
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {active.map(g => (
              <GoalRow key={g.id} goal={g} dailyMinutes={dailyMinutes} onEdit={setEditing} onStatus={setStatus} onDelete={remove} busy={busyId === g.id} />
            ))}
          </ul>
        )}
      </section>

      {completed.length > 0 && (
        <section aria-label="Completed goals" className="mt-10">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> Completed
          </h2>
          <ul className="mt-4 space-y-3">
            {completed.map(g => (
              <GoalRow key={g.id} goal={g} dailyMinutes={dailyMinutes} onEdit={setEditing} onStatus={setStatus} onDelete={remove} busy={busyId === g.id} />
            ))}
          </ul>
        </section>
      )}

      {archived.length > 0 && (
        <details className="mt-10 rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            Archived ({archived.length}) — kept out of the way, not deleted
          </summary>
          <ul className="mt-4 space-y-3">
            {archived.map(g => (
              <GoalRow key={g.id} goal={g} dailyMinutes={dailyMinutes} onEdit={setEditing} onStatus={setStatus} onDelete={remove} busy={busyId === g.id} />
            ))}
          </ul>
        </details>
      )}

      {editing && (
        <EditGoalDialog
          goal={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onMutated()
          }}
        />
      )}
      <p className="mt-10 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
        Plan hints are plain arithmetic on your target date and preferred daily time — no invented mastery or streaks.
      </p>
    </div>
  )
}

function EditGoalDialog({ goal, onClose, onSaved }: { goal: GoalDTO; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(goal.title)
  const [date, setDate] = useState(goal.targetDate ? goal.targetDate.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (saving) return
    const t = title.trim()
    if (t.length < 3) {
      setError('Give your goal a short title (at least 3 characters).')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.updateStudentGoal(goal.id, {
        title: t,
        targetDate: date ? new Date(`${date}T00:00:00`).toISOString() : null,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Edit goal">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold text-foreground">Edit goal</h2>
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-goal-title">Goal</Label>
            <Input id="edit-goal-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={140} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-goal-date">
              Target date <span className="font-normal text-muted-foreground">(clear to remove)</span>
            </Label>
            <Input id="edit-goal-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="sm:w-56" />
          </div>
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />} Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

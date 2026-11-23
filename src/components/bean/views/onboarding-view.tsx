'use client'

// ─── Student onboarding (Phase 2B, Milestone B) ────────────────────────────────
// A short, skippable profile setup shown right after sign-up (and re-openable
// from Settings via #/onboarding?edit=1).
//
// Principles:
//   • Collect only useful information — every field maps to a real profile
//     property the app actually uses (greeting, recommendations, planning).
//   • Nothing is mandatory: every step has a Skip. The wizard never traps a
//     student who wants to explore first.
//   • BEAN serves ALL students — school, college, university, CA/CMA/CS,
//     competitive-exam, skill and career learners. Selecting an entrance or
//     government examination is optional, never forced.
//   • School-age safety: no birth dates, no phone numbers, no precise school
//     names or locations are collected. (Parental consent lands in a later
//     phase — see docs/PHASE2B_IMPLEMENTATION.md § Future work.)
//   • Goals entered here become REAL StudyGoal rows via the existing goals API —
//     the dashboard can honestly track them from day one.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api'
import {
  CATEGORY_LEVEL_SUGGESTIONS,
  DAILY_MINUTES_OPTIONS,
  EDUCATION_CATEGORY_OPTIONS,
  INTEREST_SUGGESTIONS,
  LANGUAGE_OPTIONS,
  LEARNING_LEVEL_OPTIONS,
  LEARNING_STYLE_OPTIONS,
} from '@/lib/profile-options'
import type { EducationCategory, LearningLevel, LearningStyle } from '@/lib/types'
import type { StudentProfileDTO } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles, Target } from 'lucide-react'

interface GoalDraft {
  title: string
  targetDate: string // '' = none
}

const STEPS = [
  { key: 'identity', title: 'Welcome to BEAN Education', subtitle: 'How should we greet you?' },
  { key: 'category', title: 'Where are you in your learning journey?', subtitle: 'Pick the group that fits you best — you can change this any time.' },
  { key: 'interests', title: 'What do you want to learn?', subtitle: 'Pick a few subjects — they shape your recommendations.' },
  { key: 'habits', title: 'How do you like to study?', subtitle: 'Language, study style and the time you actually have.' },
  { key: 'goals', title: 'Set your first goals (optional)', subtitle: 'Small, concrete goals beat grand plans. Skip this if you prefer.' },
] as const

function ChipGroup<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: V; label: string; hint?: string }[]
  value: V | null
  onChange: (v: V) => void
  ariaLabel: string
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg border px-4 py-3 text-left transition-colors',
            value === o.value
              ? 'border-gold/60 bg-gold/15'
              : 'border-border bg-card hover:border-gold/40',
          )}
        >
          <span className={cn('block text-sm font-medium', value === o.value ? 'text-gold' : 'text-foreground')}>{o.label}</span>
          {o.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}

export function OnboardingView({ edit }: { edit?: boolean }) {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const authChecked = useAppStore(s => s.authChecked)
  const refreshAuth = useAppStore(s => s.refreshAuth)

  const [profile, setProfile] = useState<StudentProfileDTO | null>(null)
  const [loading, setLoading] = useState(true)

  const [step, setStep] = useState(0)
  const [displayName, setDisplayName] = useState('')
  const [category, setCategory] = useState<EducationCategory | null>(null)
  const [level, setLevel] = useState<LearningLevel | null>(null)
  const [interests, setInterests] = useState<string[]>([])
  const [customInterest, setCustomInterest] = useState('')
  const [language, setLanguage] = useState<string | null>(null)
  const [style, setStyle] = useState<LearningStyle | null>(null)
  const [dailyMinutes, setDailyMinutes] = useState<number | null>(null)
  const [goalExam, setGoalExam] = useState('')
  const [goalDrafts, setGoalDrafts] = useState<GoalDraft[]>([{ title: '', targetDate: '' }])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!authedStudent) {
      setLoading(false)
      return
    }
    let cancelled = false
    api
      .studentProfile()
      .then(p => {
        if (cancelled) return
        setProfile(p.student)
        const prefs = p.student.preferences
        setDisplayName(p.student.displayName ?? '')
        setCategory(typeof prefs.educationCategory === 'string' ? (prefs.educationCategory as EducationCategory) : null)
        setLevel((p.student.learningLevel as LearningLevel | null) ?? null)
        setInterests(p.student.interests)
        setLanguage(typeof prefs.language === 'string' ? (prefs.language as string) : null)
        setStyle(typeof prefs.learningStyle === 'string' ? (prefs.learningStyle as LearningStyle) : null)
        setDailyMinutes(typeof prefs.dailyMinutes === 'number' ? (prefs.dailyMinutes as number) : null)
        setGoalExam(typeof prefs.goalExam === 'string' ? (prefs.goalExam as string) : '')
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [authedStudent])

  // Category → level suggestions: when the category changes and the current
  // level is not one of its natural levels, snap to the first suggestion.
  const suggestedLevels = useMemo(
    () => (category ? CATEGORY_LEVEL_SUGGESTIONS[category] : null),
    [category],
  )
  useEffect(() => {
    if (suggestedLevels && level && !suggestedLevels.includes(level)) {
      setLevel(suggestedLevels[0])
    }
  }, [suggestedLevels, level])

  const levelOptions = useMemo(() => {
    if (!suggestedLevels) return LEARNING_LEVEL_OPTIONS
    const preferred = LEARNING_LEVEL_OPTIONS.filter(o => suggestedLevels.includes(o.value))
    const rest = LEARNING_LEVEL_OPTIONS.filter(o => !suggestedLevels.includes(o.value))
    return [...preferred, ...rest]
  }, [suggestedLevels])

  const addCustomInterest = useCallback(() => {
    const v = customInterest.trim()
    if (!v) return
    setInterests(prev => (prev.some(i => i.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v].slice(0, 20)))
    setCustomInterest('')
  }, [customInterest])

  const addGoalRow = () => setGoalDrafts(prev => (prev.length < 3 ? [...prev, { title: '', targetDate: '' }] : prev))
  const updateGoalRow = (idx: number, patch: Partial<GoalDraft>) =>
    setGoalDrafts(prev => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)))
  const removeGoalRow = (idx: number) => setGoalDrafts(prev => prev.filter((_, i) => i !== idx))

  const finish = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const trimmedName = displayName.trim()
      await api.updateStudentProfile({
        displayName: trimmedName ? trimmedName : undefined,
        learningLevel: level,
        interests: interests.length > 0 ? interests : undefined,
        preferences: {
          ...(category !== null ? { educationCategory: category } : {}),
          ...(style !== null ? { learningStyle: style } : {}),
          ...(language ? { language } : {}),
          ...(dailyMinutes !== null ? { dailyMinutes } : {}),
          ...(goalExam.trim() ? { goalExam: goalExam.trim() } : {}),
        },
        // Stamp onboarding only in setup mode — an edit must not rewind it.
        onboardingComplete: edit ? undefined : true,
      })

      // Create real goals (existing goals API — same rows the dashboard tracks).
      const validGoals = goalDrafts
        .map(g => ({ title: g.title.trim(), targetDate: g.targetDate || undefined }))
        .filter(g => g.title.length >= 3)
      for (const g of validGoals) {
        await api.createStudentGoal({ title: g.title, targetDate: g.targetDate })
      }

      await refreshAuth()
      // Teacher-intent signups are handed to the real teacher application after
      // onboarding — navigation intent only; the server-side application
      // lifecycle remains the sole path to teaching capability.
      if (!edit && authedStudent?.signupIntent === 'TEACHER') {
        navigate({ view: 'teach-apply' })
        return
      }
      navigate(edit ? { view: 'settings' } : { view: 'dashboard' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your profile — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!authChecked || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading onboarding">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    )
  }

  if (!authedStudent) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <Sparkles className="mb-4 h-10 w-10 text-gold" />
        <h1 className="font-display text-2xl font-semibold text-foreground">Sign in to set up your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Onboarding personalises your dashboard. Guest mode still works everywhere — this step only applies to
          accounts.
        </p>
        <Button className="mt-6 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>
          Sign in or create an account
        </Button>
      </div>
    )
  }

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">
          {edit ? 'Edit profile' : 'Set up your learning profile'}
        </p>
        <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
          {edit ? 'Your profile' : 'Welcome to BEAN Education'}
        </h1>
        {!edit && profile && (
          <p className="mt-2 text-sm text-muted-foreground">
            Signed in as <span className="text-foreground">{profile.email}</span>. Everything here is optional and can
            be changed later in Settings.
          </p>
        )}
        <nav aria-label="Onboarding progress" className="mt-5 flex items-center gap-2">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={`Step ${i + 1}: ${s.title}${i === step ? ' (current)' : ''}`}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => setStep(i)}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i < step ? 'bg-gold/70' : i === step ? 'bg-gold' : 'bg-border',
              )}
            />
          ))}
        </nav>
      </header>

      <section aria-label={`Step ${step + 1} of ${STEPS.length}`} className="mt-8 rounded-xl border border-border bg-card p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold text-foreground">{current.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{current.subtitle}</p>

        <div className="mt-6">
          {step === 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="onb-name">Display name</Label>
              <Input
                id="onb-name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                maxLength={80}
                placeholder="How should we greet you?"
                autoComplete="nickname"
              />
              <p className="text-xs text-muted-foreground">Used in your dashboard greeting. Your email is never shown publicly.</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div>
                <Label id="onb-cat-label" className="text-sm font-medium text-foreground">What describes you?</Label>
                <div className="mt-2">
                  <ChipGroup
                    options={EDUCATION_CATEGORY_OPTIONS}
                    value={category}
                    onChange={setCategory}
                    ariaLabel="Education category"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="onb-level" className="text-sm font-medium text-foreground">Learning level</Label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2" role="group" aria-label="Learning level">
                  {levelOptions.map(o => (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={level === o.value}
                      onClick={() => setLevel(o.value)}
                      className={cn(
                        'rounded-lg border px-4 py-2.5 text-left text-sm font-medium transition-colors',
                        level === o.value ? 'border-gold/60 bg-gold/15 text-gold' : 'border-border bg-card text-foreground hover:border-gold/40',
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Subject interests">
                {INTEREST_SUGGESTIONS.map(s => {
                  const active = interests.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setInterests(prev =>
                          active ? prev.filter(i => i !== s) : prev.length < 20 ? [...prev, s] : prev,
                        )
                      }
                      className={cn(
                        'min-h-9 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                        active ? 'border-gold/60 bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                      )}
                    >
                      {s}
                    </button>
                  )
                })}
                {interests
                  .filter(i => !INTEREST_SUGGESTIONS.includes(i as (typeof INTEREST_SUGGESTIONS)[number]))
                  .map(i => (
                    <button
                      key={i}
                      type="button"
                      aria-pressed
                      onClick={() => setInterests(prev => prev.filter(x => x !== i))}
                      className="min-h-9 rounded-full border border-gold/60 bg-gold/15 px-3.5 py-1.5 text-sm text-gold"
                    >
                      {i} ×
                    </button>
                  ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Input
                  id="onb-interest"
                  value={customInterest}
                  onChange={e => setCustomInterest(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCustomInterest()
                    }
                  }}
                  maxLength={60}
                  placeholder="Add your own subject or skill"
                  aria-label="Add a custom interest"
                />
                <Button type="button" variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={addCustomInterest}>
                  Add
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {interests.length === 0 ? 'Nothing picked yet — that is fine.' : `${interests.length} selected (up to 20).`}
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <Label htmlFor="onb-language" className="text-sm font-medium text-foreground">Preferred language</Label>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Preferred language">
                  {LANGUAGE_OPTIONS.map(lang => (
                    <button
                      key={lang}
                      type="button"
                      aria-pressed={language === lang}
                      onClick={() => setLanguage(language === lang ? null : lang)}
                      className={cn(
                        'min-h-9 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                        language === lang ? 'border-gold/60 bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                      )}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground">Learning style</Label>
                <div className="mt-2">
                  <ChipGroup options={LEARNING_STYLE_OPTIONS} value={style} onChange={setStyle} ariaLabel="Learning style" />
                </div>
              </div>
              <div>
                <Label className="text-sm font-medium text-foreground">Time you can study on a typical day</Label>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Daily study time">
                  {DAILY_MINUTES_OPTIONS.map(mins => (
                    <button
                      key={mins}
                      type="button"
                      aria-pressed={dailyMinutes === mins}
                      onClick={() => setDailyMinutes(dailyMinutes === mins ? null : mins)}
                      className={cn(
                        'min-h-9 rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                        dailyMinutes === mins ? 'border-gold/60 bg-gold/15 text-gold' : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                      )}
                    >
                      {mins < 60 ? `${mins} min` : mins === 60 ? '1 hour' : `${mins / 60} hours`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor="onb-goal-exam">
                  Target exam or course <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="onb-goal-exam"
                  value={goalExam}
                  onChange={e => setGoalExam(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. CA Foundation, NEET, a university paper — or leave empty"
                />
                <p className="text-xs text-muted-foreground">
                  Optional: many BEAN students are not preparing for an examination at all — general learning goals
                  work exactly the same.
                </p>
              </div>

              <div>
                <Label className="text-sm font-medium text-foreground">Learning goals</Label>
                <div className="mt-2 space-y-3">
                  {goalDrafts.map((g, idx) => (
                    <div key={idx} className="rounded-lg border border-border bg-elevated p-3">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={g.title}
                          onChange={e => updateGoalRow(idx, { title: e.target.value })}
                          maxLength={140}
                          placeholder={idx === 0 ? 'e.g. Understand calculus basics' : 'Another goal (optional)'}
                          aria-label={`Goal ${idx + 1} title`}
                        />
                        <Input
                          type="date"
                          value={g.targetDate}
                          onChange={e => updateGoalRow(idx, { targetDate: e.target.value })}
                          aria-label={`Goal ${idx + 1} target date (optional)`}
                          className="sm:w-40"
                        />
                        {goalDrafts.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => removeGoalRow(idx)}
                            aria-label={`Remove goal ${idx + 1}`}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {goalDrafts.length < 3 && (
                  <Button type="button" variant="outline" size="sm" className="mt-3 border-gold/40 text-gold hover:bg-gold/10" onClick={addGoalRow}>
                    <Target className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add another goal
                  </Button>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Examples: “Complete a Python course”, “Revise biology chapters 1–4”, “Study accounting 30 minutes
                  daily”. Goals appear on your dashboard.
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <Alert variant="destructive" role="alert" className="mt-5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" className="border-border text-muted-foreground hover:bg-elevated" onClick={() => setStep(s => s - 1)} disabled={saving}>
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back
              </Button>
            )}
            {!isLast && (
              <Button variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={() => setStep(s => s + 1)} disabled={saving}>
                Skip this step
              </Button>
            )}
          </div>
          {isLast ? (
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={finish} disabled={saving}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Check className="mr-1.5 h-4 w-4" aria-hidden />}
              {saving ? 'Saving…' : edit ? 'Save changes' : 'Finish setup'}
            </Button>
          ) : (
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => setStep(s => s + 1)} disabled={saving}>
              Continue <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </section>

      {!edit && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          <button type="button" className="underline hover:text-foreground" onClick={() => navigate({ view: 'dashboard' })}>
            Skip everything and go to my dashboard
          </button>
        </p>
      )}
    </div>
  )
}

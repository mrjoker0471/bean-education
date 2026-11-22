'use client'

// ─── Riishe Interactive Learning Studio (Phase 3E) ───────────────────────────
// A capability of the existing Riishe chat — launched from the response
// settings bar, rendered as a dialog. Five activities, each generated from the
// student's material through POST /api/riishe/studio and validated server-side
// before rendering:
//
//   concept map    — validated single-root tree, rendered as an expandable
//                    visual map (connector rails + gold nodes) that stays
//                    readable at every width; selecting a node reveals its
//                    explanation and related concepts
//   steps          — one focused step at a time with progress + examples
//   formula        — symbol-by-symbol walkthrough; calculate steps carry a
//                    server-recomputed deterministic check, and the final
//                    result is VERIFIED or explicitly ILLUSTRATIVE
//   flashcards     — front/back reveal, navigation, shuffle, reviewed tracking
//                    (reviewing is never mastery)
//   mini-test      — topic self-check with per-answer explanations, a score
//                    summary and a fixed honest framing note
//
// Rendering contract: every string is plain validated text rendered through
// React text nodes (auto-escaped). No HTML, markdown or executable content is
// ever produced. Review progress is ephemeral component state — nothing here
// writes to learner records (no attempt rows, no mastery, no persistence).

import { useMemo, useState } from 'react'
import { api } from '@/lib/api'
import {
  STUDIO_ACTIVITY_KINDS,
  STUDIO_ACTIVITY_LABELS,
  STUDIO_ACTIVITY_HINTS,
  STUDIO_FLASHCARD_KIND_LABELS,
  conceptChildrenMap,
  conceptDepthOf,
  conceptRelatedIds,
  scoreMiniTest,
  shuffleWithSeed,
  type StudioActivityKind,
  type StudioConceptMapDTO,
  type StudioFlashcardsDTO,
  type StudioFormulaDTO,
  type StudioGenerateResponseDTO,
  type StudioMiniTestDTO,
  type StudioStepsDTO,
} from '@/lib/riishe/studio-types'
import { RIISHE_LANGUAGE_LABELS, type RiisheResponseLanguage } from '@/lib/riishe/tutor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Toggle } from '@/components/ui/toggle'
import { PageRefChips } from '@/components/bean/riishe-bits'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Globe,
  Languages,
  Layers,
  ListOrdered,
  Loader2,
  Network,
  Plus,
  Minus,
  RotateCcw,
  Shuffle,
  Sigma,
  Sparkles,
  XCircle,
} from 'lucide-react'

const KIND_ICONS: Record<StudioActivityKind, typeof Network> = {
  'concept-map': Network,
  steps: ListOrdered,
  formula: Sigma,
  flashcards: Layers,
  'mini-test': ClipboardCheck,
}

// ─── Shared micro-pieces ──────────────────────────────────────────────────────

function GroundingNote({ result }: { result: StudioGenerateResponseDTO }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {result.grounding === 'document' ? (
        <p className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
          <BookOpen className="h-3 w-3" aria-hidden /> Document-grounded{result.docTitle ? `: ${result.docTitle}` : ''}
        </p>
      ) : (
        <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Globe className="h-3 w-3" aria-hidden /> General knowledge — not verified against your material
        </p>
      )}
      {result.responseLanguage !== 'auto' && (
        <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Languages className="h-3 w-3 text-gold" aria-hidden /> {RIISHE_LANGUAGE_LABELS[result.responseLanguage]}
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-muted-foreground">Topic: {result.topic}</p>
    </div>
  )
}

function StepNav({
  label,
  index,
  total,
  onPrev,
  onNext,
}: {
  label: string
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onPrev}
        disabled={index === 0}
        aria-label={`Previous ${label}`}
        className="h-8 gap-1 border-border text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous
      </Button>
      <p className="text-[11px] font-medium text-muted-foreground" aria-live="polite">
        {label.charAt(0).toUpperCase() + label.slice(1)} {index + 1} of {total}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onNext}
        disabled={index >= total - 1}
        aria-label={`Next ${label}`}
        className="h-8 gap-1 border-border text-xs text-muted-foreground hover:text-foreground"
      >
        Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  )
}

// ─── A. Concept map ───────────────────────────────────────────────────────────

function ConceptMapStudio({ map }: { map: StudioConceptMapDTO }) {
  const root = map.nodes.find(n => n.parent === null) ?? map.nodes[0]
  const [selectedId, setSelectedId] = useState(root.id)
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Root and its direct children start expanded; deeper levels on demand.
    const initial = new Set<string>([root.id])
    for (const n of map.nodes) if (n.parent === root.id) initial.add(n.id)
    return initial
  })
  const childrenOf = useMemo(() => conceptChildrenMap(map.nodes), [map.nodes])

  const selected = map.nodes.find(n => n.id === selectedId) ?? root
  const related = conceptRelatedIds(map.nodes, selectedId)
    .map(id => map.nodes.find(n => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n)

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const setAll = (open: boolean) => {
    setExpanded(open ? new Set(map.nodes.map(n => n.id)) : new Set([root.id]))
  }

  return (
    <div className="space-y-3">
      <p className="font-display text-lg font-semibold text-foreground">{map.title}</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {map.nodes.length} concepts · select a node to read about it
        </p>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(true)} aria-label="Expand all concepts" className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-gold">
            <Plus className="h-3 w-3" aria-hidden /> Expand all
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAll(false)} aria-label="Collapse to the central concept" className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-gold">
            <Minus className="h-3 w-3" aria-hidden /> Collapse
          </Button>
        </div>
      </div>

      {/* Visual map: connector-rail tree. Scoped scroll keeps large maps inside
          the dialog at every width; the same structure is the readable
          narrow-screen fallback (no absolute positioning, no overlap). */}
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-border bg-elevated/40 p-2" role="tree" aria-label={map.title}>
        {map.nodes.map(node => {
          const depth = conceptDepthOf(map.nodes, node.id)
          const kids = childrenOf.get(node.id) ?? []
          const isOpen = expanded.has(node.id)
          const hidden = (() => {
            // A node is hidden when any ancestor is collapsed.
            let cur = node
            while (cur.parent) {
              const parent = map.nodes.find(n => n.id === cur.parent)
              if (!parent) break
              if (!expanded.has(parent.id)) return true
              cur = parent
            }
            return false
          })()
          if (hidden) return null
          return (
            <div key={node.id} className="flex items-center gap-1" style={{ paddingLeft: depth * 18 }}>
              {kids.length > 0 ? (
                <button
                  type="button"
                  onClick={() => toggleExpand(node.id)}
                  aria-label={isOpen ? `Collapse ${node.label}` : `Expand ${node.label}`}
                  aria-expanded={isOpen}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-gold/10 hover:text-gold"
                >
                  {isOpen ? <Minus className="h-3 w-3" aria-hidden /> : <Plus className="h-3 w-3" aria-hidden />}
                </button>
              ) : (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <span className={cn('h-1.5 w-1.5 rounded-full', depth === 0 ? 'bg-gold' : 'bg-gold/50')} aria-hidden />
                </span>
              )}
              <button
                type="button"
                onClick={() => setSelectedId(node.id)}
                aria-pressed={selectedId === node.id}
                className={cn(
                  'flex min-h-8 flex-1 items-center rounded-md border px-2.5 py-1 text-left text-xs leading-snug transition-colors',
                  depth === 0 && 'font-semibold',
                  selectedId === node.id
                    ? 'border-gold/60 bg-gold/15 text-gold'
                    : 'border-transparent text-foreground hover:border-gold/40 hover:bg-gold/5',
                )}
              >
                <span className="line-clamp-2">{node.label}</span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Selected node detail — explanation + related concepts */}
      <div className="rounded-lg border border-border bg-elevated/60 px-4 py-3" aria-live="polite">
        <p className={cn('text-sm font-semibold text-foreground', conceptDepthOf(map.nodes, selected.id) === 0 && 'text-gold')}>
          {selected.label}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{selected.explanation}</p>
        {related.length > 0 && (
          <div className="mt-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Related concepts</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {related.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  aria-label={`Go to related concept ${r.label}`}
                  className="min-h-7 rounded-full border border-gold/30 bg-gold/10 px-2.5 text-[11px] text-gold transition-colors hover:bg-gold/20"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── B. Step-by-step explanation ──────────────────────────────────────────────

function StepsStudio({ steps }: { steps: StudioStepsDTO }) {
  const [index, setIndex] = useState(0)
  const step = steps.steps[index]
  return (
    <div className="space-y-3">
      <p className="font-display text-lg font-semibold text-foreground">{steps.title}</p>
      <div className="space-y-1.5">
        <Progress value={((index + 1) / steps.steps.length) * 100} aria-label={`Step ${index + 1} of ${steps.steps.length}`} className="h-1.5" />
        <StepNav label="step" index={index} total={steps.steps.length} onPrev={() => setIndex(i => Math.max(0, i - 1))} onNext={() => setIndex(i => Math.min(steps.steps.length - 1, i + 1))} />
      </div>
      <div className="rounded-lg border border-border bg-elevated/60 px-4 py-3" aria-live="polite">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">Step {index + 1}</p>
        <p className="mt-1 font-display text-base font-semibold text-foreground">{step.title}</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        {step.example && (
          <div className="mt-3 rounded-md border border-gold/25 bg-gold/5 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">Example</p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground">{step.example}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── C. Formula walkthrough ───────────────────────────────────────────────────

function VerificationBadge({ matches, computed, note }: { matches: boolean; computed: string; note?: string }) {
  if (matches) {
    return (
      <p className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Deterministic check passed{computed ? `: = ${computed}` : ''}
      </p>
    )
  }
  return (
    <p className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
      <XCircle className="h-3.5 w-3.5" aria-hidden /> Not verified{note ? `: ${note}` : ''}
    </p>
  )
}

function FormulaStudio({ formula }: { formula: StudioFormulaDTO }) {
  return (
    <div className="space-y-3">
      <p className="font-display text-lg font-semibold text-foreground">{formula.title}</p>

      <div className="overflow-x-auto rounded-lg border border-gold/30 bg-gold/5 px-4 py-3">
        <p className="font-mono text-base leading-relaxed text-gold">{formula.formula}</p>
      </div>

      <div className="rounded-lg border border-border bg-elevated/60 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Symbols</p>
        <ul className="mt-2 space-y-1.5">
          {formula.variables.map((v, i) => (
            <li key={`${v.symbol}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-xs leading-relaxed">
              <span className="font-mono font-semibold text-gold">{v.symbol}</span>
              <span className="text-muted-foreground">{v.meaning}</span>
            </li>
          ))}
        </ul>
      </div>

      <ol className="space-y-2">
        {formula.steps.map((s, i) => (
          <li key={i} className="rounded-lg border border-border bg-elevated/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                  s.stage === 'substitute' ? 'border border-gold/40 bg-transparent text-gold' : 'bg-gold/15 text-gold',
                )}
              >
                {s.stage}
              </span>
              <p className="flex-1 text-xs leading-relaxed text-foreground">{s.description}</p>
            </div>
            {s.expression && (
              <div className="mt-2 space-y-1 rounded-md border border-border bg-page/60 px-3 py-2">
                <p className="font-mono text-xs text-foreground">{s.expression}</p>
                {s.claimedResult && <p className="text-[11px] text-muted-foreground">Model claimed: {s.claimedResult}</p>}
                {s.verification && <VerificationBadge matches={s.verification.matches} computed={s.verification.computed} note={s.verification.note} />}
              </div>
            )}
          </li>
        ))}
      </ol>

      {formula.result && (
        <div className={cn('rounded-lg border px-4 py-3', formula.result.verified ? 'border-success/40 bg-success/5' : 'border-border bg-elevated/60')}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Result</p>
            {formula.result.verified ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> Verified by recomputation
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Illustrative example
              </span>
            )}
          </div>
          <p className="mt-1.5 font-mono text-lg font-semibold text-foreground">
            {formula.result.value}
            {formula.result.units ? <span className="ml-1 text-sm font-normal text-muted-foreground">{formula.result.units}</span> : null}
          </p>
          {formula.result.note && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{formula.result.note}</p>}
        </div>
      )}

      {formula.caveat && (
        <p className="text-[11px] italic leading-relaxed text-muted-foreground">{formula.caveat}</p>
      )}
    </div>
  )
}

// ─── D. Flashcards ────────────────────────────────────────────────────────────

function FlashcardsStudio({ cards }: { cards: StudioFlashcardsDTO }) {
  const [order, setOrder] = useState<number[]>(() => cards.cards.map((_, i) => i))
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [reviewed, setReviewed] = useState<Set<number>>(new Set())

  const card = cards.cards[order[index]]
  const reveal = () => {
    setRevealed(true)
    setReviewed(prev => new Set(prev).add(order[index]))
  }
  const go = (dir: 1 | -1) => {
    setIndex(i => Math.min(cards.cards.length - 1, Math.max(0, i + dir)))
    setRevealed(false)
  }
  const shuffle = () => {
    setOrder(shuffleWithSeed(cards.cards.map((_, i) => i), Date.now()))
    setIndex(0)
    setRevealed(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg font-semibold text-foreground">{cards.title}</p>
        <Button type="button" variant="outline" size="sm" onClick={shuffle} aria-label="Shuffle flashcards" className="h-8 gap-1.5 border-border text-[11px] text-muted-foreground hover:text-gold">
          <Shuffle className="h-3.5 w-3.5" aria-hidden /> Shuffle
        </Button>
      </div>

      <div className="flex min-h-40 flex-col justify-center rounded-lg border border-border bg-elevated/60 px-5 py-4" aria-live="polite">
        {card.kindTag && (
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">{STUDIO_FLASHCARD_KIND_LABELS[card.kindTag]}</p>
        )}
        <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground">{card.front}</p>
        {revealed ? (
          <>
            <div className="my-3 border-t border-gold/25" aria-hidden />
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{card.back}</p>
          </>
        ) : (
          <p className="mt-3 text-[11px] italic text-muted-foreground">Think of the answer, then reveal it.</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous flashcard" className="h-8 gap-1 border-border text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous
        </Button>
        {revealed ? (
          <Button type="button" variant="outline" size="sm" onClick={() => go(1)} disabled={index >= cards.cards.length - 1} aria-label="Next flashcard" className="h-8 gap-1 border-gold/40 text-xs text-gold hover:bg-gold/10">
            Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={reveal} aria-label="Reveal the answer" className="h-8 gap-1 bg-gold text-primary-foreground hover:bg-gold-hover">
            Reveal answer
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <StepNav label="card" index={index} total={cards.cards.length} onPrev={() => go(-1)} onNext={() => go(1)} />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Reviewed {reviewed.size} of {cards.cards.length} cards this session. Reviewing is practice — cards are never marked as mastered.
        </p>
      </div>
    </div>
  )
}

// ─── E. Mini-test ─────────────────────────────────────────────────────────────

function MiniTestStudio({ test, onOpenPage }: { test: StudioMiniTestDTO; onOpenPage?: (page: number, docId?: string) => void }) {
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<(number | null)[]>(() => test.questions.map(() => null))
  const [submitted, setSubmitted] = useState<boolean[]>(() => test.questions.map(() => false))
  const [finished, setFinished] = useState(false)

  const q = test.questions[index]
  const answered = answers[index]
  const isSubmitted = submitted[index]
  const score = scoreMiniTest(test.questions, answers)

  const choose = (opt: number) => {
    if (isSubmitted) return
    setAnswers(prev => prev.map((a, i) => (i === index ? opt : a)))
  }
  const submit = () => {
    if (answered == null) return
    setSubmitted(prev => prev.map((s, i) => (i === index ? true : s)))
  }
  const next = () => {
    if (index >= test.questions.length - 1) {
      setFinished(true)
      return
    }
    setIndex(i => i + 1)
  }
  const restart = () => {
    setIndex(0)
    setAnswers(test.questions.map(() => null))
    setSubmitted(test.questions.map(() => false))
    setFinished(false)
  }

  if (finished) {
    return (
      <div className="space-y-3">
        <p className="font-display text-lg font-semibold text-foreground">{test.title} — results</p>
        <div className="rounded-lg border border-border bg-elevated/60 px-4 py-4 text-center">
          <p className="font-mono text-3xl font-bold text-gold" aria-live="polite">{score.percent}%</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {score.correct} of {score.total} correct · {score.answered} answered
          </p>
        </div>
        <p className="rounded-lg border border-border bg-elevated/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {test.honestyNote}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={restart} aria-label="Restart the mini-test" className="h-8 gap-1.5 border-border text-xs text-muted-foreground hover:text-gold">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="font-display text-lg font-semibold text-foreground">{test.title}</p>
      <div className="space-y-1.5">
        <Progress value={((index + (isSubmitted ? 1 : 0)) / test.questions.length) * 100} aria-label={`Question ${index + 1} of ${test.questions.length}`} className="h-1.5" />
        <p className="text-[11px] font-medium text-muted-foreground" aria-live="polite">
          Question {index + 1} of {test.questions.length}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-elevated/60 px-4 py-3">
        {q.difficulty && (
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{q.difficulty}</p>
        )}
        <p className="text-sm font-medium leading-relaxed text-foreground">{q.prompt}</p>
        <div className="mt-2.5 space-y-1.5" role="group" aria-label="Answer options">
          {q.options.map((opt, i) => {
            const chosen = answered === i
            const correct = i === q.correctIndex
            return (
              <button
                key={i}
                type="button"
                onClick={() => choose(i)}
                disabled={isSubmitted}
                aria-pressed={chosen}
                className={cn(
                  'flex min-h-9 w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs leading-snug transition-colors',
                  !isSubmitted && chosen && 'border-gold/60 bg-gold/15 text-gold',
                  !isSubmitted && !chosen && 'border-border text-foreground hover:border-gold/40 hover:bg-gold/5',
                  isSubmitted && correct && 'border-success/50 bg-success/10 text-success',
                  isSubmitted && chosen && !correct && 'border-destructive/50 bg-destructive/10 text-destructive',
                  isSubmitted && !chosen && !correct && 'border-border text-muted-foreground',
                )}
              >
                <span className="font-mono text-[11px] opacity-70">{String.fromCharCode(65 + i)}</span>
                <span className="flex-1">{opt}</span>
                {isSubmitted && correct && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                {isSubmitted && chosen && !correct && <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              </button>
            )
          })}
        </div>

        {isSubmitted && (
          <div className="mt-3 space-y-2" aria-live="polite">
            <p className={cn('text-xs font-semibold', answered === q.correctIndex ? 'text-success' : 'text-destructive')}>
              {answered === q.correctIndex ? 'Correct.' : 'Not quite.'}
            </p>
            <p className="rounded-md border border-border bg-page/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{q.explanation}</p>
            {q.pageRef != null && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                From your material:
                {onOpenPage ? (
                  <PageRefChips pages={[q.pageRef]} onOpenPage={p => onOpenPage(p)} compact />
                ) : (
                  <span className="text-gold">page {q.pageRef}</span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        {isSubmitted ? (
          <Button type="button" size="sm" onClick={next} className="h-8 gap-1 bg-gold text-primary-foreground hover:bg-gold-hover" aria-label={index >= test.questions.length - 1 ? 'See results' : 'Next question'}>
            {index >= test.questions.length - 1 ? 'See results' : 'Next question'} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={submit} disabled={answered == null} className="h-8 gap-1 bg-gold text-primary-foreground hover:bg-gold-hover" aria-label="Submit answer">
            Submit answer
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Dialog + launcher ────────────────────────────────────────────────────────

function ActivityRenderer({ result, onOpenPage }: { result: StudioGenerateResponseDTO; onOpenPage?: (page: number, docId?: string) => void }) {
  const { activity } = result
  switch (activity.kind) {
    case 'concept-map':
      return <ConceptMapStudio map={activity} />
    case 'steps':
      return <StepsStudio steps={activity} />
    case 'formula':
      return <FormulaStudio formula={activity} />
    case 'flashcards':
      return <FlashcardsStudio cards={activity} />
    case 'mini-test':
      return <MiniTestStudio test={activity} onOpenPage={onOpenPage} />
  }
}

export function RiisheStudioLauncher({
  guestId,
  documentId,
  documentIds,
  topicFocus,
  responseLanguage,
  onOpenPage,
  compact,
}: {
  guestId: string
  documentId?: string
  documentIds?: string[]
  topicFocus?: string
  responseLanguage: RiisheResponseLanguage
  onOpenPage?: (page: number, docId?: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Toggle
        variant="outline"
        size="sm"
        pressed={open}
        onPressedChange={() => setOpen(v => !v)}
        aria-label="Open Riishe Studio — interactive learning activities"
        className={cn(
          'h-7 border-border px-2 text-[11px] text-muted-foreground hover:text-foreground',
          'data-[state=on]:border-gold/50 data-[state=on]:bg-gold/10 data-[state=on]:text-gold',
        )}
      >
        <Network className="h-3 w-3" aria-hidden />
        <span className={cn(compact && 'sr-only')}>Studio</span>
      </Toggle>
      <RiisheStudioDialog
        open={open}
        onOpenChange={setOpen}
        guestId={guestId}
        documentId={documentId}
        documentIds={documentIds}
        topicFocus={topicFocus}
        responseLanguage={responseLanguage}
        onOpenPage={onOpenPage}
      />
    </>
  )
}

function RiisheStudioDialog({
  open,
  onOpenChange,
  guestId,
  documentId,
  documentIds,
  topicFocus,
  responseLanguage,
  onOpenPage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  guestId: string
  documentId?: string
  documentIds?: string[]
  topicFocus?: string
  responseLanguage: RiisheResponseLanguage
  onOpenPage?: (page: number, docId?: string) => void
}) {
  const [kind, setKind] = useState<StudioActivityKind>('concept-map')
  const [topic, setTopic] = useState(topicFocus ?? '')
  const [lastTopic, setLastTopic] = useState<string | undefined>(topicFocus)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StudioGenerateResponseDTO | null>(null)

  const generate = () => {
    if (generating) return
    setGenerating(true)
    setError(null)
    const trimmedTopic = topic.trim()
    setLastTopic(trimmedTopic || undefined)
    api
      .riisheStudioGenerate({
        guestId,
        kind,
        ...(trimmedTopic ? { topic: trimmedTopic } : {}),
        ...(documentId ? { documentId } : {}),
        ...(documentIds && documentIds.length > 0 ? { documentIds } : {}),
        ...(responseLanguage !== 'auto' ? { responseLanguage } : {}),
      })
      .then(r => setResult(r))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not generate the activity. Please try again.')
      })
      .finally(() => setGenerating(false))
  }

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (v) setError(null) }}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Interactive Learning Studio</p>
          <DialogTitle className="font-display text-xl font-bold text-foreground">Riishe Studio</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            Turn a topic into visual maps, guided steps, formula walkthroughs, flashcards or a short self-check —
            generated from your material and validated before it reaches you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Activity picker */}
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="group" aria-label="Activity type">
            {STUDIO_ACTIVITY_KINDS.map(k => {
              const Icon = KIND_ICONS[k]
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={cn(
                    'flex min-h-11 flex-col items-start justify-center gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                    kind === k
                      ? 'border-gold/60 bg-gold/15 text-gold'
                      : 'border-border text-muted-foreground hover:border-gold/40 hover:text-gold',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {STUDIO_ACTIVITY_LABELS[k]}
                  </span>
                  <span className="text-[10px] leading-tight opacity-80">{STUDIO_ACTIVITY_HINTS[k]}</span>
                </button>
              )
            })}
          </div>

          {/* Topic + generate */}
          <div className="space-y-2">
            <Input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Topic to study (e.g. the chapter or concept name)"
              aria-label="Studio topic"
              maxLength={160}
              className="h-10"
            />
            <Button
              type="button"
              onClick={generate}
              disabled={generating}
              className="h-10 w-full gap-2 bg-gold text-primary-foreground hover:bg-gold-hover"
              aria-label={`Generate ${STUDIO_ACTIVITY_LABELS[kind]}`}
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {generating ? 'Riishe is preparing it…' : `Generate ${STUDIO_ACTIVITY_LABELS[kind]}`}
            </Button>
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive" role="alert">
              {error}
            </p>
          )}

          {result && !generating && (
            <div className="space-y-3 border-t border-border pt-3">
              <GroundingNote result={result} />
              <ActivityRenderer result={result} onOpenPage={onOpenPage} />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Studio activities are self-study aids generated on demand — they are not stored, and they never change
                your mastery or attempt records.
              </p>
            </div>
          )}

          {!result && !generating && !error && (
            <p className="rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Pick an activity, adjust the topic if needed, and generate. Document-grounded activities say so
              explicitly — anything built from general knowledge is labelled as such.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

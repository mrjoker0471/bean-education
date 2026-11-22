'use client'

// ─── Riishe Interactive Learning Studio (Phase 3E + Phase 3F continuity) ─────
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
//   flashcards     — front/back reveal, navigation, shuffle, reviewed tracking;
//                    Phase 3F adds optional self-marked recall ("I recalled it"
//                    / "Needed the answer") recorded only AFTER a reveal — a
//                    reveal alone stays review and never becomes evidence
//   mini-test      — topic self-check with per-answer explanations; Phase 3F
//                    records submitted answers and a SERVER-recomputed score
//                    exactly once
//
// Phase 3F continuity: every generated activity is persisted server-side with
// its validated snapshot, so students can resume unfinished activities, reopen
// completed ones, and see a compact private history — all inside this dialog.
// Reopening NEVER regenerates; the stored snapshot is restored as-is.
//
// Evidence honesty contract: activities and their interactions are saved for
// continuity only. Completion is never mastery: nothing here writes attempt,
// mastery, revision or mistake records, and every summary states that. The
// only score in the system is recomputed server-side at completion; the
// client's own numbers are never stored or displayed as a recorded result.
//
// Rendering contract: every string is plain validated text rendered through
// React text nodes (auto-escaped). No HTML, markdown or executable content is
// ever produced.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import {
  STUDIO_ACTIVITY_KINDS,
  STUDIO_ACTIVITY_LABELS,
  STUDIO_ACTIVITY_HINTS,
  STUDIO_FLASHCARD_KIND_LABELS,
  STUDIO_STATUS_LABELS,
  conceptChildrenMap,
  conceptDepthOf,
  conceptRelatedIds,
  shuffleWithSeed,
  type StudioActivityKind,
  type StudioActivityProgress,
  type StudioActivityRecordDTO,
  type StudioActivityResponses,
  type StudioActivityResult,
  type StudioActivityStatus,
  type StudioConceptMapDTO,
  type StudioEvidenceSummaryDTO,
  type StudioFlashcardsDTO,
  type StudioFormulaDTO,
  type StudioGenerateResponseDTO,
  type StudioHistoryItemDTO,
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
  History,
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
  Trash2,
  X,
  XCircle,
} from 'lucide-react'

const KIND_ICONS: Record<StudioActivityKind, typeof Network> = {
  'concept-map': Network,
  steps: ListOrdered,
  formula: Sigma,
  flashcards: Layers,
  'mini-test': ClipboardCheck,
}

/** Relative time for history rows (client-only rendering, hydration-safe). */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffMin = Math.round((Date.now() - then) / 60_000)
  if (diffMin < 1) return 'just now'
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (diffMin < 60) return rtf.format(-diffMin, 'minute')
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return rtf.format(-diffHr, 'hour')
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 30) return rtf.format(-diffDay, 'day')
  return new Date(iso).toLocaleDateString()
}

/** One-line factual review summary for a history row — never a mastery claim. */
function resultLine(result: StudioActivityResult | null): string | null {
  if (!result) return null
  switch (result.type) {
    case 'mini-test':
      return `${result.percent}% · ${result.correct} of ${result.total} correct`
    case 'flashcards':
      return `Self-marked recall on ${result.cardsReviewed} of ${result.cardsTotal} cards (${result.recalled} recalled)`
    case 'steps':
      return `Studied ${result.stepsStudied} of ${result.stepsTotal} steps`
    case 'formula':
      return result.verified ? 'Verified walkthrough reviewed' : 'Illustrative walkthrough reviewed'
    case 'concept-map':
      return `Explored a ${result.conceptsTotal}-concept map`
  }
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

/** Honest status banner for a reopened COMPLETED / ABANDONED activity. */
function StatusBanner({ status, result }: { status: StudioActivityStatus; result: StudioActivityResult | null }) {
  const line = resultLine(result)
  if (status === 'COMPLETED') {
    return (
      <div className="rounded-lg border border-success/40 bg-success/5 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Completed — review mode
        </p>
        {line && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{line}</p>}
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Reviewing never changes mastery — Studio practice stays self-study evidence.
        </p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-elevated px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <X className="h-3.5 w-3.5" aria-hidden /> Discarded
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        This activity was discarded before completion. It is shown read-only for reference.
      </p>
    </div>
  )
}

// ─── A. Concept map ───────────────────────────────────────────────────────────

function ConceptMapStudio({
  map,
  initialProgress,
  inProgress,
  onSync,
  onComplete,
}: {
  map: StudioConceptMapDTO
  initialProgress?: StudioActivityProgress | null
  inProgress: boolean
  onSync?: (progress: StudioActivityProgress) => void
  onComplete?: () => void
}) {
  const root = map.nodes.find(n => n.parent === null) ?? map.nodes[0]
  const [selectedId, setSelectedId] = useState(() => {
    const saved = initialProgress?.selectedNodeId
    return saved && map.nodes.some(n => n.id === saved) ? saved : root.id
  })
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Restored expanded set when present; otherwise root + direct children.
    const saved = initialProgress?.expandedIds
    if (saved && Array.isArray(saved)) return new Set(saved.filter(id => map.nodes.some(n => n.id === id)))
    const initial = new Set<string>([root.id])
    for (const n of map.nodes) if (n.parent === root.id) initial.add(n.id)
    return initial
  })
  const childrenOf = useMemo(() => conceptChildrenMap(map.nodes), [map.nodes])

  const selected = map.nodes.find(n => n.id === selectedId) ?? root
  const related = conceptRelatedIds(map.nodes, selectedId)
    .map(id => map.nodes.find(n => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n)

  const publish = (sel: string, exp: Set<string>) => {
    onSync?.({ selectedNodeId: sel, expandedIds: [...exp] })
  }

  const select = (id: string) => {
    setSelectedId(id)
    publish(id, expanded)
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      publish(selectedId, next)
      return next
    })
  }
  const setAll = (open: boolean) => {
    const next = open ? new Set(map.nodes.map(n => n.id)) : new Set([root.id])
    setExpanded(next)
    publish(selectedId, next)
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
                onClick={() => select(node.id)}
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
                  onClick={() => select(r.id)}
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

      {inProgress && onComplete && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onComplete?.()}
          aria-label="Finish reviewing this concept map"
          className="h-8 gap-1.5 border-gold/40 text-xs text-gold hover:bg-gold/10"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Finish reviewing
        </Button>
      )}
    </div>
  )
}

// ─── B. Step-by-step explanation ──────────────────────────────────────────────

function StepsStudio({
  steps,
  initialProgress,
  inProgress,
  onSync,
  onComplete,
}: {
  steps: StudioStepsDTO
  initialProgress?: StudioActivityProgress | null
  inProgress: boolean
  onSync?: (progress: StudioActivityProgress) => void
  onComplete?: () => void
}) {
  const total = steps.steps.length
  const [index, setIndex] = useState(() => {
    const saved = initialProgress?.stepIndex
    return typeof saved === 'number' ? Math.min(Math.max(saved, 0), total - 1) : 0
  })
  const [maxReached, setMaxReached] = useState(() => {
    const saved = initialProgress?.maxStepReached
    return typeof saved === 'number' ? Math.min(Math.max(saved, 0), total - 1) : 0
  })
  const step = steps.steps[index]

  const go = (next: number) => {
    const clamped = Math.min(Math.max(next, 0), total - 1)
    setIndex(clamped)
    setMaxReached(prev => {
      const updated = Math.max(prev, clamped)
      onSync?.({ stepIndex: clamped, maxStepReached: updated })
      return updated
    })
  }

  return (
    <div className="space-y-3">
      <p className="font-display text-lg font-semibold text-foreground">{steps.title}</p>
      <div className="space-y-1.5">
        <Progress value={((index + 1) / total) * 100} aria-label={`Step ${index + 1} of ${total}`} className="h-1.5" />
        <StepNav label="step" index={index} total={total} onPrev={() => go(index - 1)} onNext={() => go(index + 1)} />
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

      {inProgress && onComplete && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {maxReached + 1} of {total} steps studied. Finishing records your progress — it never changes mastery.
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => onComplete?.()}
            aria-label="Finish this step-by-step explanation"
            className="h-8 shrink-0 gap-1.5 bg-gold text-primary-foreground hover:bg-gold-hover"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Finish
          </Button>
        </div>
      )}
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

function FormulaStudio({
  formula,
  inProgress,
  result,
  onComplete,
}: {
  formula: StudioFormulaDTO
  inProgress: boolean
  result?: StudioActivityResult | null
  onComplete?: () => void
}) {
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

      {inProgress && onComplete && (
        <Button
          type="button"
          size="sm"
          onClick={() => onComplete?.()}
          aria-label="Finish this formula walkthrough"
          className="h-8 gap-1.5 bg-gold text-primary-foreground hover:bg-gold-hover"
        >
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Finish walkthrough
        </Button>
      )}
      {!inProgress && result?.type === 'formula' && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Recorded outcome: {result.verified ? 'deterministically verified calculation' : 'illustrative walkthrough (not a verified computation)'}.
        </p>
      )}
    </div>
  )
}

// ─── D. Flashcards ────────────────────────────────────────────────────────────

function FlashcardsStudio({
  cards,
  initialProgress,
  initialResponses,
  inProgress,
  onSync,
  onComplete,
}: {
  cards: StudioFlashcardsDTO
  initialProgress?: StudioActivityProgress | null
  initialResponses?: StudioActivityResponses | null
  inProgress: boolean
  onSync?: (progress: StudioActivityProgress, responses?: StudioActivityResponses) => void
  onComplete?: (responses?: StudioActivityResponses) => void
}) {
  const total = cards.cards.length
  const [order, setOrder] = useState<number[]>(() => {
    // Restored order must be a permutation of 0..total-1; otherwise default.
    const saved = initialProgress?.order
    if (saved && saved.length === total && new Set(saved).size === total && saved.every(i => i >= 0 && i < total)) {
      return [...saved]
    }
    return cards.cards.map((_, i) => i)
  })
  const [index, setIndex] = useState(() => {
    const saved = initialProgress?.index
    return typeof saved === 'number' ? Math.min(Math.max(saved, 0), total - 1) : 0
  })
  const [revealed, setRevealed] = useState(() => initialProgress?.revealed === true && inProgress)
  const [reviewed, setReviewed] = useState<Set<number>>(() => {
    const saved = initialProgress?.reviewed
    return new Set((saved ?? []).filter(i => i >= 0 && i < total))
  })
  // Self-marked recall — the ONLY recall evidence, recorded per card, only
  // after a reveal. A reveal without a mark stays review.
  const [selfRecall, setSelfRecall] = useState<Record<string, 'recalled' | 'missed'>>(() => ({
    ...(initialResponses?.selfRecall ?? {}),
  }))

  const cardIdx = order[index]
  const card = cards.cards[cardIdx]
  const currentMark = cardIdx != null ? selfRecall[String(cardIdx)] : undefined

  const publish = useCallback(
    (nextOrder: number[], nextIndex: number, nextRevealed: boolean, nextReviewed: Set<number>, nextRecall: Record<string, 'recalled' | 'missed'>) => {
      onSync?.(
        { order: nextOrder, index: nextIndex, revealed: nextRevealed, reviewed: [...nextReviewed] },
        { selfRecall: nextRecall },
      )
    },
    [onSync],
  )

  const mark = (value: 'recalled' | 'missed') => {
    if (cardIdx == null) return
    const nextRecall = { ...selfRecall, [String(cardIdx)]: value }
    setSelfRecall(nextRecall)
    publish(order, index, revealed, reviewed, nextRecall)
  }

  const reveal = () => {
    const nextReviewed = new Set(reviewed).add(cardIdx)
    setReviewed(nextReviewed)
    setRevealed(true)
    publish(order, index, true, nextReviewed, selfRecall)
  }
  const go = (dir: 1 | -1) => {
    const next = Math.min(total - 1, Math.max(0, index + dir))
    setIndex(next)
    setRevealed(false)
    publish(order, next, false, reviewed, selfRecall)
  }
  const shuffle = () => {
    const nextOrder = shuffleWithSeed(cards.cards.map((_, i) => i), Date.now())
    setOrder(nextOrder)
    setIndex(0)
    setRevealed(false)
    publish(nextOrder, 0, false, reviewed, selfRecall)
  }

  const finish = () => {
    onComplete?.({ selfRecall })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg font-semibold text-foreground">{cards.title}</p>
        {inProgress && (
          <Button type="button" variant="outline" size="sm" onClick={shuffle} aria-label="Shuffle flashcards" className="h-8 gap-1.5 border-border text-[11px] text-muted-foreground hover:text-gold">
            <Shuffle className="h-3.5 w-3.5" aria-hidden /> Shuffle
          </Button>
        )}
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

      {/* Self-marked recall — only offered AFTER a reveal, only while in
          progress. This is what distinguishes demonstrated recall from a
          plain reveal in the recorded evidence. */}
      {revealed && inProgress && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="How well did you recall it?">
          <span className="text-[11px] text-muted-foreground">Did you recall it before revealing?</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => mark('recalled')}
            aria-pressed={currentMark === 'recalled'}
            aria-label="Mark this card as recalled"
            className={cn(
              'h-8 gap-1 border-border text-xs',
              currentMark === 'recalled' ? 'border-success/50 bg-success/10 text-success' : 'text-muted-foreground hover:text-success',
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> I recalled it
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => mark('missed')}
            aria-pressed={currentMark === 'missed'}
            aria-label="Mark this card as needing another look"
            className={cn(
              'h-8 gap-1 border-border text-xs',
              currentMark === 'missed' ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'text-muted-foreground hover:text-destructive',
            )}
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden /> Needed the answer
          </Button>
        </div>
      )}
      {!inProgress && currentMark && (
        <p className="text-[11px] text-muted-foreground">
          Self-marked: {currentMark === 'recalled' ? 'recalled' : 'needed the answer'}.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous flashcard" className="h-8 gap-1 border-border text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous
        </Button>
        {revealed || !inProgress ? (
          <Button type="button" variant="outline" size="sm" onClick={() => go(1)} disabled={index >= total - 1} aria-label="Next flashcard" className="h-8 gap-1 border-gold/40 text-xs text-gold hover:bg-gold/10">
            Next <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={reveal} aria-label="Reveal the answer" className="h-8 gap-1 bg-gold text-primary-foreground hover:bg-gold-hover">
            Reveal answer
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        <StepNav label="card" index={index} total={total} onPrev={() => go(-1)} onNext={() => go(1)} />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Reviewed {reviewed.size} of {total} cards
          {inProgress ? ' so far. Reviewing is practice — cards are never marked as mastered.' : '.'}
        </p>
        {inProgress && onComplete && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={finish}
            aria-label="Finish this flashcard review"
            className="h-8 gap-1.5 border-gold/40 text-xs text-gold hover:bg-gold/10"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Finish review
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── E. Mini-test ─────────────────────────────────────────────────────────────

function MiniTestStudio({
  test,
  initialProgress,
  initialResponses,
  inProgress,
  onSync,
  onComplete,
  completionError,
  onClearCompletionError,
  recordedResult,
  onOpenPage,
}: {
  test: StudioMiniTestDTO
  initialProgress?: StudioActivityProgress | null
  initialResponses?: StudioActivityResponses | null
  inProgress: boolean
  onSync?: (progress: StudioActivityProgress, responses?: StudioActivityResponses) => void
  onComplete?: (responses?: StudioActivityResponses) => void
  completionError?: string | null
  onClearCompletionError?: () => void
  /** The SERVER-recorded summary — shown instead of any client computation. */
  recordedResult?: StudioActivityResult | null
  onOpenPage?: (page: number, docId?: string) => void
}) {
  const total = test.questions.length
  const [index, setIndex] = useState(() => {
    const saved = initialProgress?.index
    return typeof saved === 'number' ? Math.min(Math.max(saved, 0), total - 1) : 0
  })
  const [answers, setAnswers] = useState<(number | null)[]>(() => {
    const saved = initialProgress?.answers ?? initialResponses?.answers
    if (saved && saved.length === total) return saved.map(a => (a == null ? null : Math.min(a, 9)))
    return test.questions.map(() => null)
  })
  const [submitted, setSubmitted] = useState<boolean[]>(() => {
    const saved = initialProgress?.submitted
    if (saved && saved.length === total) return [...saved]
    return test.questions.map(() => false)
  })
  const [finished, setFinished] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const effectiveSaveError = saveError ?? completionError ?? null

  const q = test.questions[index]
  const answered = answers[index]
  const isSubmitted = submitted[index]

  const choose = (opt: number) => {
    if (isSubmitted || !inProgress) return
    const next = answers.map((a, i) => (i === index ? opt : a))
    setAnswers(next)
    onSync?.({ index, answers: next, submitted, finished: false }, { answers: next })
  }
  const submit = () => {
    if (answered == null || !inProgress) return
    const nextSubmitted = submitted.map((s, i) => (i === index ? true : s))
    setSubmitted(nextSubmitted)
    onSync?.({ index, answers, submitted: nextSubmitted, finished: false }, { answers })
  }
  const next = () => {
    if (index >= total - 1) {
      setFinished(true)
      setSaveError(null)
      onClearCompletionError?.()
      onComplete?.({ answers })
      return
    }
    const next = index + 1
    setIndex(next)
    onSync?.({ index: next, answers, submitted, finished: false }, { answers })
  }
  const restart = () => {
    if (!inProgress) return
    setIndex(0)
    setAnswers(test.questions.map(() => null))
    setSubmitted(test.questions.map(() => false))
    setFinished(false)
    setSaveError(null)
    onClearCompletionError?.()
    onSync?.({ index: 0, answers: test.questions.map(() => null), submitted: test.questions.map(() => false), finished: false }, { answers: test.questions.map(() => null) })
  }

  const recorded = recordedResult?.type === 'mini-test' ? recordedResult : null

  if (finished || (!inProgress && recorded)) {
    // The recorded SERVER-computed summary — the only score ever displayed as
    // a result. Completed activities reopen straight into this review.
    return (
      <div className="space-y-3">
        <p className="font-display text-lg font-semibold text-foreground">{test.title} — results</p>
        {recorded ? (
          <div className="rounded-lg border border-border bg-elevated/60 px-4 py-4 text-center">
            <p className="font-mono text-3xl font-bold text-gold" aria-live="polite">{recorded.percent}%</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {recorded.correct} of {recorded.total} correct · {recorded.answered} answered · saved to your Studio history
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-elevated px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            Could not record these results{effectiveSaveError ? ` — ${effectiveSaveError}` : ''}. Nothing was saved.
          </p>
        )}
        {effectiveSaveError && onComplete && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSaveError(null)
              onClearCompletionError?.()
              onComplete({ answers })
            }}
            aria-label="Retry saving the results"
            className="h-8 gap-1.5 border-gold/40 text-xs text-gold hover:bg-gold/10"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry saving
          </Button>
        )}
        <p className="rounded-lg border border-border bg-elevated/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {test.honestyNote}
        </p>
        {inProgress && recorded && (
          <Button type="button" variant="outline" size="sm" onClick={restart} aria-label="Restart the mini-test" className="h-8 gap-1.5 border-border text-xs text-muted-foreground hover:text-gold">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Try again
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="font-display text-lg font-semibold text-foreground">{test.title}</p>
      <div className="space-y-1.5">
        <Progress value={((index + (isSubmitted ? 1 : 0)) / total) * 100} aria-label={`Question ${index + 1} of ${total}`} className="h-1.5" />
        <p className="text-[11px] font-medium text-muted-foreground" aria-live="polite">
          Question {index + 1} of {total}
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
                disabled={isSubmitted || !inProgress}
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

      {effectiveSaveError && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive" role="alert">
          {effectiveSaveError}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {isSubmitted ? (
          <Button type="button" size="sm" onClick={next} className="h-8 gap-1 bg-gold text-primary-foreground hover:bg-gold-hover" aria-label={index >= total - 1 ? 'See results' : 'Next question'}>
            {index >= total - 1 ? 'See results' : 'Next question'} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
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

// ─── Continuity: history rows, resume strip, evidence summary ─────────────────

function StatusChip({ status }: { status: StudioActivityStatus }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        status === 'IN_PROGRESS' && 'border-gold/40 bg-gold/10 text-gold',
        status === 'COMPLETED' && 'border-success/40 bg-success/10 text-success',
        status === 'ABANDONED' && 'border-border bg-elevated text-muted-foreground',
      )}
    >
      {STUDIO_STATUS_LABELS[status]}
    </span>
  )
}

function HistoryRow({
  item,
  onOpen,
  onDiscard,
  onDelete,
  busy,
}: {
  item: StudioHistoryItemDTO
  onOpen: (item: StudioHistoryItemDTO) => void
  onDiscard?: (item: StudioHistoryItemDTO) => void
  onDelete: (item: StudioHistoryItemDTO) => void
  busy: boolean
}) {
  const Icon = KIND_ICONS[item.kind]
  const line = resultLine(item.result)
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-border bg-elevated/50 px-3 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gold/30 bg-gold/10 text-gold" aria-hidden>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-xs font-semibold text-foreground">{item.topic || STUDIO_ACTIVITY_LABELS[item.kind]}</p>
          <StatusChip status={item.status} />
        </div>
        <p className="mt-0.5 truncate text-[11px] leading-relaxed text-muted-foreground">
          {STUDIO_ACTIVITY_LABELS[item.kind]}
          {item.documentTitle ? ` · ${item.documentTitle}` : ''} · {timeAgo(item.updatedAt)}
          {line ? ` · ${line}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpen(item)}
          disabled={busy}
          aria-label={`${item.status === 'IN_PROGRESS' ? 'Resume' : 'Reopen'} ${item.topic || STUDIO_ACTIVITY_LABELS[item.kind]}`}
          className="h-8 gap-1 border-gold/40 px-2.5 text-[11px] text-gold hover:bg-gold/10"
        >
          {item.status === 'IN_PROGRESS' ? <RotateCcw className="h-3 w-3" aria-hidden /> : <BookOpen className="h-3 w-3" aria-hidden />}
          {item.status === 'IN_PROGRESS' ? 'Resume' : 'Reopen'}
        </Button>
        {item.status === 'IN_PROGRESS' && onDiscard && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDiscard(item)}
            disabled={busy}
            aria-label={`Discard ${item.topic || STUDIO_ACTIVITY_LABELS[item.kind]}`}
            className="h-8 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onDelete(item)}
          disabled={busy}
          aria-label={`Delete ${item.topic || STUDIO_ACTIVITY_LABELS[item.kind]} from your history`}
          className="h-8 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </li>
  )
}

function EvidenceStrip({ evidence }: { evidence: StudioEvidenceSummaryDTO }) {
  const parts: string[] = [`${evidence.completed} completed`, `${evidence.inProgress} in progress`]
  if (evidence.miniTestsCompleted > 0 && evidence.miniTestPercentAvg != null) {
    parts.push(`mini-test average ${evidence.miniTestPercentAvg}%`)
  }
  if (evidence.cardsRecalled > 0) {
    parts.push(`${evidence.cardsRecalled} ${evidence.cardsRecalled === 1 ? 'card' : 'cards'} recalled`)
  }
  return (
    <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
      <span className="font-semibold text-foreground">Studio practice so far:</span> {parts.join(' · ')}. Self-study
      evidence only — it never changes your mastery or attempt records.
    </p>
  )
}

// ─── Dialog + launcher ────────────────────────────────────────────────────────

type HistoryState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: StudioHistoryItemDTO[]; evidence: StudioEvidenceSummaryDTO }

/** The active activity "session" inside the dialog. */
interface ActivitySession {
  id: string | null // null = degraded ephemeral (persistence failed at generation)
  status: StudioActivityStatus
  activity: StudioGenerateResponseDTO['activity']
  progress: StudioActivityProgress | null
  responses: StudioActivityResponses | null
  result: StudioActivityResult | null
  topic: string
  /** Completion failure message (survives re-renders; retry stays available). */
  completionError: string | null
}

function ActivitySessionRenderer({
  session,
  onSync,
  onComplete,
  onClearCompletionError,
  onOpenPage,
}: {
  session: ActivitySession
  onSync: (progress: StudioActivityProgress, responses?: StudioActivityResponses) => void
  onComplete: (responses?: StudioActivityResponses) => void
  onClearCompletionError: () => void
  onOpenPage?: (page: number, docId?: string) => void
}) {
  const { activity } = session
  const inProgress = session.status === 'IN_PROGRESS'
  switch (activity.kind) {
    case 'concept-map':
      return (
        <ConceptMapStudio
          map={activity}
          initialProgress={session.progress}
          inProgress={inProgress && session.id != null}
          onSync={session.id != null ? onSync : undefined}
          onComplete={session.id != null ? onComplete : undefined}
        />
      )
    case 'steps':
      return (
        <StepsStudio
          steps={activity}
          initialProgress={session.progress}
          inProgress={inProgress && session.id != null}
          onSync={session.id != null ? onSync : undefined}
          onComplete={session.id != null ? onComplete : undefined}
        />
      )
    case 'formula':
      return (
        <FormulaStudio
          formula={activity}
          inProgress={inProgress && session.id != null}
          result={session.result}
          onComplete={session.id != null ? onComplete : undefined}
        />
      )
    case 'flashcards':
      return (
        <FlashcardsStudio
          cards={activity}
          initialProgress={session.progress}
          initialResponses={session.responses}
          inProgress={inProgress && session.id != null}
          onSync={session.id != null ? onSync : undefined}
          onComplete={session.id != null ? onComplete : undefined}
        />
      )
    case 'mini-test':
      return (
        <MiniTestStudio
          test={activity}
          initialProgress={session.progress}
          initialResponses={session.responses}
          inProgress={inProgress && session.id != null}
          onSync={session.id != null ? onSync : undefined}
          onComplete={session.id != null ? onComplete : undefined}
          completionError={session.completionError}
          onClearCompletionError={onClearCompletionError}
          recordedResult={session.result}
          onOpenPage={onOpenPage}
        />
      )
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
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryState>({ kind: 'loading' })
  const [session, setSession] = useState<ActivitySession | null>(null)
  const [rowBusy, setRowBusy] = useState(false)

  // ── Progress/response sync (debounced; never blocks the UI) ──
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<{ progress?: StudioActivityProgress; responses?: StudioActivityResponses }>({})

  const fetchHistory = useCallback(() => api.riisheStudioHistory(guestId), [guestId])

  const loadHistory = useCallback(() => {
    setHistory({ kind: 'loading' })
    fetchHistory()
      .then(r => setHistory({ kind: 'ready', items: r.items, evidence: r.evidence }))
      .catch((e: unknown) => {
        setHistory({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load your Studio history.' })
      })
  }, [fetchHistory])

  useEffect(() => {
    if (!open) return
    // Initial history load: the state already starts as 'loading', so no
    // synchronous setState here — results land in the promise handlers.
    let alive = true
    fetchHistory()
      .then(r => {
        if (alive) setHistory({ kind: 'ready', items: r.items, evidence: r.evidence })
      })
      .catch((e: unknown) => {
        if (alive) {
          setHistory({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load your Studio history.' })
        }
      })
    return () => {
      alive = false
    }
  }, [open, fetchHistory])

  const flushSync = useCallback(() => {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current)
      syncTimer.current = null
    }
    const id = session?.id
    const payload = pendingRef.current
    pendingRef.current = {}
    if (!id || (payload.progress === undefined && payload.responses === undefined)) return
    api
      .riisheStudioSaveProgress(id, {
        guestId,
        ...(payload.progress !== undefined ? { progress: payload.progress } : {}),
        ...(payload.responses !== undefined ? { responses: payload.responses } : {}),
      })
      .catch(() => {
        // Progress sync is best-effort: a failed save keeps the client state
        // (the next interaction re-syncs). Completion failures surface in the
        // activity UI; silent progress failures must not interrupt studying.
      })
  }, [guestId, session?.id])

  const onSync = useCallback(
    (progress: StudioActivityProgress, responses?: StudioActivityResponses) => {
      pendingRef.current = { ...pendingRef.current, progress, ...(responses !== undefined ? { responses } : {}) }
      if (syncTimer.current) clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(flushSync, 600)
    },
    [flushSync],
  )

  useEffect(() => {
    // Flush pending progress when the dialog closes.
    if (!open) flushSync()
  }, [open, flushSync])

  const handleComplete = useCallback(
    (responses?: StudioActivityResponses) => {
      const id = session?.id
      if (!id) return
      flushSync()
      api
        .riisheStudioComplete(id, { guestId, action: 'complete', ...(responses !== undefined ? { responses } : {}) })
        .then(r => {
          setSession(prev =>
            prev && prev.id === id
              ? { ...prev, status: 'COMPLETED', result: r.record.result, responses: r.record.responses ?? prev.responses, completionError: null }
              : prev,
          )
          loadHistory()
        })
        .catch((e: unknown) => {
          // Honest failure: the recorded score is never faked from the client.
          // The activity stays in progress with a retry affordance.
          const message = e instanceof Error ? e.message : 'Could not save this activity.'
          setSession(prev => (prev && prev.id === id ? { ...prev, completionError: message } : prev))
        })
    },
    [guestId, session?.id, flushSync, loadHistory],
  )

  const clearCompletionError = useCallback(() => {
    setSession(prev => (prev ? { ...prev, completionError: null } : prev))
  }, [])

  const openRecord = (id: string) => {
    flushSync()
    setRowBusy(true)
    setError(null)
    api
      .riisheStudioActivity(guestId, id)
      .then(r => {
        const rec = r.record
        setSession({
          id: rec.id,
          status: rec.status,
          activity: rec.activity,
          progress: rec.progress,
          responses: rec.responses,
          result: rec.result,
          topic: rec.topic,
          completionError: null,
        })
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not open this activity.')
      })
      .finally(() => setRowBusy(false))
  }

  const discardRecord = (item: StudioHistoryItemDTO) => {
    setRowBusy(true)
    api
      .riisheStudioAbandon(item.id, { guestId, action: 'abandon' })
      .then(() => {
        if (session?.id === item.id) setSession(prev => (prev ? { ...prev, status: 'ABANDONED' } : prev))
        loadHistory()
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not discard this activity.')
      })
      .finally(() => setRowBusy(false))
  }

  const deleteRecord = (item: StudioHistoryItemDTO) => {
    setRowBusy(true)
    api
      .riisheStudioDelete(item.id, guestId)
      .then(() => {
        if (session?.id === item.id) setSession(null)
        loadHistory()
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not delete this activity.')
      })
      .finally(() => setRowBusy(false))
  }

  const generate = () => {
    if (generating) return
    flushSync()
    setGenerating(true)
    setError(null)
    const trimmedTopic = topic.trim()
    api
      .riisheStudioGenerate({
        guestId,
        kind,
        ...(trimmedTopic ? { topic: trimmedTopic } : {}),
        ...(documentId ? { documentId } : {}),
        ...(documentIds && documentIds.length > 0 ? { documentIds } : {}),
        ...(responseLanguage !== 'auto' ? { responseLanguage } : {}),
      })
      .then(r => {
        // Phase 3F: the generated activity is persisted IN_PROGRESS; if
        // persistence degraded (no activityId), it behaves exactly like the
        // Phase 3E ephemeral flow.
        setSession({
          id: r.activityId ?? null,
          status: 'IN_PROGRESS',
          activity: r.activity,
          progress: null,
          responses: null,
          result: null,
          topic: r.topic,
          completionError: null,
        })
        loadHistory()
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not generate the activity. Please try again.')
      })
      .finally(() => setGenerating(false))
  }

  const inProgressItems = history.kind === 'ready' ? history.items.filter(i => i.status === 'IN_PROGRESS').slice(0, 3) : []
  const olderItems = history.kind === 'ready' ? history.items.filter(i => !inProgressItems.includes(i)) : []

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (v) setError(null) }}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden bg-card p-0 sm:max-w-2xl">
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Interactive Learning Studio</p>
          <DialogTitle className="font-display text-xl font-bold text-foreground">Riishe Studio</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
            Turn a topic into visual maps, guided steps, formula walkthroughs, flashcards or a short self-check —
            generated from your material, validated before it reaches you, and saved so you can pick up where you
            left off.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {session ? (
            /* ── Activity view (fresh, resumed or review) ── */
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    flushSync()
                    setSession(null)
                  }}
                  aria-label="Back to the Studio home"
                  className="h-8 gap-1 px-2 text-[11px] text-muted-foreground hover:text-gold"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Studio home
                </Button>
                <p className="max-w-[45%] truncate text-[11px] text-muted-foreground" title={session.topic}>
                  {session.topic}
                </p>
              </div>

              {session.id == null && (
                <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  Saved session unavailable — this activity works exactly as before but progress is not stored.
                </p>
              )}
              {session.id != null && session.status !== 'IN_PROGRESS' && (
                <StatusBanner status={session.status} result={session.result} />
              )}

              <ActivitySessionRenderer
                session={session}
                onSync={onSync}
                onComplete={handleComplete}
                onClearCompletionError={clearCompletionError}
                onOpenPage={onOpenPage}
              />

              {session.completionError && session.activity.kind !== 'mini-test' && (
                <div className="space-y-2">
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive" role="alert">
                    {session.completionError}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      clearCompletionError()
                      handleComplete()
                    }}
                    aria-label="Retry saving this activity"
                    className="h-8 gap-1.5 border-gold/40 text-xs text-gold hover:bg-gold/10"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry saving
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* ── Studio home: resume, picker, generate, history ── */
            <>
              {/* Resume strip — the clearest way back into unfinished work. */}
              {history.kind === 'ready' && inProgressItems.length > 0 && (
                <section aria-label="Continue where you left off" className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">
                    <RotateCcw className="h-3 w-3" aria-hidden /> Continue where you left off
                  </p>
                  <ul className="space-y-1.5">
                    {inProgressItems.map(item => (
                      <HistoryRow key={item.id} item={item} onOpen={i => openRecord(i.id)} onDelete={deleteRecord} onDiscard={discardRecord} busy={rowBusy} />
                    ))}
                  </ul>
                </section>
              )}

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

              {/* History — compact, reopenable, honest statuses. */}
              <section aria-label="Your Studio history" className="space-y-1.5 border-t border-border pt-3">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <History className="h-3 w-3" aria-hidden /> Your Studio history
                </p>
                {history.kind === 'loading' && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" aria-hidden /> Loading your activities…
                  </p>
                )}
                {history.kind === 'error' && (
                  <div className="space-y-1.5">
                    <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive" role="alert">
                      {history.message}
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={loadHistory} aria-label="Retry loading your Studio history" className="h-8 gap-1.5 border-border text-xs text-muted-foreground hover:text-gold">
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
                    </Button>
                  </div>
                )}
                {history.kind === 'ready' && (
                  <>
                    {history.items.length === 0 ? (
                      <p className="rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                        Nothing here yet — generate an activity above and it will be saved so you can resume or
                        revisit it any time.
                      </p>
                    ) : (
                      <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
                        {olderItems.map(item => (
                          <HistoryRow key={item.id} item={item} onOpen={i => openRecord(i.id)} onDelete={deleteRecord} busy={rowBusy} />
                        ))}
                      </ul>
                    )}
                    {history.items.length > 0 && <EvidenceStrip evidence={history.evidence} />}
                  </>
                )}
              </section>

              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Studio activities are saved to your private learning history so you can resume and review them. They
                are practice aids only — completing them never changes your mastery or attempt records.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

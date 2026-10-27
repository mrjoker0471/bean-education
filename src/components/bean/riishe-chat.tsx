'use client'

// Riishe follow-up chat — contextual AI tutoring used on the Riishe hub and
// on every answer-review screen (per-question scope). Conversations persist
// server-side.
//
// Answer-source modes (every reply carries exactly one, visibly):
//   document — grounded in the student's uploaded material, cited with real
//              page numbers verified against the retrieved text
//   mixed    — uploaded material + outside knowledge, kept clearly apart
//   general  — general knowledge, NOT verified against the uploaded material
//
// The "Show what context was used" toggle reveals the verified sources behind
// each answer (document, page range, excerpt) or an explicit
// "No uploaded source used." line. Toggling it off only hides the details —
// the underlying grounding and validation always run server-side.
//
// Response styles (Exam-focused / Simple / Detailed) change presentation and
// depth only — never the sources or factual correctness.

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { RiisheChatTurnDTO } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { PageRefChips } from '@/components/bean/riishe-bits'
import { cn } from '@/lib/utils'
import { BookOpen, Globe, Loader2, Send, Sparkles, X } from 'lucide-react'

export interface RiisheChatScope {
  documentId?: string
  attemptId?: string
  questionId?: string
}

const STYLE_OPTIONS: { value: 'exam-focused' | 'simple' | 'detailed'; label: string }[] = [
  { value: 'exam-focused', label: 'Exam-focused' },
  { value: 'simple', label: 'Simple' },
  { value: 'detailed', label: 'Detailed' },
]

function pagesLabel(pages: number[]): string {
  if (pages.length === 0) return ''
  const from = Math.min(...pages)
  const to = Math.max(...pages)
  return from === to ? `page ${from}` : `pages ${from}–${to}`
}

/** Explicit source-state badge — rendered on EVERY assistant reply. */
function GroundingBadge({ grounding }: { grounding: 'document' | 'mixed' | 'general' | null }) {
  if (grounding === 'document') {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold">
        <BookOpen className="h-3 w-3" aria-hidden /> Document-grounded
      </p>
    )
  }
  if (grounding === 'mixed') {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full border border-gold/25 bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <BookOpen className="h-3 w-3 text-gold" aria-hidden />
        <Globe className="h-3 w-3" aria-hidden /> Mixed: your material + outside knowledge
      </p>
    )
  }
  if (grounding === 'general') {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-elevated px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Globe className="h-3 w-3" aria-hidden /> General knowledge — not verified against your material
      </p>
    )
  }
  return null
}

/** Truthful per-turn sources panel (toggle-gated). */
function SourcesPanel({
  turn,
  onOpenPage,
}: {
  turn: RiisheChatTurnDTO
  onOpenPage?: (page: number, docId?: string) => void
}) {
  const docSources = turn.sources.filter(s => (s.kind ?? 'document') === 'document')
  const webSources = turn.sources.filter(s => s.kind === 'web')
  return (
    <div className="mt-1.5 w-full max-w-[92%] rounded-lg border border-border/70 bg-elevated/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Context used
      </p>
      {docSources.length === 0 ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">No uploaded source used.</p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {docSources.map((s, i) => (
            <li key={`${s.documentId}-${i}`} className="text-xs leading-relaxed">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-foreground">{s.title}</span>
                {onOpenPage && s.pages.length > 0 ? (
                  <PageRefChips pages={s.pages} onOpenPage={p => onOpenPage(p, s.documentId)} compact />
                ) : (
                  <span className="text-[11px] text-gold">{pagesLabel(s.pages)}</span>
                )}
              </p>
              {s.excerpt && (
                <p className="mt-0.5 line-clamp-3 border-l-2 border-gold/30 pl-2 text-[11px] italic leading-relaxed text-muted-foreground">
                  “{s.excerpt}”
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {webSources.length > 0 && (
        <>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Live web results (external — not your material)
          </p>
          <ul className="mt-1.5 space-y-2">
            {webSources.map((s, i) => (
              <li key={`web-${i}`} className="text-xs leading-relaxed">
                <p className="flex flex-wrap items-center gap-x-2">
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-foreground underline decoration-gold/40 underline-offset-2 hover:text-gold"
                    >
                      {s.title}
                    </a>
                  ) : (
                    <span className="font-medium text-foreground">{s.title}</span>
                  )}
                  <Globe className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                </p>
                {s.detail && <p className="text-[11px] text-muted-foreground">{s.detail}</p>}
                {s.excerpt && (
                  <p className="mt-0.5 line-clamp-2 border-l-2 border-border pl-2 text-[11px] italic leading-relaxed text-muted-foreground">
                    “{s.excerpt}”
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {turn.grounding === 'mixed' && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Outside parts of this answer are general knowledge and are not verified against your material.
        </p>
      )}
    </div>
  )
}

export function RiisheChatPanel({
  guestId,
  scope,
  topicFocus,
  greeting,
  placeholder = 'Ask Riishe about your material…',
  onOpenPage,
  compact,
  materials,
}: {
  guestId: string
  scope: RiisheChatScope
  /** Discovered topic / chapter the chat is focused on (retrieval steering). */
  topicFocus?: string
  greeting: string
  placeholder?: string
  /** Open the cited page in the reader / source document. */
  onOpenPage?: (page: number, docId?: string) => void
  compact?: boolean
  /** READY materials for the hub's grounding-scope selector (student chooses
   *  which documents retrieval may use). Absent = scope is fixed (workspace,
   *  per-question review). */
  materials?: { id: string; title: string }[]
}) {
  const beanSettings = useAppStore(s => s.beanSettings)
  const setBeanSettings = useAppStore(s => s.setBeanSettings)
  const showSources = beanSettings.showSourceContext

  const [turns, setTurns] = useState<RiisheChatTurnDTO[] | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | undefined>(topicFocus)
  const [scopeDocs, setScopeDocs] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const scopeKey = `${scope.documentId ?? ''}|${scope.attemptId ?? ''}|${scope.questionId ?? ''}`

  // Sync the focus when a new topic deep-link arrives
  const [lastFocusProp, setLastFocusProp] = useState(topicFocus)
  if (lastFocusProp !== topicFocus) {
    setLastFocusProp(topicFocus)
    setFocus(topicFocus)
  }

  // Load the persisted conversation once per scope
  useEffect(() => {
    if (!guestId) return
    let alive = true
    api
      .riisheChatHistory({
        guestId,
        documentId: scope.documentId,
        attemptId: scope.attemptId,
        questionId: scope.questionId,
      })
      .then(d => {
        if (alive) setTurns(d.turns)
      })
      .catch(() => {
        if (alive) setTurns([]) // honest empty — the chat still works
      })
    return () => {
      alive = false
    }
  }, [guestId, scopeKey])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns?.length, sending])

  const send = () => {
    const text = input.trim()
    if (!text || sending || !guestId) return
    setSending(true)
    setError(null)
    setInput('')
    setTurns(prev => [
      ...(prev ?? []),
      { id: `local-${Date.now()}`, role: 'user', content: text, pagesCited: [], grounding: null, sources: [], createdAt: new Date().toISOString() },
    ])
    api
      .riisheChat({
        guestId,
        messages: [...(turns ?? []), { role: 'user' as const, content: text }].slice(-12).map(t => ({ role: t.role as 'user' | 'assistant', content: t.content })),
        documentId: scope.documentId,
        documentIds: scopeDocs.length > 0 ? scopeDocs : undefined,
        attemptId: scope.attemptId,
        questionId: scope.questionId,
        topic: focus,
        style: beanSettings.style,
      })
      .then(r => {
        setTurns(prev => [
          ...(prev ?? []),
          {
            id: r.turnId,
            role: 'assistant',
            content: r.reply,
            pagesCited: r.pagesCited,
            grounding: r.grounding,
            sources: r.sources ?? [],
            createdAt: new Date().toISOString(),
          },
        ])
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not send the question.')
      })
      .finally(() => setSending(false))
  }

  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card', compact ? 'p-3' : 'p-4 sm:p-5')}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
          <Sparkles className="h-3.5 w-3.5 text-gold" aria-hidden />
        </span>
        <p className="text-sm font-semibold text-foreground">Ask Riishe</p>
      </div>

      {/* Response settings — style changes presentation only; the sources
          toggle reveals (never alters) the grounding. */}
      <div
        className={cn('mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-elevated/50 px-3 py-2', compact && 'gap-x-3')}
        aria-label="Riishe response settings"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('mr-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground', compact && 'sr-only')}>
            Style
          </span>
          {STYLE_OPTIONS.map(opt => (
            <Toggle
              key={opt.value}
              variant="outline"
              size="sm"
              pressed={beanSettings.style === opt.value}
              onPressedChange={() => setBeanSettings({ style: opt.value })}
              aria-label={`Response style: ${opt.label}`}
              className={cn(
                'h-7 border-border px-2 text-[11px] text-muted-foreground hover:text-foreground',
                'data-[state=on]:border-gold/50 data-[state=on]:bg-gold/10 data-[state=on]:text-gold'
              )}
            >
              {opt.label}
            </Toggle>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={showSources}
            onCheckedChange={v => setBeanSettings({ showSourceContext: v })}
            aria-label="Show what context was used"
          />
          <span className="text-[11px] leading-tight text-muted-foreground">
            Show what context was used
          </span>
        </div>
      </div>

      {focus && (
        <p className="mt-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-[11px] text-gold">
            Topic focus: <span className="max-w-[220px] truncate font-medium">{focus}</span>
            <button
              type="button"
              onClick={() => setFocus(undefined)}
              aria-label="Remove topic focus"
              className="rounded-full p-0.5 text-gold/70 transition-colors hover:bg-gold/10 hover:text-gold"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        </p>
      )}

      {/* Material-scope selector — the student chooses which uploaded documents
          retrieval may use. Empty selection = all analysed materials. */}
      {materials && materials.length > 0 && (
        <div className="mt-2 rounded-lg border border-border bg-elevated/50 px-3 py-2" aria-label="Grounding scope">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Ground in
            </span>
            <Toggle
              variant="outline"
              size="sm"
              pressed={scopeDocs.length === 0}
              onPressedChange={() => setScopeDocs([])}
              aria-label="Ground in all analysed materials"
              className={cn(
                'h-7 border-border px-2 text-[11px] text-muted-foreground hover:text-foreground',
                'data-[state=on]:border-gold/50 data-[state=on]:bg-gold/10 data-[state=on]:text-gold'
              )}
            >
              All materials
            </Toggle>
            {materials.map(m => (
              <Toggle
                key={m.id}
                variant="outline"
                size="sm"
                pressed={scopeDocs.includes(m.id)}
                onPressedChange={() =>
                  setScopeDocs(prev => (prev.includes(m.id) ? prev.filter(d => d !== m.id) : [...prev, m.id]))
                }
                aria-label={`Ground in ${m.title}`}
                className={cn(
                  'h-7 max-w-[180px] border-border px-2 text-[11px] text-muted-foreground hover:text-foreground',
                  'data-[state=on]:border-gold/50 data-[state=on]:bg-gold/10 data-[state=on]:text-gold'
                )}
              >
                <span className="truncate">{m.title}</span>
              </Toggle>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {scopeDocs.length === 0
              ? 'Answers are retrieved from all of your analysed materials.'
              : `Answers are retrieved from ${scopeDocs.length === 1 ? '1 selected material' : `${scopeDocs.length} selected materials`} only.`}
          </p>
        </div>
      )}

      <div
        ref={scrollRef}
        className={cn('mt-3 space-y-3 overflow-y-auto pr-1', compact ? 'max-h-64' : 'max-h-96')}
        aria-live="polite"
      >
        {turns === null && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" aria-hidden /> Loading conversation…
          </p>
        )}
        {turns !== null && turns.length === 0 && (
          <p className="rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {greeting}
          </p>
        )}
        {turns?.map(t => (
          <div key={t.id} className={cn('flex flex-col gap-1', t.role === 'user' ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'max-w-[92%] rounded-lg px-3 py-2 text-sm leading-relaxed',
                t.role === 'user'
                  ? 'bg-gold/15 text-foreground'
                  : 'border border-border bg-elevated text-foreground',
              )}
            >
              <p className="whitespace-pre-wrap">{t.content}</p>
            </div>
            {t.role === 'assistant' && <GroundingBadge grounding={t.grounding} />}
            {t.role === 'assistant' && showSources && (
              <SourcesPanel turn={t} onOpenPage={onOpenPage} />
            )}
          </div>
        ))}
        {sending && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" aria-hidden /> Riishe is thinking…
          </p>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={e => {
          e.preventDefault()
          send()
        }}
      >
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={placeholder}
          aria-label="Ask Riishe a follow-up question"
          maxLength={2000}
          className="h-10"
        />
        <Button type="submit" size="icon" className="h-10 w-10 shrink-0 bg-gold text-primary-foreground hover:bg-gold-hover" disabled={!input.trim() || sending} aria-label="Send question">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        </Button>
      </form>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Grounded answers cite your uploaded documents with page numbers. Time-sensitive questions are answered
        from live web results, shown separately and never mixed into your material&apos;s citations — otherwise
        they are flagged as unverified. General-knowledge answers are labelled as such.
      </p>
    </div>
  )
}

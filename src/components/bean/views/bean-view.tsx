'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { BeanChatMessage, BeanContext, BeanSettings } from '@/lib/types'
import { Markdown } from '@/components/bean/markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { BookOpen, Info, RotateCcw, Send, Sparkles, X } from 'lucide-react'

const STYLE_OPTIONS: { value: BeanSettings['style']; label: string }[] = [
  { value: 'exam-focused', label: 'Exam-focused' },
  { value: 'simple', label: 'Simple' },
  { value: 'detailed', label: 'Detailed' },
]

const GREETING =
  "Hello! I'm BEAN Intelligence. Ask me about any topic you're studying — or open a topic page and bring its context here. I can explain concepts, summarise notes, quiz you, and help plan revision."

const SUGGESTED_PROMPTS = [
  'Explain the basic structure doctrine',
  'Give me 5 revision questions on percentages',
  'How do I prepare current affairs?',
  'Compare simple vs compound interest',
]

interface ChatEntry {
  id: number
  role: 'user' | 'assistant'
  content: string
  usedContext?: string[]
  isError?: boolean
  retryPayload?: BeanChatMessage[]
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function contextChips(ctx: BeanContext): { label: string; value: string }[] {
  const chips: { label: string; value: string }[] = []
  if (ctx.examName) chips.push({ label: 'Exam', value: ctx.examName })
  if (ctx.stageName) chips.push({ label: 'Stage', value: ctx.stageName })
  if (ctx.subjectName) chips.push({ label: 'Subject', value: ctx.subjectName })
  if (ctx.topicName) chips.push({ label: 'Topic', value: ctx.topicName })
  if (ctx.noteTitle) chips.push({ label: 'Note', value: ctx.noteTitle })
  if (ctx.questionText) chips.push({ label: 'Question', value: truncate(ctx.questionText, 90) })
  if (ctx.questionOptions && ctx.questionOptions.length > 0) {
    chips.push({ label: 'MCQ', value: `${ctx.questionOptions.length} options attached` })
  }
  if (ctx.attemptSummary) chips.push({ label: 'Attempt summary', value: truncate(ctx.attemptSummary, 140) })
  return chips
}

function SparkleAvatar() {
  return (
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
      <Sparkles className="h-3.5 w-3.5 text-gold" />
    </span>
  )
}

function MessageBubble({
  entry,
  showSource,
  onRetry,
  canRetry,
}: {
  entry: ChatEntry
  showSource: boolean
  onRetry: (entry: ChatEntry) => void
  canRetry: boolean
}) {
  if (entry.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm border border-gold/30 bg-gold/10 px-4 py-2.5 text-sm leading-relaxed text-foreground">
          {entry.content}
        </div>
      </div>
    )
  }

  if (entry.isError) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[88%] rounded-2xl rounded-bl-sm border border-destructive/40 bg-destructive/10 px-4 py-3">
          <p className="flex items-start gap-2 text-sm leading-relaxed text-destructive">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{entry.content}</span>
          </p>
          {canRetry && entry.retryPayload && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onRetry(entry)}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-start gap-2.5">
      <SparkleAvatar />
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3">
        <Markdown content={entry.content} />
        {showSource && (
          <p className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
            Context used:{' '}
            {entry.usedContext && entry.usedContext.length > 0
              ? entry.usedContext.join(', ')
              : 'No topic context attached'}
          </p>
        )}
      </div>
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex items-start justify-start gap-2.5">
      <SparkleAvatar />
      <div className="rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3.5" role="status" aria-label="BEAN is composing a reply">
        <span className="flex items-center gap-1.5">
          {[0, 150, 300].map(delay => (
            <span
              key={delay}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}

export function BeanView({ seeded }: { seeded?: boolean }) {
  const beanContext = useAppStore(s => s.beanContext)
  const beanSettings = useAppStore(s => s.beanSettings)
  const setBeanSettings = useAppStore(s => s.setBeanSettings)
  const setBeanContext = useAppStore(s => s.setBeanContext)
  const guestId = useAppStore(s => s.guestId)

  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [showSeededHint, setShowSeededHint] = useState(Boolean(seeded))

  const idRef = useRef(0)
  const nextId = () => ++idRef.current
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, pending])

  const request = (payload: BeanChatMessage[]) => {
    if (!guestId) return
    setPending(true)
    api
      .beanChat({ guestId, messages: payload, context: beanContext ?? {}, settings: beanSettings })
      .then(res => {
        const reply: ChatEntry = {
          id: nextId(),
          role: 'assistant',
          content: res.reply,
          usedContext: Array.isArray(res.usedContext) ? res.usedContext : [],
        }
        setMessages(prev => [...prev, reply])
      })
      .catch((e: unknown) => {
        const entry: ChatEntry = {
          id: nextId(),
          role: 'assistant',
          content: e instanceof Error ? e.message : 'Something went wrong. Please try again.',
          isError: true,
          retryPayload: payload,
        }
        setMessages(prev => [...prev, entry])
      })
      .finally(() => setPending(false))
  }

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || pending || !guestId) return
    const history: BeanChatMessage[] = messages
      .filter(m => !m.isError)
      .map(m => ({ role: m.role, content: m.content }))
    const payload: BeanChatMessage[] = [...history, { role: 'user', content: trimmed }]
    const userEntry: ChatEntry = { id: nextId(), role: 'user', content: trimmed }
    setMessages(prev => [...prev, userEntry])
    setInput('')
    request(payload)
  }

  const retry = (failed: ChatEntry) => {
    const payload = failed.retryPayload
    if (pending || !payload || !guestId) return
    const cleaned = messages.filter(m => !m.isError)
    const lastUser = [...payload].reverse().find(m => m.role === 'user')?.content ?? ''
    const last = cleaned[cleaned.length - 1]
    if (last && last.role === 'user' && last.content === lastUser) {
      setMessages(cleaned)
    } else {
      setMessages([...cleaned, { id: nextId(), role: 'user', content: lastUser }])
    }
    request(payload)
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    send(input)
  }

  const chips = beanContext ? contextChips(beanContext) : []

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gold/30 bg-gold/10">
          <Sparkles className="h-5 w-5 text-gold" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground sm:text-4xl">BEAN Intelligence</h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Context-aware learning support — grounded in your current topic
          </p>
        </div>
      </header>

      {/* One-time hint when context was carried over */}
      {showSeededHint && (
        <div
          className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-gold/30 bg-gold/10 px-4 py-2.5"
          role="status"
        >
          <p className="flex items-center gap-2 text-sm text-gold">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden /> Context carried over from your last topic
          </p>
          <button
            type="button"
            onClick={() => setShowSeededHint(false)}
            aria-label="Dismiss hint"
            className="rounded p-1 text-gold/80 transition-colors hover:bg-gold/10 hover:text-gold"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {/* Context panel */}
      <section aria-label="Active context" className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BookOpen className="h-4 w-4 text-gold" aria-hidden /> Active context
          </h2>
          {beanContext && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => setBeanContext(null)}
            >
              Clear context
            </Button>
          )}
        </div>

        {beanContext ? (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.map(chip => (
                <span
                  key={chip.label}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs"
                >
                  <span className="shrink-0 font-semibold uppercase tracking-wide text-gold">{chip.label}</span>
                  <span className="truncate text-foreground">{chip.value}</span>
                </span>
              ))}
            </div>
            {beanContext.topicId && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-gold/20 bg-gold/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
                The study note attached to this topic will be provided to the model as grounding for its answers.
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            No context attached — BEAN will answer from general knowledge. Open any topic or question in the
            catalogue and choose &ldquo;Ask BEAN&rdquo; to bring its context here.
          </p>
        )}
      </section>

      {/* Settings row */}
      <section aria-label="BEAN response settings" className="mt-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Response style
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
                  'border-border text-muted-foreground hover:text-foreground',
                  'data-[state=on]:border-gold/50 data-[state=on]:bg-gold/10 data-[state=on]:text-gold'
                )}
              >
                {opt.label}
              </Toggle>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="leading-snug">
              <span className="block text-sm text-foreground">Show what context was used</span>
              <span className="block text-xs text-muted-foreground">Adds a source line under each answer</span>
            </span>
            <Switch
              checked={beanSettings.showSourceContext}
              onCheckedChange={v => setBeanSettings({ showSourceContext: v })}
              aria-label="Show what context was used"
            />
          </div>
        </div>
      </section>

      {/* Chat area */}
      <section
        aria-label="BEAN Intelligence chat"
        className="mt-5 flex h-[min(70vh,560px)] flex-col overflow-hidden rounded-xl border border-border bg-card"
      >
        <div ref={scrollRef} role="log" aria-live="polite" className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 && (
            <>
              <div className="flex items-start justify-start gap-2.5">
                <SparkleAvatar />
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3">
                  <p className="text-sm leading-relaxed text-muted-foreground">{GREETING}</p>
                </div>
              </div>
              <div className="sm:pl-9">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Try asking
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTED_PROMPTS.map(prompt => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => send(prompt)}
                      disabled={pending}
                      className="rounded-lg border border-border bg-elevated px-3 py-2.5 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:border-gold/40 hover:text-gold disabled:pointer-events-none disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {messages.map(entry => (
            <MessageBubble
              key={entry.id}
              entry={entry}
              showSource={beanSettings.showSourceContext}
              onRetry={retry}
              canRetry={!pending && Boolean(guestId)}
            />
          ))}

          {pending && <TypingIndicator />}
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border bg-elevated/40 p-3 sm:p-4">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about any topic, or request a quiz…"
            aria-label="Message BEAN Intelligence"
            disabled={pending}
            className="h-11 flex-1 border-border bg-elevated text-sm"
          />
          <Button
            type="submit"
            disabled={pending || !input.trim()}
            className="h-11 shrink-0 bg-gold text-primary-foreground hover:bg-gold-hover"
          >
            <Send className="h-4 w-4" aria-hidden />
            <span className="sr-only sm:not-sr-only sm:inline">Send</span>
          </Button>
        </form>
      </section>

      {/* Honesty footnote */}
      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
        Answers are generated by the platform&apos;s connected AI provider. BEAN cannot browse the web or open files —
        it receives only your messages, the context attached above and, when a topic is set, an excerpt of its study
        note. Answers may contain mistakes; verify important facts against your notes.
      </p>
    </div>
  )
}

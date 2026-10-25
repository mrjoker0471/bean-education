'use client'

// Standalone BEAN Intelligence route (#/bean).
// The chat itself lives in BeanChatPanel — the single implementation shared
// with the exam page's BEAN Intelligence tab. This wrapper keeps the page-level
// header, the one-time "context carried over" hint and the full-page layout.

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import { BeanChatPanel, BEAN_GREETING } from '@/components/bean/bean-chat-panel'
import { Sparkles, X } from 'lucide-react'

export function BeanView({ seeded }: { seeded?: boolean }) {
  const beanContext = useAppStore(s => s.beanContext)

  const [showSeededHint, setShowSeededHint] = useState(Boolean(seeded))

  // Reset the hint whenever a fresh "seeded" navigation happens
  // (guarded render-time adjustment — react.dev/learn/you-might-not-need-an-effect)
  const [lastSeeded, setLastSeeded] = useState(seeded)
  if (lastSeeded !== seeded) {
    setLastSeeded(seeded)
    setShowSeededHint(Boolean(seeded))
  }

  // Personalised greeting when a topic is in context
  const greeting = beanContext?.topicName
    ? `Hello! I'm BEAN Intelligence. You're focusing on "${beanContext.topicName}"${
        beanContext.examName ? ` (${beanContext.examName})` : ''
      } — its study note is attached as grounding. Ask me to explain it, simplify it, quiz you on it, or plan your revision.`
    : BEAN_GREETING

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

      <div className="mt-5">
        <BeanChatPanel variant="page" greeting={greeting} />
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { CatalogResponse } from '@/lib/types'
import { useAppStore, parseHash } from '@/lib/store'
import { SectionHeading } from '@/components/bean/section-heading'
import { CountPill } from '@/components/bean/count-pill'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/bean/empty-state'
import { cn } from '@/lib/utils'
import {
  BookOpen, Brain, ClipboardCheck, GraduationCap,
  Sparkles, Target, Upload,
} from 'lucide-react'

export function HomeView() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null)

  useEffect(() => {
    let alive = true
    api.catalog()
      .then(c => { if (alive) setCatalog(c) })
      .catch(() => { /* totals are optional — the pills simply stay hidden */ })
    return () => { alive = false }
  }, [])

  return (
    <div className="flex flex-col">
      <Hero totals={catalog?.totals} />
      <BeanMethod />
      <FinalCta />
    </div>
  )
}

// ─── Hero ───
function Hero({ totals }: { totals?: CatalogResponse['totals'] }) {
  const navigate = useAppStore(s => s.navigate)
  const guestId = useAppStore(s => s.guestId)
  // Smart "Continue Learning" target — resolved lazily, label stays constant.
  const [continueHash, setContinueHash] = useState<string | null>(null)

  useEffect(() => {
    if (!guestId) return
    let alive = true
    const resolve = async () => {
      // 1) A READY material → resume in the Riishe workspace (latest first)
      try {
        const mats = await api.materials(guestId)
        const ready = (mats.materials ?? [])
          .filter(m => m.status === 'READY')
          .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
        if (ready.length > 0) {
          if (alive) setContinueHash(`#/riishe/${encodeURIComponent(ready[0].id)}`)
          return
        }
      } catch { /* fall through to attempt-based continuation */ }
      // 2) Latest in-progress attempt → resume it; latest finished attempt → its result
      try {
        const prog = await api.progress(guestId)
        if (!alive) return
        const recent = [...prog.attempts].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        const inProgress = recent.find(a => a.status === 'IN_PROGRESS')
        if (inProgress) {
          if (alive) setContinueHash(`#/test/${inProgress.id}`)
          return
        }
        const finished = recent.find(a => a.status === 'SUBMITTED' || a.status === 'TIMED_OUT')
        if (finished) {
          if (alive) setContinueHash(`#/result/${finished.id}`)
          return
        }
      } catch { /* ignore — default target applies */ }
      if (alive) setContinueHash('#/progress')
    }
    void resolve()
    return () => { alive = false }
  }, [guestId])

  const goContinue = () => navigate(parseHash(continueHash ?? '#/progress'))

  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            'radial-gradient(600px 300px at 20% 0%, rgba(214,165,20,0.10), transparent), radial-gradient(500px 260px at 85% 20%, rgba(214,165,20,0.06), transparent)',
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
            <Sparkles className="h-3.5 w-3.5" /> Riishe AI — practise from your own material
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl lg:text-6xl">
            Upload your study material. <span className="text-gold">Let Riishe prepare you.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Turn your textbooks, notes, and syllabus documents into challenging practice exams,
            personalised explanations, and targeted revision.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
            <Button size="lg" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto" onClick={() => navigate({ view: 'materials' })}>
              <Upload className="mr-2 h-4 w-4" /> Upload Study Material
            </Button>
            <Button size="lg" variant="outline" className="w-full border-gold/40 text-gold hover:bg-gold/10 sm:w-auto" onClick={() => navigate({ view: 'catalog' })}>
              <BookOpen className="mr-2 h-4 w-4" /> Explore Exams
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full border-border text-foreground hover:bg-elevated sm:w-auto"
              onClick={goContinue}
            >
              <GraduationCap className="mr-2 h-4 w-4" /> Continue Learning
            </Button>
          </div>
          {totals && (
            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
              <CountPill label="examinations" value={totals.exams} />
              <CountPill label="syllabus topics" value={totals.topics} />
              <CountPill label="original study notes" value={totals.uniqueNotes ?? totals.notes} />
              <CountPill label="practice questions" value={totals.questions} />
              <CountPill label="ready tests" value={totals.tests} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── The BEAN method ───
const METHOD_STEPS = [
  {
    icon: Upload,
    step: 'UPLOAD',
    title: 'Your materials',
    description: 'Upload textbooks, notes, PDFs, previous-year question papers and other supported study materials.',
  },
  {
    icon: Brain,
    step: 'ANALYSE',
    title: 'AI analyses',
    description: 'Riishe identifies chapters, sections and topics from uploaded documents, with source references and honest coverage reporting.',
  },
  {
    icon: Target,
    step: 'PRACTISE',
    title: 'Your questions',
    description: 'Select chapters or topics and generate challenging, source-grounded practice questions.',
  },
  {
    icon: ClipboardCheck,
    step: 'REVIEW',
    title: 'Learn from mistakes',
    description: 'Review answers, understand mistakes and receive explanations grounded in the uploaded material.',
  },
  {
    icon: Sparkles,
    step: 'IMPROVE',
    title: 'Ask Riishe',
    description: 'Ask follow-up questions, clarify difficult concepts, revisit weak topics and continue practising.',
  },
]

function BeanMethod() {
  return (
    <section className="border-t border-border/60 bg-card/40">
      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="The BEAN method"
          title="Upload. Understand. Practise. Improve."
          description="Your study materials become your personal AI-powered learning experience."
        />
        <ol className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {METHOD_STEPS.map((s, i) => (
            <li key={s.step} className="relative rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
                  <s.icon className="h-4 w-4 text-gold" />
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-gold">
                  {i + 1}. {s.step}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// ─── Closing CTA ───
function FinalCta() {
  const navigate = useAppStore(s => s.navigate)
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className={cn('rounded-2xl border border-gold/25 bg-gradient-to-b from-gold/10 to-transparent p-8 text-center sm:p-12')}>
        <h2 className="font-display text-2xl font-semibold text-foreground sm:text-3xl">
          Your materials. Your questions. Your improvement.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          Upload a document, practise questions drawn from it, and let Riishe explain every mistake —
          grounded in the pages you are studying. Guest-friendly by design — your attempts and progress
          are saved on this device automatically.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto" onClick={() => navigate({ view: 'materials' })}>
            <Upload className="mr-2 h-4 w-4" /> Upload Study Material
          </Button>
          <Button size="lg" variant="outline" className="w-full border-gold/40 text-gold hover:bg-gold/10 sm:w-auto" onClick={() => navigate({ view: 'bean', seeded: false })}>
            <Sparkles className="mr-2 h-4 w-4" /> Meet BEAN Intelligence
          </Button>
        </div>
      </div>
    </section>
  )
}

// re-export for potential reuse
export { EmptyState }

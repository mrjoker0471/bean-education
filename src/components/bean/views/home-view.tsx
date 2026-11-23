'use client'

// ─── Public homepage (public experience milestone) ────────────────────────────
// A comprehensive introduction to the real BEAN Education product:
//   • Hero with the platform message and four primary actions.
//   • The actual implemented features (11 cards in three groups), each linked
//     to its real destination route — no simulated features, no invented
//     statistics. Sign-in and teacher-approval requirements are shown honestly.
//   • Clear distinction between the student and teacher experiences.
//   • Backend-powered catalogue counts are retained (hidden on fetch failure).
//   • BEAN's dark + gold identity throughout.

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { CatalogResponse } from '@/lib/types'
import { useAppStore, parseHash, type Route } from '@/lib/store'
import { SectionHeading } from '@/components/bean/section-heading'
import { CountPill } from '@/components/bean/count-pill'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  BookOpen, Brain, Building2, Briefcase, ClipboardCheck, Compass, FileText, GraduationCap,
  LayoutDashboard, LineChart, LogIn, ShieldCheck, Sparkles, Target, Upload, Users, Video,
} from 'lucide-react'

// ─── Feature data (single source of truth — every destination is a real route) ─
export interface HomeFeature {
  id: string
  icon: typeof BookOpen
  title: string
  description: string
  /** Destination hash — always parsed by parseHash (never a dead link). */
  hash: string
  /** Honest requirement labels shown on the card. */
  requires?: ('sign-in' | 'teacher-approval')[]
  /** Extra context line (e.g. works in guest mode). */
  note?: string
}

export const FEATURE_GROUPS: { eyebrow: string; title: string; blurb: string; features: HomeFeature[] }[] = [
  {
    eyebrow: 'Learn and prepare',
    title: 'Everything you need to study smarter',
    blurb: 'From the examination catalogue to AI-grounded practice — built for real syllabi and real study material.',
    features: [
      {
        id: 'exam-preparation',
        icon: BookOpen,
        title: 'Exam preparation',
        description: 'Browse the examination catalogue with syllabi and topics, take practice tests, and review results with explanations drawn from a real question bank.',
        hash: '#/catalog',
      },
      {
        id: 'riishe-ai',
        icon: Brain,
        title: 'Riishe AI',
        description: 'An AI tutor grounded in your own documents: document-backed explanations, follow-up conversations, research sessions with citations, and multilingual answers.',
        hash: '#/riishe',
        note: 'Works from the material you upload — including in guest mode.',
      },
      {
        id: 'study-workspace',
        icon: Upload,
        title: 'Study Workspace',
        description: 'Upload textbooks, notes and past papers, get them analysed into topics, and keep a personal library you can resume any time.',
        hash: '#/materials',
        note: 'Guest-friendly — your session data stays on this device until you claim it.',
      },
      {
        id: 'learning-studio',
        icon: ClipboardCheck,
        title: 'Interactive Learning Studio',
        description: 'Turn a document into concept maps, step-by-step explanations, formula walkthroughs, flashcards, self-marked recall and mini-tests — with history and retention controls.',
        hash: '#/riishe',
        note: 'Open one of your materials to start a Studio activity.',
      },
      {
        id: 'learning-intelligence',
        icon: LineChart,
        title: 'Personal learning intelligence',
        description: 'A dashboard built from your real attempts: progress tracking, study goals, revision planning and honest mistake and weak-topic insights.',
        hash: '#/dashboard',
        requires: ['sign-in'],
      },
    ],
  },
  {
    eyebrow: 'Teach and connect',
    title: 'Teach what you know',
    blurb: 'A marketplace for teachers with verified profiles, real bookings and live classrooms.',
    features: [
      {
        id: 'bean-teach',
        icon: Users,
        title: 'BEAN Teach',
        description: 'Discover teachers, browse profiles and classes, book seats, apply to teach, and run an approved teacher dashboard.',
        hash: '#/classes',
      },
      {
        id: 'live-classrooms',
        icon: Video,
        title: 'Live classrooms',
        description: 'Real-time online classrooms with whiteboard, participant controls, attendance evidence and classroom-safety capabilities — powered by LiveKit when configured.',
        hash: '#/classes?tab=bookings',
        requires: ['sign-in'],
        note: 'Shows an honest “not configured” state until LiveKit credentials exist.',
      },
      {
        id: 'teacher-growth',
        icon: GraduationCap,
        title: 'Teacher growth',
        description: 'Track your application and verification status, manage your classes and reviews, and use the approved-teacher tools.',
        hash: '#/teach/dashboard',
        requires: ['sign-in', 'teacher-approval'],
        note: 'Every teacher completes the application and an authorised review first.',
      },
    ],
  },
  {
    eyebrow: 'Grow and collaborate',
    title: 'Beyond the exam hall',
    blurb: 'Institutions, career opportunities and the BEAN assistant — one account, the whole platform.',
    features: [
      {
        id: 'institutions',
        icon: Building2,
        title: 'Institutions',
        description: 'An institution workspace with groups, memberships, assignments, resources and reports for schools, coaching centres and organisations.',
        hash: '#/institution',
        requires: ['sign-in'],
      },
      {
        id: 'career',
        icon: Briefcase,
        title: 'Career and opportunities',
        description: 'Build a career profile and portfolio, add skills and credentials, apply to opportunities, and control employer discovery with consent.',
        hash: '#/career',
        note: 'Browsing is public; profile features use your account.',
      },
      {
        id: 'bean-intelligence',
        icon: Sparkles,
        title: 'BEAN Intelligence',
        description: 'The BEAN assistant experience — ask about the platform, your syllabus, or where to start.',
        hash: '#/bean',
      },
    ],
  },
]

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
      <AudienceSplit />
      <FeatureShowcase />
      <BeanMethod />
      <TrustStrip />
      <FinalCta />
    </div>
  )
}

// ─── Hero ───
function Hero({ totals }: { totals?: CatalogResponse['totals'] }) {
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
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
            'radial-gradient(700px 320px at 18% 0%, rgba(214,165,20,0.12), transparent), radial-gradient(560px 280px at 85% 18%, rgba(214,165,20,0.07), transparent)',
        }}
      />
      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
            <Sparkles className="h-3.5 w-3.5" /> The education platform built around your own material
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl lg:text-6xl">
            Learn. Practise. Teach. <span className="text-gold">Grow. All in one place.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            BEAN Education is one platform for students, teachers, institutions and learners preparing for
            examinations or building skills — from an examination catalogue and AI-grounded practice to live
            classrooms, institution workspaces and career opportunities.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
            <Button size="lg" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto" onClick={() => navigate({ view: 'catalog' })}>
              <Compass className="mr-2 h-4 w-4" /> Explore BEAN
            </Button>
            <Button size="lg" variant="outline" className="w-full border-gold/40 text-gold hover:bg-gold/10 sm:w-auto" onClick={() => navigate(authedStudent ? { view: 'materials' } : { view: 'auth' })}>
              <GraduationCap className="mr-2 h-4 w-4" /> Start learning
            </Button>
            <Button size="lg" variant="outline" className="w-full border-border text-foreground hover:bg-elevated sm:w-auto" onClick={() => navigate({ view: 'classes' })}>
              <Users className="mr-2 h-4 w-4" /> Explore classes
            </Button>
            <Button size="lg" variant="ghost" className="w-full text-gold hover:bg-gold/10 sm:w-auto" onClick={() => navigate({ view: 'teach-apply' })}>
              Become a teacher
            </Button>
            {continueHash && continueHash !== '#/progress' && (
              <Button size="lg" variant="ghost" className="w-full text-muted-foreground hover:bg-elevated sm:w-auto" onClick={goContinue}>
                Continue where you left off
              </Button>
            )}
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

// ─── Student / Teacher split ───
function AudienceSplit() {
  const navigate = useAppStore(s => s.navigate)
  return (
    <section className="border-b border-border/60 bg-card/40">
      <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-14 sm:px-6 md:grid-cols-2 lg:px-8">
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">For students</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">Prepare with your own material</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Upload your textbooks and notes, practise with Riishe, track mastery and revision, and book classes
              from approved teachers — in guest mode or with an account that follows you across devices.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'auth' })}>
              Start learning
            </Button>
            <Button variant="outline" className="border-gold/40 text-gold hover:bg-gold/10" onClick={() => navigate({ view: 'catalog' })}>
              Browse exams
            </Button>
          </div>
        </div>
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold">For teachers</p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">Teach with real classroom tools</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Apply once, get verified by the BEAN team, then publish classes, take bookings, run live classrooms
              with attendance evidence and grow from verified student reviews. One account — learning stays yours.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button className="bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => navigate({ view: 'teach-apply' })}>
              Become a teacher
            </Button>
            <Button variant="outline" className="border-border text-foreground hover:bg-elevated" onClick={() => navigate({ view: 'classes' })}>
              Explore classes
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Feature showcase ───
function FeatureCard({ feature }: { feature: HomeFeature }) {
  const navigate = useAppStore(s => s.navigate)
  const open = () => navigate(parseHash(feature.hash) as Route)
  return (
    <button
      type="button"
      onClick={open}
      data-feature={feature.id}
      className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-gold/40 hover:bg-elevated/60 focus-visible:outline-2 focus-visible:outline-gold"
      aria-label={`${feature.title} — open`}
    >
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
          <feature.icon className="h-4 w-4 text-gold" aria-hidden />
        </span>
        <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>
          Open →
        </span>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{feature.title}</h3>
      <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">{feature.description}</p>
      {feature.note && <p className="mt-2 text-xs italic leading-relaxed text-muted-foreground/80">{feature.note}</p>}
      {(feature.requires?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {feature.requires?.includes('sign-in') && (
            <Badge variant="outline" className="border-border text-muted-foreground">
              <LogIn className="mr-1 h-3 w-3" aria-hidden /> Sign-in required
            </Badge>
          )}
          {feature.requires?.includes('teacher-approval') && (
            <Badge variant="outline" className="border-gold/40 text-gold">
              <ShieldCheck className="mr-1 h-3 w-3" aria-hidden /> Approved teachers
            </Badge>
          )}
        </div>
      )}
    </button>
  )
}

function FeatureShowcase() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        {FEATURE_GROUPS.map(group => (
          <div key={group.eyebrow} className="mt-12 first:mt-0">
            <SectionHeading eyebrow={group.eyebrow} title={group.title} description={group.blurb} />
            <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={`${group.eyebrow} features`}>
              {group.features.map(f => (
                <li key={f.id} className="h-full">
                  <FeatureCard feature={f} />
                </li>
              ))}
            </ul>
          </div>
        ))}
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
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-gold">
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

// ─── Trust strip ───
function TrustStrip() {
  const navigate = useAppStore(s => s.navigate)
  const links = [
    { label: 'Terms and Conditions', hash: '#/terms' },
    { label: 'Privacy Policy', hash: '#/privacy' },
    { label: 'Trust & Safety', hash: '#/trust-policy' },
    { label: 'Your data rights', hash: '#/settings' },
  ]
  return (
    <section aria-label="Trust and legal links" className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-muted-foreground sm:px-6 lg:px-8">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-gold" aria-hidden />
          Honest by design: features are never simulated — unavailable means unavailable.
        </span>
        {links.map(l => (
          <button
            key={l.hash}
            type="button"
            className="underline-offset-2 transition-colors hover:text-gold hover:underline"
            onClick={() => navigate(parseHash(l.hash) as Route)}
          >
            {l.label}
          </button>
        ))}
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
          One account. Every journey — learning, teaching, growing.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
          Start with the examination catalogue, bring your own material to Riishe, book a class with an approved
          teacher, or apply to teach. Guest-friendly by design — your attempts and progress are saved on this
          device automatically.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" className="w-full bg-gold text-primary-foreground hover:bg-gold-hover sm:w-auto" onClick={() => navigate({ view: 'auth' })}>
            <LayoutDashboard className="mr-2 h-4 w-4" /> Create your account
          </Button>
          <Button size="lg" variant="outline" className="w-full border-gold/40 text-gold hover:bg-gold/10 sm:w-auto" onClick={() => navigate({ view: 'catalog' })}>
            <Compass className="mr-2 h-4 w-4" /> Explore the catalogue
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          <FileText className="mr-1 inline h-3 w-3" aria-hidden />
          Read the <a href="#/terms" className="text-gold underline underline-offset-2">Terms</a> and{' '}
          <a href="#/privacy" className="text-gold underline underline-offset-2">Privacy Policy</a> — both are public
          and always reachable from the footer.
        </p>
      </div>
    </section>
  )
}

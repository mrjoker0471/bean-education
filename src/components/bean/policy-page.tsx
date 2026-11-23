'use client'

// ─── Shared public-policy page shell (Terms / Privacy) ────────────────────────
// Professional legal-document layout on the BEAN Education design system:
//   • Document header with version, last-updated and effective-date chips —
//     every value comes from /api/legal/config; anything the owner has not
//     configured renders as an explicit honest notice (never invented).
//   • Section navigation: sticky glass table of contents with scroll-spy on
//     desktop, collapsible "On this page" panel on mobile.
//   • Section classification (rights, responsibilities, privacy practices,
//     important notices, operator & grievance) so long documents scan clearly.
//   • `Notice` callout for statements that must not be missed.
// Honesty rules (unchanged):
//   • Legal-operator details come from /api/legal/config — anything the owner
//     has not configured renders as an explicit "to be provided" notice; an
//     address or email is NEVER invented.
//   • While the shipped versions are repository drafts, a clear draft notice
//     says the text is pending the owner's Indian legal review, and the
//     effective date is never claimed — the documents are not yet in effect.

import { useEffect, useState } from 'react'
import {
  ArrowUp,
  Building2,
  ClipboardList,
  FileText,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import type { LegalConfigDTO } from '@/lib/types'

export type PolicySectionKind =
  | 'notice'
  | 'rights'
  | 'responsibilities'
  | 'privacy'
  | 'operator'
  | 'general'

const KIND_META: Record<Exclude<PolicySectionKind, 'general'>, { icon: LucideIcon; label: string }> = {
  notice: { icon: ShieldAlert, label: 'Important notice' },
  rights: { icon: Scale, label: 'Your rights' },
  responsibilities: { icon: ClipboardList, label: 'Responsibilities' },
  privacy: { icon: Lock, label: 'Privacy practice' },
  operator: { icon: Building2, label: 'Operator & grievance' },
}

export interface PolicySection {
  id: string
  title: string
  /** Classification shown as a small badge above the heading; `general`
   *  sections carry no badge. Purely visual — never changes the legal text. */
  kind?: PolicySectionKind
  body: React.ReactNode
}

/** Callout for statements that must not be missed. Visual wrapper only —
 *  the text passed through it stays verbatim. */
export function Notice({
  icon: Icon = ShieldAlert,
  title = 'Important notice',
  children,
}: {
  icon?: LucideIcon
  title?: string
  children: React.ReactNode
}) {
  return (
    <div role="note" className="rounded-xl border border-gold/30 bg-gold/[0.07] p-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gold">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {title}
      </p>
      <div className="mt-2 text-sm leading-relaxed text-champagne/90 [&_a]:text-gold [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-foreground">
        {children}
      </div>
    </div>
  )
}

function ConfiguredItem({ label, value, emphasize = false }: { label: string; value: string | null; emphasize?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 sm:flex-row sm:gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-56 sm:shrink-0">{label}</span>
      {value ? (
        <span className={emphasize ? 'text-sm font-medium text-champagne' : 'text-sm text-foreground'}>{value}</span>
      ) : (
        <span className="text-sm italic text-muted-foreground" title="The owner has not supplied this detail yet">
          To be provided — the operator has not configured this detail yet
        </span>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function MetaChip({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'pending' }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-full border border-hairline glass-soft px-3 py-1 text-xs">
      <span className="uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className={tone === 'pending' ? 'text-muted-foreground' : 'font-medium text-champagne'}>{value}</span>
    </span>
  )
}

export function PolicyPage(props: {
  title: string
  intro: string
  version: string | null
  versionsAreDraft: boolean
  dates?: LegalConfigDTO['dates']
  sections: PolicySection[]
  ariaLabel: string
}) {
  const [config, setConfig] = useState<LegalConfigDTO | null>(null)
  const [active, setActive] = useState<string>(props.sections[0]?.id ?? '')
  const [showBackToTop, setShowBackToTop] = useState(false)

  useEffect(() => {
    void api.legalConfig().then(c => setConfig(c)).catch(() => setConfig(null))
  }, [])

  useEffect(() => {
    // Scroll-spy for the section navigation.
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id.replace('policy-', ''))
        }
      },
      { rootMargin: '-20% 0% -70% 0%' },
    )
    for (const s of props.sections) {
      const el = document.getElementById(`policy-${s.id}`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [props.sections])

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 700)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const dates = props.dates ?? config?.dates ?? null
  const lastUpdated = dates?.terms?.lastUpdated ?? null
  const effectiveDate = dates?.terms?.effectiveDate ?? null

  const toc = (
    <ol className="space-y-1 text-sm">
      {props.sections.map((s, i) => (
        <li key={s.id}>
          <a
            href={`#policy-${s.id}`}
            onClick={e => {
              e.preventDefault()
              document.getElementById(`policy-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              setActive(s.id)
            }}
            aria-current={active === s.id ? 'true' : undefined}
            className={`block rounded-md px-2 py-1.5 transition-colors ${
              active === s.id ? 'bg-gold/10 text-champagne' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
            }`}
          >
            <span className="mr-1.5 text-xs text-muted-foreground">{i + 1}.</span>
            {s.title}
          </a>
        </li>
      ))}
    </ol>
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6" aria-label={props.ariaLabel}>
      {/* Document header */}
      <header className="mx-auto max-w-3xl">
        <p className="mb-3 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-gold">
          <span aria-hidden className="h-px w-6 bg-gold/40" />
          Legal document
          <span aria-hidden className="h-px w-6 bg-gold/40" />
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{props.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{props.intro}</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {props.version && <MetaChip label="Version" value={props.version} />}
          <MetaChip
            label="Last updated"
            value={lastUpdated ? formatDate(lastUpdated) : 'To be recorded — pending legal review'}
            tone={lastUpdated ? 'default' : 'pending'}
          />
          <MetaChip
            label="Effective date"
            value={effectiveDate ? formatDate(effectiveDate) : 'Not yet in effect — pending legal review'}
            tone={effectiveDate ? 'default' : 'pending'}
          />
          {props.versionsAreDraft && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Draft — pending the owner&apos;s Indian legal review (not legal advice or a legal opinion)
            </span>
          )}
        </div>
      </header>

      <div className="mt-10 flex flex-col gap-8 lg:flex-row">
        {/* Section navigation — collapsible panel on mobile, sticky glass rail on desktop */}
        <nav aria-label={`${props.title} sections`} className="lg:w-64 lg:shrink-0">
          <details className="glass-soft rounded-xl border border-hairline lg:hidden">
            <summary className="cursor-pointer select-none list-none px-4 py-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
              <span className="flex items-center justify-between">
                On this page
                <span className="text-xs text-muted-foreground">{props.sections.length} sections</span>
              </span>
            </summary>
            <div className="border-t border-hairline px-2 pb-3 pt-2">{toc}</div>
          </details>
          <div className="glass-soft sticky top-24 hidden max-h-[70vh] overflow-y-auto rounded-xl border border-hairline p-3 lg:block">
            {toc}
          </div>
        </nav>

        {/* Sections */}
        <div className="min-w-0 flex-1 space-y-8">
          {props.sections.map((s, i) => {
            const meta = s.kind && s.kind !== 'general' ? KIND_META[s.kind] : null
            return (
              <section
                key={s.id}
                id={`policy-${s.id}`}
                aria-labelledby={`policy-${s.id}-title`}
                className="glass-soft scroll-mt-24 rounded-2xl border border-hairline p-5 sm:p-7"
              >
                {meta && (
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
                    <meta.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {meta.label}
                  </p>
                )}
                <h2 id={`policy-${s.id}-title`} className="font-display text-xl font-semibold tracking-tight text-foreground">
                  <span className="mr-2 text-sm text-muted-foreground">{i + 1}.</span>
                  {s.title}
                </h2>
                <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground [&_a]:text-gold [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-foreground [&_li]:ml-4 [&_li]:list-disc [&_ul]:space-y-1.5">
                  {s.body}
                </div>
              </section>
            )
          })}

          {/* Operator / grievance block (config-aware, always shown) */}
          <section
            id="policy-operator"
            aria-labelledby="policy-operator-title"
            className="glass-soft scroll-mt-24 rounded-2xl border border-hairline p-5 sm:p-7"
          >
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
              <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Operator &amp; grievance
            </p>
            <h2 id="policy-operator-title" className="font-display text-xl font-semibold tracking-tight text-foreground">
              Platform operator and grievance contact
            </h2>
            {config && !config.configured && (
              <p className="mt-2 rounded-lg border border-gold/30 bg-gold/10 p-2.5 text-xs leading-relaxed text-gold" role="note">
                Draft/configuration notice: the legal identity and grievance details below have not been supplied by
                the owner yet. This page will show the verified details once they are configured — none are invented.
              </p>
            )}
            <div className="mt-4">
              <ConfiguredItem label="Legal entity / operator" value={config?.operator.entityName ?? null} />
              <ConfiguredItem label="Registered address" value={config?.operator.entityAddress ?? null} />
              <ConfiguredItem label="Consumer support email" value={config?.operator.consumerSupport.email ?? null} />
              <ConfiguredItem label="Consumer support phone" value={config?.operator.consumerSupport.phone ?? null} />
              <ConfiguredItem label="Grievance Officer" value={config?.operator.grievanceOfficer.name ?? null} emphasize />
              <ConfiguredItem label="Grievance email" value={config?.operator.grievanceOfficer.email ?? null} emphasize />
              <ConfiguredItem label="Grievance phone" value={config?.operator.grievanceOfficer.phone ?? null} emphasize />
              <ConfiguredItem label="Privacy contact" value={config?.operator.privacyContactEmail ?? null} />
              <ConfiguredItem label="Terms version" value={config?.termsVersion ?? props.version} />
              <ConfiguredItem label="Privacy Policy version" value={config?.privacyVersion ?? null} />
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
              Privacy and grievance requests can be raised directly in the product under{' '}
              <a href="#/settings">Settings → Privacy</a>; the request is owner-scoped and confidential.
            </p>
          </section>
        </div>
      </div>

      {/* Back to top — appears on long documents, both mobile and desktop */}
      {showBackToTop && (
        <button
          type="button"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="glass fixed bottom-5 right-5 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-hairline text-gold transition-colors hover:border-gold/40 hover:text-champagne"
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

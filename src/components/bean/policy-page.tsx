'use client'

// ─── Shared public-policy page shell (Terms / Privacy) ────────────────────────
// Readable section navigation, version/effective-date display and a
// configuration-aware operator/grievance block. Honesty rules:
//   • Legal-operator details come from /api/legal/config — anything the owner
//     has not configured renders as an explicit "to be provided" notice; an
//     address or email is NEVER invented.
//   • While the shipped versions are repository drafts, a clear draft notice
//     says the text is pending the owner's Indian legal review.

import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import type { LegalConfigDTO } from '@/lib/types'

export interface PolicySection {
  id: string
  title: string
  body: React.ReactNode
}

function ConfiguredItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 sm:flex-row sm:gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-56 sm:shrink-0">{label}</span>
      {value ? (
        <span className="text-sm text-foreground">{value}</span>
      ) : (
        <span className="text-sm italic text-muted-foreground" title="The owner has not supplied this detail yet">
          To be provided — the operator has not configured this detail yet
        </span>
      )}
    </div>
  )
}

export function PolicyPage(props: {
  title: string
  intro: string
  version: string | null
  versionsAreDraft: boolean
  sections: PolicySection[]
  ariaLabel: string
}) {
  const [config, setConfig] = useState<LegalConfigDTO | null>(null)
  const [active, setActive] = useState<string>(props.sections[0]?.id ?? '')

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
      { rootMargin: '-20% 0px -70% 0px' },
    )
    for (const s of props.sections) {
      const el = document.getElementById(`policy-${s.id}`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [props.sections])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6" aria-label={props.ariaLabel}>
      <header className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">{props.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{props.intro}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {props.version && <span>Version: <span className="text-foreground">{props.version}</span></span>}
          {props.versionsAreDraft && (
            <span className="rounded border border-gold/30 bg-gold/10 px-2 py-0.5 text-gold">
              Draft — pending the owner&apos;s Indian legal review (not legal advice or a legal opinion)
            </span>
          )}
        </div>
      </header>

      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        {/* Section navigation */}
        <nav aria-label={`${props.title} sections`} className="lg:w-64 lg:shrink-0">
          <div className="rounded-xl border border-border bg-card/60 p-3 lg:sticky lg:top-24 lg:max-h-[70vh] lg:overflow-y-auto">
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
                      active === s.id ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:bg-elevated hover:text-foreground'
                    }`}
                  >
                    <span className="mr-1.5 text-xs text-muted-foreground">{i + 1}.</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        {/* Sections */}
        <div className="min-w-0 flex-1 space-y-8">
          {props.sections.map((s, i) => (
            <section
              key={s.id}
              id={`policy-${s.id}`}
              aria-labelledby={`policy-${s.id}-title`}
              className="scroll-mt-24 rounded-xl border border-border bg-card/60 p-5 sm:p-6"
            >
              <h2 id={`policy-${s.id}-title`} className="font-display text-xl font-semibold text-foreground">
                <span className="mr-2 text-sm text-muted-foreground">{i + 1}.</span>
                {s.title}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground [&_a]:text-gold [&_a]:underline [&_a]:underline-offset-2 [&_strong]:text-foreground [&_li]:ml-4 [&_li]:list-disc [&_ul]:space-y-1.5">
                {s.body}
              </div>
            </section>
          ))}

          {/* Operator / grievance block (config-aware) */}
          <section
            id="policy-operator"
            aria-labelledby="policy-operator-title"
            className="scroll-mt-24 rounded-xl border border-border bg-card/60 p-5 sm:p-6"
          >
            <h2 id="policy-operator-title" className="font-display text-xl font-semibold text-foreground">
              Platform operator and grievance contact
            </h2>
            {config && !config.configured && (
              <p className="mt-2 rounded-md border border-gold/30 bg-gold/10 p-2 text-xs leading-relaxed text-gold" role="note">
                Draft/configuration notice: the legal identity and grievance details below have not been supplied by
                the owner yet. This page will show the verified details once they are configured — none are invented.
              </p>
            )}
            <div className="mt-4">
              <ConfiguredItem label="Legal entity / operator" value={config?.operator.entityName ?? null} />
              <ConfiguredItem label="Registered address" value={config?.operator.entityAddress ?? null} />
              <ConfiguredItem label="Consumer support email" value={config?.operator.consumerSupport.email ?? null} />
              <ConfiguredItem label="Consumer support phone" value={config?.operator.consumerSupport.phone ?? null} />
              <ConfiguredItem label="Grievance Officer" value={config?.operator.grievanceOfficer.name ?? null} />
              <ConfiguredItem label="Grievance email" value={config?.operator.grievanceOfficer.email ?? null} />
              <ConfiguredItem label="Grievance phone" value={config?.operator.grievanceOfficer.phone ?? null} />
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
    </div>
  )
}

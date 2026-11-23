'use client'

import { useAppStore } from '@/lib/store'
import { BeanMark, Wordmark } from '@/components/bean/brand-mark'
import { ShieldCheck } from 'lucide-react'

export function Footer() {
  const navigate = useAppStore(s => s.navigate)
  const year = new Date().getFullYear()

  const navLinks = [
    { label: 'All examinations', view: { view: 'catalog' } as const },
    { label: 'BEAN Intelligence', view: { view: 'bean', seeded: false } as const },
    { label: 'My progress', view: { view: 'progress' } as const },
    // Phase 7: institution & career entry points
    { label: 'Institutions', view: { view: 'institution' } as const },
    { label: 'Opportunities', view: { view: 'career-opportunities' } as const },
  ]
  const legalLinks = [
    // Public experience milestone: legal pages are public and always reachable
    { label: 'Terms & Conditions', view: { view: 'terms' } as const },
    { label: 'Privacy Policy', view: { view: 'privacy' } as const },
    // Phase 6: published Trust & Safety / class policy
    { label: 'Trust & Safety', view: { view: 'trust-policy' } as const },
    { label: 'Settings', view: { view: 'settings' } as const },
  ]

  return (
    <footer className="mt-auto border-t border-hairline glass-soft pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-start">
          <div className="flex items-center gap-3">
            <BeanMark tileSize="sm" />
            <div>
              <Wordmark size="sm" />
              <p className="mt-1.5 text-xs text-muted-foreground">Learn. Practise. Teach. Grow. Honest availability.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-10">
            <nav className="flex flex-wrap items-start gap-x-5 gap-y-2 text-xs text-muted-foreground md:flex-col md:items-start" aria-label="Footer — platform">
              {navLinks.map(l => (
                <button key={l.label} className="transition-colors hover:text-champagne" onClick={() => navigate(l.view)}>
                  {l.label}
                </button>
              ))}
            </nav>
            <nav className="flex flex-wrap items-start gap-x-5 gap-y-2 text-xs text-muted-foreground md:flex-col md:items-start" aria-label="Footer — legal and trust">
              {legalLinks.map(l => (
                <button key={l.label} className="transition-colors hover:text-champagne" onClick={() => navigate(l.view)}>
                  {l.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-2 border-t border-hairline pt-5 text-[11px] leading-relaxed text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>© {year} BEAN Education. Study notes are original content. Practice questions are original and author-verified — no previous-year provenance is claimed.</p>
          <p className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-gold" />
            Always confirm patterns &amp; dates with the official conducting body&apos;s notification.
          </p>
        </div>
      </div>
    </footer>
  )
}

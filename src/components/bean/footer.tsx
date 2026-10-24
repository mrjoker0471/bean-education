'use client'

import { useAppStore } from '@/lib/store'
import { GraduationCap, ShieldCheck } from 'lucide-react'

export function Footer() {
  const navigate = useAppStore(s => s.navigate)
  const year = new Date().getFullYear()

  return (
    <footer className="mt-auto border-t border-border/80 bg-card/60 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-gold/40 bg-gold/10">
              <GraduationCap className="h-4 w-4 text-gold" />
            </span>
            <div>
              <p className="font-display text-sm font-bold text-foreground">
                BEAN <span className="text-gold">EXAMS</span>
              </p>
              <p className="text-xs text-muted-foreground">One syllabus. Every topic. Honest availability.</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" aria-label="Footer">
            <button className="hover:text-gold" onClick={() => navigate({ view: 'catalog' })}>All examinations</button>
            <button className="hover:text-gold" onClick={() => window.location.assign('#/bean')}>BEAN Intelligence</button>
            <button className="hover:text-gold" onClick={() => navigate({ view: 'progress' })}>My progress</button>
          </nav>
        </div>
        <div className="mt-6 flex flex-col gap-2 border-t border-border/60 pt-5 text-[11px] leading-relaxed text-muted-foreground md:flex-row md:items-center md:justify-between">
          <p>© {year} BEAN EXAMS. Study notes are original content. Practice questions are original and author-verified — no previous-year provenance is claimed.</p>
          <p className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-gold" />
            Always confirm patterns &amp; dates with the official conducting body&apos;s notification.
          </p>
        </div>
      </div>
    </footer>
  )
}

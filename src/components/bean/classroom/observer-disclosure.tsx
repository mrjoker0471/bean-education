'use client'

// ─── BEAN Classroom Intelligence (CI-4G): in-room observer disclosure ────────
// Shown to EVERYONE in the live room when the visible observer is present
// (detected by the participant identity prefix `bean-observer:` — the same
// identity convention the CI-3D webhook accounting relies on, so attendance
// can never count it and the UI can always recognise it).
//
// Honest wording: the observer is visible in the participant list, collects
// STRUCTURED signals only, does NOT record audio or video, and feeds the
// post-class evaluation. No implication of recording exists anywhere.

import { Eye, ShieldCheck } from 'lucide-react'

export const OBSERVER_IDENTITY_PREFIX = 'bean-observer:'

export function isObserverIdentity(identity: string): boolean {
  return identity.startsWith(OBSERVER_IDENTITY_PREFIX)
}

export function ObserverDisclosure({ observerName }: { observerName: string | null }) {
  return (
    <aside
      aria-label="Classroom observer disclosure"
      className="flex items-start gap-2 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-xs leading-relaxed text-foreground"
    >
      <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
      <p>
        <strong className="font-semibold">{observerName ?? 'A classroom observer'}</strong> is present in this class. It is visible
        in the participant list and collects <strong className="font-semibold">structured signals only</strong> — it cannot listen,
        watch or publish anything, and <strong className="font-semibold">no audio or video is being recorded</strong>. Its aggregate,
        identity-free summary helps evaluate the class afterwards. Ask your teacher to remove it at any time.
        <span className="mt-1 flex items-center gap-1 text-muted-foreground">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          Consent-gated · one per room · owner-controlled
        </span>
      </p>
    </aside>
  )
}

'use client'

// ─── LegalConsentRow — accessible, reusable legal-consent row ─────────────────
// One consent document per row: a fixed checkbox column on the left and a
// flexible text column that wraps on its own (the checkbox never shifts when
// text or links wrap, including on mobile).
//
// Alignment and interaction rules encoded here:
//   • CSS grid `grid-cols-[auto_minmax(0,1fr)]` — the checkbox column is fixed,
//     the text column is flexible and cannot overflow horizontally.
//   • The checkbox aligns to the FIRST LINE of the statement text (items-start),
//     both rows use identical padding so they start at the same x position.
//   • The document link is a SIBLING of the <Label> — never nested inside it —
//     so activating the link cannot toggle the checkbox or submit the form.
//   • The version/draft metadata occupies its own muted line and is derived
//     from the server configuration (/api/legal/config) — never hardcoded, and
//     missing configuration renders an honest fallback instead of an invented
//     version or date.
//
// Honesty rules (legal-config): draft documents say "Draft"; a document only
// shows "Effective <date>" when the owner has actually configured an effective
// date — a date is never derived or fabricated, and a draft is never shown as
// approved.

import { ExternalLink } from 'lucide-react'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface LegalConsentRowProps {
  /** Unique element id — associates the checkbox, label and descriptions. */
  id: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  /** The consent statement rendered inside the associated <Label>. */
  statement: string
  /** Document route (existing BEAN Terms/Privacy routes). */
  linkHref: string
  /** Visible link text, e.g. "Read the Terms & Conditions". */
  linkLabel: string
  /** Configured document version from /api/legal/config (null = unconfigured). */
  version: string | null
  /** Server-reported draft status (undefined = config unavailable). */
  draft?: boolean
  /** Effective date ONLY when the owner configured one (never fabricated). */
  effectiveDate?: string | null
  disabled?: boolean
  /** Renders the row's top border (second row inside a shared surface). */
  separated?: boolean
  /** Extra ids for aria-describedby on the checkbox. */
  describedBy?: string
}

export function LegalConsentRow({
  id,
  checked,
  onCheckedChange,
  statement,
  linkHref,
  linkLabel,
  version,
  draft,
  effectiveDate,
  disabled,
  separated,
  describedBy,
}: LegalConsentRowProps) {
  // Honest metadata line: status word + the CONFIGURED version. When the
  // configuration is unavailable we say so instead of inventing a version.
  const metaId = `${id}-meta`
  const meta =
    version === null
      ? 'Version not published yet — the server confirms the current version when you create your account.'
      : draft === true
        ? `Draft · Version ${version}`
        : draft === false && effectiveDate
          ? `Effective ${effectiveDate} · Version ${version}`
          : `Version ${version}`

  return (
    <div
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 p-3 sm:p-4',
        separated && 'border-t border-hairline',
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={v => onCheckedChange(v === true)}
        disabled={disabled}
        aria-describedby={describedBy ? `${describedBy} ${metaId}` : metaId}
        className="mt-1 h-4 w-4"
      />
      <div className="min-w-0 space-y-1">
        <Label
          htmlFor={id}
          className="block text-sm font-medium leading-relaxed text-foreground cursor-pointer"
        >
          {statement}
        </Label>
        {/* Sibling link — deliberately OUTSIDE the <Label> so activating it
            can never toggle the checkbox or submit the form. */}
        <a
          href={linkHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-gold underline underline-offset-2 transition-colors hover:text-gold-hover focus-visible:outline-2 focus-visible:outline-gold"
        >
          {linkLabel}
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
        </a>
        <p id={metaId} className="text-xs leading-relaxed text-muted-foreground">
          {meta}
        </p>
      </div>
    </div>
  )
}

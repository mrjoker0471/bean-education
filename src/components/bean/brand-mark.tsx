'use client'

// ─── BEAN Education brand assets ─────────────────────────────────────────────
// The supplied artwork is the single source of brand identity:
//   • /brand/bean-emblem.png   — complete stacked logo (graduation-cap "B"
//     emblem). Used wherever a full brand presentation is appropriate (auth
//     screens, loading/empty stages, footer emblem, favicon source).
//   • /brand/bean-wordmark.png — horizontal BEAN EDUCATION wordmark. Used in
//     the header lockup and footer. NEVER recreated with HTML text or fonts.
//   • /brand/bean-icon.png     — square favicon derived from the emblem.
//
// Every image renders with object-contain so the artwork is never cropped,
// stretched or distorted, and preserves its original aspect ratio. The old
// text-based wordmark and the placeholder bean-tile SVG were removed so the
// two can never appear together (no duplicated branding).

import { cn } from '@/lib/utils'

export function BeanEmblem({ className, alt = 'BEAN Education emblem' }: { className?: string; alt?: string }) {
  return (
    <img
      src="/brand/bean-emblem.png"
      alt={alt}
      draggable={false}
      className={cn('object-contain select-none', className)}
    />
  )
}

export function BeanWordmarkImage({ className, alt = 'BEAN Education' }: { className?: string; alt?: string }) {
  return (
    <img
      src="/brand/bean-wordmark.png"
      alt={alt}
      draggable={false}
      className={cn('object-contain select-none', className)}
    />
  )
}

/**
 * The header brand lockup: the complete emblem artwork in a refined obsidian
 * glass container with a champagne-gold hairline highlight, and the supplied
 * horizontal wordmark beside it. One container, one lockup — the emblem keeps
 * its aspect ratio, the wordmark keeps its aspect ratio, nothing is cropped.
 * On the smallest screens the wordmark scales down but stays readable; the
 * container padding keeps breathing room without becoming an oversized box.
 */
export function BrandLockup({ onClick, className }: { onClick?: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="BEAN Education home"
      className={cn(
        'group flex items-center gap-2.5 rounded-xl border border-hairline bg-white/[0.04] px-2.5 py-1.5',
        'shadow-[0_1px_0_rgba(233,220,189,0.08)_inset,0_8px_24px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md',
        'transition-colors duration-200 hover:border-gold/40 hover:bg-white/[0.06]',
        className,
      )}
    >
      <BeanEmblem
        alt=""
        className="h-9 w-9 shrink-0 transition-transform duration-300 group-hover:scale-105 sm:h-10 sm:w-10"
      />
      <BeanWordmarkImage
        alt="BEAN Education"
        className="h-[18px] w-auto min-w-[118px] sm:h-5 sm:min-w-[132px] lg:h-[22px] lg:min-w-[146px]"
      />
    </button>
  )
}

/** Compact lockup for the mobile navigation sheet and the footer. */
export function BrandLockupCompact({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BeanEmblem alt="" className="h-7 w-7 shrink-0" />
      <BeanWordmarkImage alt="BEAN Education" className="h-[15px] w-auto min-w-[100px]" />
    </span>
  )
}

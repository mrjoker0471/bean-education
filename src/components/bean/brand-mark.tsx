'use client'

// ─── BEAN Education brand mark ────────────────────────────────────────────────
// The product wordmark is "BEAN Education". The glyph is a gold bean on an
// obsidian tile. The public logo asset lives at /logo.svg so it can be swapped
// for the final BEAN Education logo without touching any component — every
// surface renders the mark through this one component (or the SVG file).
// Colours follow the brand palette: obsidian #0B0B0C, metallic gold #C6A05E,
// champagne #E9DCBD.

import { cn } from '@/lib/utils'

export function BeanMark({ className, tileSize = 'md' }: { className?: string; tileSize?: 'sm' | 'md' | 'lg' }) {
  const size = tileSize === 'sm' ? 'h-7 w-7' : tileSize === 'lg' ? 'h-11 w-11' : 'h-9 w-9'
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[26%] border border-hairline', size, className)}
      style={{ background: 'linear-gradient(145deg, #161512 0%, #0B0B0C 100%)' }}
    >
      <svg viewBox="0 0 64 64" className="h-[72%] w-[72%]" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bean-gold" x1="20" y1="13" x2="44" y2="51" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#E9DCBD" />
            <stop offset="0.5" stopColor="#C6A05E" />
            <stop offset="1" stopColor="#8C744C" />
          </linearGradient>
        </defs>
        <g transform="rotate(-24 32 32)">
          <ellipse cx="32" cy="32" rx="12.5" ry="17.5" fill="url(#bean-gold)" />
          <path d="M32 15.5 C 23.5 23, 40.5 41, 32 48.5" stroke="#0B0B0C" strokeWidth="3.2" strokeLinecap="round" fill="none" />
        </g>
      </svg>
    </span>
  )
}

/** The full product wordmark: BEAN Education. Used in header, footer, auth and empty states. */
export function Wordmark({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 leading-none', className)}>
      <span className={cn('font-sans font-bold tracking-[0.14em] text-foreground', size === 'sm' ? 'text-sm' : 'text-lg')}>
        BEAN
      </span>
      <span
        className={cn('font-display italic text-champagne', size === 'sm' ? 'text-sm' : 'text-lg')}
      >
        Education
      </span>
    </span>
  )
}

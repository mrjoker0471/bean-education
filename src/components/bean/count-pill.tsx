'use client'

import { cn } from '@/lib/utils'

export function CountPill({ label, value, className }: { label: string; value: number | string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-xs text-muted-foreground', className)}>
      <span className="font-semibold text-gold">{value}</span> {label}
    </span>
  )
}

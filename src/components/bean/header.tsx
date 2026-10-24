'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useAppStore, parseHash } from '@/lib/store'
import { cn } from '@/lib/utils'
import { BookOpen, FlaskConical, GraduationCap, Menu, Sparkles, TrendingUp } from 'lucide-react'

const NAV = [
  { key: 'catalog', label: 'Exams', icon: BookOpen, hash: '#/catalog' },
  { key: 'bean', label: 'BEAN Intelligence', icon: Sparkles, hash: '#/bean' },
  { key: 'progress', label: 'My Progress', icon: TrendingUp, hash: '#/progress' },
]

export function Header() {
  const route = useAppStore(s => s.route)
  const navigate = useAppStore(s => s.navigate)
  const [open, setOpen] = useState(false)

  const isActive = (hash: string) => {
    if (hash === '#/catalog') return route.view === 'catalog' || route.view === 'exam' || route.view === 'topic' || route.view === 'test' || route.view === 'result'
    if (hash === '#/bean') return route.view === 'bean'
    if (hash === '#/progress') return route.view === 'progress'
    return false
  }

  const go = (hash: string) => {
    setOpen(false)
    navigate(parseHash(hash))
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-page/90 backdrop-blur supports-[backdrop-filter]:bg-page/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate({ view: 'home' })}
          className="flex items-center gap-2.5"
          aria-label="BEAN EXAMS home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/40 bg-gold/10">
            <GraduationCap className="h-5 w-5 text-gold" />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-lg font-bold tracking-wide text-foreground">
              BEAN <span className="text-gold">EXAMS</span>
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.25em] text-muted-foreground sm:block">
              One syllabus. Every topic.
            </span>
          </span>
        </button>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => go(item.hash)}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive(item.hash)
                  ? 'bg-gold/10 text-gold'
                  : 'text-muted-foreground hover:bg-elevated hover:text-foreground'
              )}
            >
              {item.label}
            </button>
          ))}
          <Button
            size="sm"
            className="ml-2 bg-gold text-primary-foreground hover:bg-gold-hover"
            onClick={() => go('#/catalog')}
          >
            <FlaskConical className="mr-1.5 h-4 w-4" /> Start practising
          </Button>
        </nav>

        <div className="md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="border-border bg-card" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 border-border bg-card">
              <SheetTitle className="font-display text-lg text-foreground">
                BEAN <span className="text-gold">EXAMS</span>
              </SheetTitle>
              <nav className="mt-4 flex flex-col gap-1" aria-label="Mobile">
                {NAV.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => go(item.hash)}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium',
                      isActive(item.hash) ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:bg-elevated hover:text-foreground'
                    )}
                  >
                    <item.icon className="h-4 w-4" /> {item.label}
                  </button>
                ))}
                <Button className="mt-3 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => go('#/catalog')}>
                  <FlaskConical className="mr-1.5 h-4 w-4" /> Start practising
                </Button>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

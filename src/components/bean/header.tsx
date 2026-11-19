'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useAppStore, parseHash } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  ClipboardCheck,
  FlaskConical,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  LogIn,
  Menu,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
} from 'lucide-react'

interface NavItem {
  key: string
  label: string
  icon: typeof BookOpen
  hash: string
  activeFor: string[]
}

// Phase 2B: signed-in students get the personal surfaces (Dashboard, My
// Learning, Goals). Guests keep exactly the previous navigation — guest mode
// is still fully functional. PYQ Studio appears only for curator/admin roles
// (the server enforces the same rule, so hiding it is not the security check).
// Phase 4A: Classes is open to guests AND signed-in students (BEAN Teach
// marketplace browsing is public); Teacher Review is admin-only.
const SIGNED_IN_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, hash: '#/dashboard', activeFor: ['dashboard'] },
  { key: 'workspace', label: 'My Learning', icon: FolderOpen, hash: '#/workspace', activeFor: ['workspace', 'materials', 'riishe'] },
  { key: 'goals', label: 'Goals', icon: Target, hash: '#/goals', activeFor: ['goals'] },
  { key: 'classes', label: 'Classes', icon: GraduationCap, hash: '#/classes', activeFor: ['classes', 'class', 'teach-apply', 'teach-dashboard'] },
  // Phase 7: institution workspace + career hub — signed-in students only.
  { key: 'institution', label: 'Institution', icon: Building2, hash: '#/institution', activeFor: ['institution', 'institution-org'] },
  { key: 'career', label: 'Career', icon: Briefcase, hash: '#/career', activeFor: ['career', 'career-profile', 'career-portfolio', 'career-opportunities', 'career-opportunity', 'career-applications', 'career-employer'] },
  { key: 'catalog', label: 'Exams', icon: BookOpen, hash: '#/catalog', activeFor: ['catalog', 'exam', 'topic', 'test', 'result'] },
  { key: 'progress', label: 'My Progress', icon: TrendingUp, hash: '#/progress', activeFor: ['progress'] },
]

const GUEST_NAV: NavItem[] = [
  { key: 'catalog', label: 'Exams', icon: BookOpen, hash: '#/catalog', activeFor: ['catalog', 'exam', 'topic', 'test', 'result'] },
  { key: 'classes', label: 'Classes', icon: GraduationCap, hash: '#/classes', activeFor: ['classes', 'class'] },
  { key: 'materials', label: 'My Materials', icon: FolderOpen, hash: '#/materials', activeFor: ['materials', 'riishe'] },
  { key: 'progress', label: 'My Progress', icon: TrendingUp, hash: '#/progress', activeFor: ['progress'] },
]

export function Header() {
  const route = useAppStore(s => s.route)
  const navigate = useAppStore(s => s.navigate)
  const authedStudent = useAppStore(s => s.authedStudent)
  const [open, setOpen] = useState(false)

  const isCurator = authedStudent?.role === 'PYQ_CURATOR' || authedStudent?.role === 'ADMIN'
  const isAdmin = authedStudent?.role === 'ADMIN'

  const navItems: NavItem[] = authedStudent
    ? [
        ...SIGNED_IN_NAV,
        ...(isCurator ? [{ key: 'pyq', label: 'PYQ Studio', icon: ShieldCheck, hash: '#/pyq-studio', activeFor: ['pyq-studio'] }] as NavItem[] : []),
        // Phase 4A: teacher application review — administrators only.
        ...(isAdmin ? [{ key: 'teach-review', label: 'Teacher Review', icon: ClipboardCheck, hash: '#/teach/review', activeFor: ['teach-review'] }] as NavItem[] : []),
      ]
    : GUEST_NAV

  const riisheItem: NavItem = { key: 'riishe', label: 'Riishe AI', icon: Sparkles, hash: '#/riishe', activeFor: ['riishe', 'materials'] }

  const isActive = (item: NavItem) => item.activeFor.includes(route.view)

  const go = (hash: string) => {
    setOpen(false)
    navigate(parseHash(hash))
  }

  const navButton = (item: NavItem, mobile: boolean) => (
    <button
      key={item.key}
      type="button"
      onClick={() => go(item.hash)}
      aria-current={isActive(item) ? 'page' : undefined}
      className={cn(
        mobile
          ? 'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium'
          : 'rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive(item)
          ? 'bg-gold/10 text-gold'
          : 'text-muted-foreground hover:bg-elevated hover:text-foreground',
      )}
    >
      {mobile && <item.icon className="h-4 w-4 shrink-0" aria-hidden />} {item.label}
    </button>
  )

  const accountButton = (mobile: boolean) =>
    mobile ? (
      <button
        type="button"
        onClick={() => go(authedStudent ? '#/settings' : '#/auth')}
        className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium text-muted-foreground hover:bg-elevated hover:text-foreground"
      >
        <UserRound className="h-4 w-4 shrink-0" aria-hidden />
        {authedStudent ? (authedStudent.displayName || authedStudent.email) : 'Sign in'}
      </button>
    ) : (
      <Button
        size="sm"
        variant="outline"
        className="border-border bg-card text-muted-foreground hover:bg-elevated hover:text-foreground"
        onClick={() => go(authedStudent ? '#/settings' : '#/auth')}
        aria-label={authedStudent ? 'Account settings' : 'Sign in or create an account'}
      >
        {authedStudent ? (
          <>
            <UserRound className="mr-1.5 h-4 w-4" aria-hidden />
            <span className="max-w-32 truncate">{authedStudent.displayName || authedStudent.email}</span>
          </>
        ) : (
          <>
            <LogIn className="mr-1.5 h-4 w-4" aria-hidden /> Sign in
          </>
        )}
      </Button>
    )

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-page/90 backdrop-blur supports-[backdrop-filter]:bg-page/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate({ view: 'home' })}
          className="flex items-center gap-2.5"
          aria-label="BEAN home"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-gold/40 bg-gold/10">
            <GraduationCap className="h-5 w-5 text-gold" />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-lg font-bold tracking-wide text-foreground">
              BEAN <span className="text-gold">LEARN</span>
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.25em] text-muted-foreground sm:block">
              Learn anything. Own your progress.
            </span>
          </span>
        </button>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {navItems.map(item => navButton(item, false))}
          {navButton(riisheItem, false)}
          <Button
            size="sm"
            className="ml-2 bg-gold text-primary-foreground hover:bg-gold-hover"
            onClick={() => go('#/practice')}
          >
            <FlaskConical className="mr-1.5 h-4 w-4" /> Start practising
          </Button>
          {accountButton(false)}
        </nav>

        <div className="lg:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="border-border bg-card" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 border-border bg-card">
              <SheetTitle className="font-display text-lg text-foreground">
                BEAN <span className="text-gold">LEARN</span>
              </SheetTitle>
              <nav className="mt-4 flex flex-col gap-1" aria-label="Mobile">
                {navItems.map(item => navButton(item, true))}
                {navButton(riisheItem, true)}
                <button
                  type="button"
                  onClick={() => go('#/bean')}
                  aria-current={route.view === 'bean' ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium',
                    route.view === 'bean' ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:bg-elevated hover:text-foreground',
                  )}
                >
                  <Bot className="h-4 w-4 shrink-0" aria-hidden /> BEAN Intelligence
                </button>
                <Button className="mt-3 bg-gold text-primary-foreground hover:bg-gold-hover" onClick={() => go('#/practice')}>
                  <FlaskConical className="mr-1.5 h-4 w-4" /> Start practising
                </Button>
                {accountButton(true)}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}

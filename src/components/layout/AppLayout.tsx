import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { NAV_ITEMS } from './nav'
import { Button } from '@/components/ui/Button'
import { IconPlus, IconSettings, IconSun, IconMoon } from '@/components/ui/icons'
import { useUI } from '@/state/ui'
import { useSettings } from '@/state/settings'
import { cn } from '@/lib/cn'
import { BrandMark } from '@/components/ui/BrandMark'
import { RecurringBanner } from '@/components/transactions/RecurringBanner'
import { useUpAutoSync } from '@/hooks/useUpAutoSync'

export function AppLayout() {
  const { openEditor } = useUI()
  const { resolvedTheme, setTheme } = useSettings()
  const navigate = useNavigate()
  useUpAutoSync()

  const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')

  return (
    <div className="min-h-screen flex bg-bg">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-surface sticky top-0 h-screen">
        <div className="h-16 flex items-center gap-2.5 px-5">
          <BrandMark size={32} className="rounded-lg" />
          <span className="font-semibold">Money Monitor</span>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium transition-colors',
                  isActive ? 'bg-elevated text-fg' : 'text-muted hover:text-fg hover:bg-elevated/60',
                )
              }
            >
              <Icon width={20} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border space-y-1">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium transition-colors',
                isActive ? 'bg-elevated text-fg' : 'text-muted hover:text-fg hover:bg-elevated/60',
              )
            }
          >
            <IconSettings width={20} /> Settings
          </NavLink>
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium text-muted hover:text-fg hover:bg-elevated/60 transition-colors"
          >
            {resolvedTheme === 'dark' ? <IconSun width={20} /> : <IconMoon width={20} />}
            {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header
          className="md:hidden sticky top-0 z-30 bg-bg/80 backdrop-blur border-b border-border flex items-center justify-between px-4 h-14"
          style={{ paddingTop: 'var(--safe-top)' }}
        >
          <span className="flex items-center gap-2 font-semibold">
            <BrandMark size={28} className="rounded-lg" />
            Money Monitor
          </span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {resolvedTheme === 'dark' ? <IconSun /> : <IconMoon />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} aria-label="Settings">
              <IconSettings />
            </Button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-content mx-auto px-4 md:px-8 py-5 md:py-8 pb-28 md:pb-12">
          <RecurringBanner />
          <Outlet />
        </main>
      </div>

      {/* Floating add button (mobile) */}
      <button
        onClick={() => openEditor()}
        aria-label="New transaction"
        className="md:hidden fixed right-5 z-40 h-14 w-14 rounded-full bg-accent text-white shadow-pop grid place-items-center active:scale-95 transition-transform"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
      >
        <IconPlus width={26} />
      </button>

      {/* Desktop quick-add */}
      <button
        onClick={() => openEditor()}
        className="hidden md:flex fixed bottom-7 right-7 z-40 h-12 px-5 rounded-full bg-accent text-white shadow-pop items-center gap-2 font-medium hover:opacity-90 active:scale-95 transition"
      >
        <IconPlus width={20} /> New
      </button>

      {/* Mobile bottom navigation */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-border flex"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        {NAV_ITEMS.map(({ to, label, short, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-16 text-[10px] font-medium transition-colors',
                isActive ? 'text-accent' : 'text-faint',
              )
            }
          >
            <Icon width={21} />
            <span className="max-w-full truncate px-0.5">{short ?? label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

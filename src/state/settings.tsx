import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { getMeta, setMeta } from '@/db/meta'
import { detectCurrency } from '@/lib/money'

export type ThemeMode = 'light' | 'dark' | 'system'

interface SettingsValue {
  ready: boolean
  theme: ThemeMode
  resolvedTheme: 'light' | 'dark'
  currency: string
  setTheme: (t: ThemeMode) => void
  setCurrency: (c: string) => void
}

const SettingsContext = createContext<SettingsValue | null>(null)

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [systemDark, setSystemDark] = useState(systemPrefersDark())

  // Currency is read live from the DB so an import reflects immediately.
  const currency = useLiveQuery(() => getMeta('currency', detectCurrency()), [], detectCurrency())

  useEffect(() => {
    getMeta<ThemeMode>('theme', 'system').then((t) => {
      setThemeState(t)
      setReady(true)
    })
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolvedTheme === 'dark')
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', resolvedTheme === 'dark' ? '#0a0a0a' : '#ffffff')
  }, [resolvedTheme])

  const setTheme = (t: ThemeMode) => {
    setThemeState(t)
    void setMeta('theme', t)
  }
  const setCurrency = (c: string) => {
    void setMeta('currency', c)
  }

  return (
    <SettingsContext.Provider
      value={{ ready, theme, resolvedTheme, currency: currency ?? 'GBP', setTheme, setCurrency }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}

/** Convenience hook returning a formatter bound to the active currency. */
export function useCurrency() {
  return useSettings().currency
}

export { db }

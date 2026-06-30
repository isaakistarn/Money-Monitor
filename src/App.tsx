import { useEffect, useState } from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { SettingsProvider, useSettings } from '@/state/settings'
import { UIProvider } from '@/state/ui'
import { SyncProvider } from '@/state/sync'
import { ConfirmProvider } from '@/components/ui/Confirm'
import { AppLayout } from '@/components/layout/AppLayout'
import { TransactionForm } from '@/components/transactions/TransactionForm'
import { Toaster } from '@/components/ui/Toaster'
import { useKeyboardShortcuts } from '@/hooks/useKeyboard'
import { bootstrap } from '@/db/seed'
import { requestPersistentStorage } from '@/lib/storage'
import { Onboarding } from '@/pages/Onboarding'

import { Dashboard } from '@/pages/Dashboard'
import { Transactions } from '@/pages/Transactions'
import { Budgets } from '@/pages/Budgets'
import { Accounts } from '@/pages/Accounts'
import { Analytics } from '@/pages/Analytics'
import { Watchlist } from '@/pages/Watchlist'
import { Settings } from '@/pages/Settings'

function RootLayout() {
  useKeyboardShortcuts()
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let active = true
    void requestPersistentStorage()
    bootstrap().then((isNew) => {
      if (!active) return
      setNeedsOnboarding(isNew)
      setChecked(true)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <>
      <AppLayout />
      <TransactionForm />
      <Toaster />
      {checked && needsOnboarding && <Onboarding onDone={() => setNeedsOnboarding(false)} />}
    </>
  )
}

const router = createHashRouter([
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'transactions', element: <Transactions /> },
      { path: 'budgets', element: <Budgets /> },
      { path: 'accounts', element: <Accounts /> },
      { path: 'watchlist', element: <Watchlist /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <Dashboard /> },
    ],
  },
])

function Gate({ children }: { children: React.ReactNode }) {
  // Hold first paint until the theme is resolved to avoid a flash.
  const { ready } = useSettings()
  if (!ready) return <div className="min-h-screen bg-bg" />
  return <>{children}</>
}

export default function App() {
  return (
    <SettingsProvider>
      <UIProvider>
        <SyncProvider>
          <ConfirmProvider>
            <Gate>
              <RouterProvider router={router} />
            </Gate>
          </ConfirmProvider>
        </SyncProvider>
      </UIProvider>
    </SettingsProvider>
  )
}

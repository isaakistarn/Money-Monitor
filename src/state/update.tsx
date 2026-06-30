import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

interface UpdateValue {
  /** True when a newer deployed version is downloaded and ready to apply. */
  updateAvailable: boolean
  updating: boolean
  checking: boolean
  /** Apply the waiting version and reload. */
  updateNow: () => void
  /** Ask the service worker to look for a new version now. */
  checkForUpdates: () => Promise<void>
}

const UpdateContext = createContext<UpdateValue | null>(null)

const CHECK_INTERVAL = 60 * 60 * 1000 // hourly

export function UpdateProvider({ children }: { children: ReactNode }) {
  const regRef = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const [updating, setUpdating] = useState(false)
  const [checking, setChecking] = useState(false)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, reg) {
      regRef.current = reg
      if (reg) {
        // Poll for new deploys periodically and whenever the app regains focus.
        setInterval(() => reg.update().catch(() => {}), CHECK_INTERVAL)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {})
        })
      }
    },
  })

  const updateNow = () => {
    setUpdating(true)
    void updateServiceWorker(true) // skip waiting + reload into the new version
  }

  const checkForUpdates = async () => {
    setChecking(true)
    try {
      await regRef.current?.update()
    } catch {
      /* offline or no registration yet */
    } finally {
      setTimeout(() => setChecking(false), 600)
    }
  }

  return (
    <UpdateContext.Provider value={{ updateAvailable: needRefresh, updating, checking, updateNow, checkForUpdates }}>
      {children}
    </UpdateContext.Provider>
  )
}

export function useUpdate(): UpdateValue {
  const ctx = useContext(UpdateContext)
  if (!ctx) throw new Error('useUpdate must be used within UpdateProvider')
  return ctx
}

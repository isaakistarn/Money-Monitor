import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { syncNow } from '@/db/sync'
import { db } from '@/db/db'
import { getMeta } from '@/db/meta'

export type SyncStatus = 'idle' | 'syncing' | 'error'

interface SyncValue {
  configured: boolean
  authReady: boolean
  session: Session | null
  email: string | null
  status: SyncStatus
  error: string | null
  lastSyncAt: string | null
  pending: number
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  sync: () => Promise<void>
}

const SyncContext = createContext<SyncValue | null>(null)

export function SyncProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const lastSyncAt = useLiveQuery(() => getMeta<string | null>('sync.lastSyncAt', null), [], null)
  const pending = useLiveQuery(() => db.outbox.count(), [], 0) ?? 0

  // Guards so overlapping triggers collapse into one in-flight sync (+ one rerun).
  const running = useRef(false)
  const rerun = useRef(false)
  const userId = session?.user?.id ?? null

  const sync = useCallback(async () => {
    if (!supabase || !userId) return
    if (running.current) {
      rerun.current = true
      return
    }
    running.current = true
    setStatus('syncing')
    setError(null)
    try {
      do {
        rerun.current = false
        await syncNow(userId)
      } while (rerun.current)
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setError((e as Error).message)
    } finally {
      running.current = false
    }
  }, [userId])

  // Track the Supabase session.
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  // Sync immediately on (re)gaining a user.
  useEffect(() => {
    if (userId) void sync()
  }, [userId, sync])

  // Debounced auto-push shortly after local changes pile up.
  useEffect(() => {
    if (!userId || pending === 0) return
    const t = setTimeout(() => void sync(), 1500)
    return () => clearTimeout(t)
  }, [pending, userId, sync])

  // Re-sync when the app regains focus or connectivity, and on a slow heartbeat.
  useEffect(() => {
    if (!userId) return
    const onFocus = () => { if (document.visibilityState === 'visible') void sync() }
    window.addEventListener('visibilitychange', onFocus)
    window.addEventListener('online', onFocus)
    const id = window.setInterval(() => void sync(), 60_000)
    return () => {
      window.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('online', onFocus)
      window.clearInterval(id)
    }
  }, [userId, sync])

  const signIn = useCallback(async (em: string, pw: string) => {
    if (!supabase) throw new Error('Sync is not configured.')
    const { error } = await supabase.auth.signInWithPassword({ email: em.trim(), password: pw })
    if (error) throw new Error(error.message)
  }, [])

  const signUp = useCallback(async (em: string, pw: string) => {
    if (!supabase) throw new Error('Sync is not configured.')
    const { data, error } = await supabase.auth.signUp({ email: em.trim(), password: pw })
    if (error) throw new Error(error.message)
    // If email confirmation is on, there's a user but no session yet.
    return { needsConfirmation: !data.session }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }, [])

  return (
    <SyncContext.Provider
      value={{
        configured: isSupabaseConfigured,
        authReady,
        session,
        email: session?.user?.email ?? null,
        status,
        error,
        lastSyncAt: lastSyncAt ?? null,
        pending,
        signIn,
        signUp,
        signOut,
        sync,
      }}
    >
      {children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncValue {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync must be used within SyncProvider')
  return ctx
}

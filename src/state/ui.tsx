import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { Transaction } from '@/types/models'

/** Lightweight global UI state: the shared transaction modal + a toast queue. */

export interface Toast {
  id: number
  message: string
  tone: 'default' | 'success' | 'error'
}

interface UIValue {
  // Transaction editor modal
  editorOpen: boolean
  editing: Transaction | null
  openEditor: (tx?: Transaction | null) => void
  closeEditor: () => void
  // Toasts
  toasts: Toast[]
  toast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
}

const UIContext = createContext<UIValue | null>(null)

let toastSeq = 1

export function UIProvider({ children }: { children: ReactNode }) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const openEditor = useCallback((tx?: Transaction | null) => {
    setEditing(tx ?? null)
    setEditorOpen(true)
  }, [])
  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setEditing(null)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])
  const toast = useCallback(
    (message: string, tone: Toast['tone'] = 'default') => {
      const id = toastSeq++
      setToasts((t) => [...t, { id, message, tone }])
      window.setTimeout(() => dismissToast(id), 3200)
    },
    [dismissToast],
  )

  const value = useMemo(
    () => ({ editorOpen, editing, openEditor, closeEditor, toasts, toast, dismissToast }),
    [editorOpen, editing, openEditor, closeEditor, toasts, toast, dismissToast],
  )

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>
}

export function useUI(): UIValue {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '@/state/ui'

/** Global desktop keyboard shortcuts: N = new, / = search, Esc handled per-modal. */
export function useKeyboardShortcuts() {
  const { openEditor, editorOpen } = useUI()
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        openEditor()
      } else if (e.key === '/') {
        if (editorOpen) return
        e.preventDefault()
        navigate('/transactions')
        // Focus search after navigation settles.
        setTimeout(() => {
          const el = document.querySelector<HTMLInputElement>('[data-search-input]')
          el?.focus()
        }, 80)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openEditor, editorOpen, navigate])
}

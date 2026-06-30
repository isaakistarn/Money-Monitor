import { useEffect, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { IconClose } from './icons'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
  /** On mobile the modal slides up as a bottom sheet. */
  size?: 'md' | 'lg'
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center items-end">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative bg-surface w-full shadow-pop flex flex-col animate-slide-up',
          'rounded-t-2xl sm:rounded-2xl border border-border',
          'max-h-[92vh] sm:max-h-[88vh]',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        {title && (
          <div className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
            <h2 className="text-base font-semibold">{title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <IconClose />
            </Button>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-border shrink-0 flex gap-2 justify-end">{footer}</div>
        )}
      </div>
    </div>
  )
}

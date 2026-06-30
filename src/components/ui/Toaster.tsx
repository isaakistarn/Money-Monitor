import { useUI } from '@/state/ui'
import { cn } from '@/lib/cn'
import { IconCheck, IconWarning, IconClose } from './icons'

export function Toaster() {
  const { toasts, dismissToast } = useUI()
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 w-[min(92vw,26rem)]"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)' }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-pop border text-sm animate-slide-up',
            'bg-elevated border-border text-fg',
          )}
        >
          {t.tone === 'success' && <IconCheck className="text-positive shrink-0" width={18} />}
          {t.tone === 'error' && <IconWarning className="text-negative shrink-0" width={18} />}
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismissToast(t.id)} className="text-faint hover:text-fg">
            <IconClose width={16} />
          </button>
        </div>
      ))}
    </div>
  )
}

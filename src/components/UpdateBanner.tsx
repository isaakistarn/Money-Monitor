import { useState } from 'react'
import { useUpdate } from '@/state/update'
import { IconRefresh, IconClose } from '@/components/ui/icons'

/** A dismissible pill that appears when a newer version is ready to install. */
export function UpdateBanner() {
  const { updateAvailable, updating, updateNow } = useUpdate()
  const [dismissed, setDismissed] = useState(false)

  if (!updateAvailable || dismissed) return null

  return (
    <div
      className="fixed inset-x-0 z-40 flex justify-center px-4 pointer-events-none"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)' }}
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-fg text-bg shadow-pop pl-4 pr-2 py-2 max-w-full">
        <span className="text-sm font-medium whitespace-nowrap">A new version is available</span>
        <button
          onClick={updateNow}
          disabled={updating}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent text-white text-sm font-semibold px-3 py-1.5 hover:opacity-90 disabled:opacity-60"
        >
          <IconRefresh width={15} className={updating ? 'animate-spin' : undefined} />
          {updating ? 'Updating…' : 'Update'}
        </button>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="grid place-items-center h-7 w-7 rounded-full hover:bg-bg/20">
          <IconClose width={16} />
        </button>
      </div>
    </div>
  )
}

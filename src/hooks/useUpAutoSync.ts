import { useEffect } from 'react'
import { autoSyncUp } from '@/db/upsync'
import { useUI } from '@/state/ui'

/**
 * Pull new Up Bank transactions when the app opens (throttled inside
 * autoSyncUp; a no-op unless a token is connected in Settings).
 */
export function useUpAutoSync() {
  const { toast } = useUI()
  useEffect(() => {
    void autoSyncUp().then((r) => {
      if (r && r.added > 0) {
        toast(`Imported ${r.added} new transaction${r.added === 1 ? '' : 's'} from Up`, 'success')
      }
    })
    // Run once per app open; autoSyncUp's own throttle handles the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

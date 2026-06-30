import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { getMeta } from '@/db/meta'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { IconShield } from '@/components/ui/icons'

/** Warns when local data hasn't been backed up recently (iOS may evict it). */
export function BackupNudge() {
  const navigate = useNavigate()
  const info = useLiveQuery(async () => {
    const last = await getMeta<string | null>('lastBackup', null)
    const dismissedAt = await getMeta<number>('backupNudgeDismissed', 0)
    return { last, dismissedAt }
  }, [])

  if (!info) return null

  const days = info.last
    ? Math.floor((Date.now() - new Date(info.last).getTime()) / 86_400_000)
    : Infinity

  const recentlyDismissed = Date.now() - info.dismissedAt < 3 * 86_400_000
  if (days < 7 || recentlyDismissed) return null

  return (
    <Card className="mb-5 p-4 border-warning/40 bg-warning/5">
      <div className="flex items-start gap-3">
        <span className="text-warning mt-0.5"><IconShield width={20} /></span>
        <div className="flex-1">
          <p className="text-sm font-medium">
            {info.last ? `Last backup was ${days} days ago.` : 'You haven’t backed up yet.'}
          </p>
          <p className="text-xs text-muted mt-0.5">
            Your data lives only on this device. Export a backup so you don’t lose it.
          </p>
        </div>
        <Button size="sm" onClick={() => navigate('/settings')}>Back up</Button>
      </div>
    </Card>
  )
}

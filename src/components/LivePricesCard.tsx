import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
import { IconChart } from '@/components/ui/icons'
import { getMeta, setMeta } from '@/db/meta'
import { PER_DAY, PER_MINUTE } from '@/lib/ratelimit'

/**
 * Settings card for Twelve Data live prices. The API key is stored only on this
 * device (IndexedDB — never synced or shipped in the build) so it stays private.
 */
export function LivePricesCard() {
  const [apikey, setKey] = useState<string | null>(null)
  const credits = useLiveQuery(() => getMeta<{ day: string; used: number }>('tdCredits', { day: '', used: 0 }), [])

  useEffect(() => {
    getMeta<string>('twelveDataKey', '').then(setKey)
  }, [])

  if (apikey === null) return null

  const today = new Date().toISOString().slice(0, 10)
  const usedToday = credits && credits.day === today ? credits.used : 0

  return (
    <Card className="p-5">
      <SectionHeader title="Live prices" />
      <div className="rounded-xl bg-elevated/60 border border-border p-3.5 flex gap-3 mb-4">
        <span className="text-muted mt-0.5"><IconChart width={18} /></span>
        <p className="text-xs text-muted leading-relaxed">
          Get a free <a href="https://twelvedata.com/pricing" target="_blank" rel="noreferrer" className="text-accent underline">Twelve Data API key</a> (no
          card needed) to refresh investment prices from the <b>Refresh</b> button on the Accounts page.
          Covers US, ASX, and other markets plus crypto, and prices are converted to your currency
          automatically. The key is stored only on this device.
        </p>
      </div>

      <div className="flex items-center justify-between text-sm mb-4">
        <span className="text-muted">Used today</span>
        <span className="font-medium tabular-nums">
          {usedToday} / {PER_DAY}
          <span className="text-faint font-normal"> credits · max {PER_MINUTE}/min</span>
        </span>
      </div>
      {usedToday >= PER_DAY && (
        <p className="text-xs text-warning mb-4">Daily limit reached — refreshing pauses until it resets at midnight UTC.</p>
      )}

      <Field
        label="Twelve Data API key"
        hint="For ASX or other exchanges, set each holding's Exchange field (e.g. ASX). US tickers work without it."
      >
        <Input
          type="password"
          autoComplete="off"
          value={apikey}
          onChange={(e) => {
            setKey(e.target.value)
            void setMeta('twelveDataKey', e.target.value.trim())
          }}
          placeholder="Paste your key"
        />
      </Field>
    </Card>
  )
}

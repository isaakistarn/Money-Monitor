import { useEffect, useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Field'
import { IconChart } from '@/components/ui/icons'
import { getMeta, setMeta } from '@/db/meta'
import { CURRENCIES } from '@/lib/money'

/**
 * Settings card for Alpha Vantage live prices. The API key is stored locally on
 * this device (IndexedDB, never synced or shipped in the build) so it stays
 * private. Enter it once per device.
 */
export function LivePricesCard() {
  const [apikey, setKey] = useState<string | null>(null)
  const [quoteCurrency, setQuote] = useState<string | null>(null)

  useEffect(() => {
    getMeta<string>('alphaVantageKey', '').then(setKey)
    getMeta<string>('quoteCurrency', 'USD').then(setQuote)
  }, [])

  if (apikey === null || quoteCurrency === null) return null

  return (
    <Card className="p-5">
      <SectionHeader title="Live prices" />
      <div className="rounded-xl bg-elevated/60 border border-border p-3.5 flex gap-3 mb-4">
        <span className="text-muted mt-0.5"><IconChart width={18} /></span>
        <p className="text-xs text-muted leading-relaxed">
          Add a free <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noreferrer" className="text-accent underline">Alpha Vantage API key</a> to
          refresh investment prices from the <b>Refresh</b> button on the Accounts page. The key is stored
          only on this device. The free tier allows ~25 requests/day, so refresh sparingly.
        </p>
      </div>

      <Field label="Alpha Vantage API key">
        <Input
          type="password"
          autoComplete="off"
          value={apikey}
          onChange={(e) => {
            setKey(e.target.value)
            void setMeta('alphaVantageKey', e.target.value.trim())
          }}
          placeholder="Paste your key"
        />
      </Field>

      <div className="mt-4">
        <Field
          label="Stock quote currency"
          hint="The currency your stocks/ETFs are priced in (US tickers = USD). Prices are converted to your app currency. Crypto is fetched directly."
        >
          <Select
            value={quoteCurrency}
            onChange={(e) => {
              setQuote(e.target.value)
              void setMeta('quoteCurrency', e.target.value)
            }}
          >
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <option key={code} value={code}>{c.symbol} {code}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Card>
  )
}

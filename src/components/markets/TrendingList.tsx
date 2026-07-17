import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Segmented } from '@/components/ui/Segmented'
import { TickerLogo } from '@/components/watchlist/TickerLogo'
import { IconPlus, IconCheck } from '@/components/ui/icons'
import { fetchTrending, fetchYahooQuote, RateLimitError, type FullQuote } from '@/lib/quotes'
import { nativeMoney } from '@/lib/marketFormat'

type Region = 'AU' | 'US'

interface Row {
  symbol: string
  quote?: FullQuote
  error?: boolean
}

const cache = new Map<Region, { rows: Row[]; at: number }>()
const TTL = 5 * 60_000
const COUNT = 6

export function TrendingList({
  refreshToken,
  watched,
  onSelect,
  onAdd,
}: {
  refreshToken: number
  /** Yahoo symbols already on the watchlist (to swap + for a check). */
  watched: Set<string>
  onSelect: (row: { symbol: string; name?: string }) => void
  onAdd: (symbol: string) => void
}) {
  const [region, setRegion] = useState<Region>('AU')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runId = useRef(0)

  useEffect(() => {
    const force = refreshToken > 0
    const id = ++runId.current
    const hit = cache.get(region)
    if (!force && hit && Date.now() - hit.at < TTL) {
      setRows(hit.rows)
      setError(null)
      return
    }
    setRows(null)
    setError(null)
    ;(async () => {
      try {
        const symbols = await fetchTrending(region, COUNT)
        if (runId.current !== id) return
        if (!symbols.length) {
          setRows([])
          return
        }
        let current: Row[] = symbols.map((symbol) => ({ symbol }))
        setRows(current)
        for (const symbol of symbols) {
          try {
            const quote = await fetchYahooQuote(symbol)
            current = current.map((r) => (r.symbol === symbol ? { ...r, quote } : r))
          } catch (e) {
            current = current.map((r) => (r.symbol === symbol ? { ...r, error: true } : r))
            if (e instanceof RateLimitError) break
          }
          if (runId.current !== id) return
          setRows(current)
        }
        cache.set(region, { rows: current, at: Date.now() })
      } catch (e) {
        if (runId.current !== id) return
        setRows([])
        setError((e as Error).message)
      }
    })()
  }, [region, refreshToken])

  return (
    <Card className="overflow-hidden">
      <div className="p-3 pb-2">
        <Segmented<Region>
          value={region}
          onChange={setRegion}
          options={[
            { value: 'AU', label: 'Australia' },
            { value: 'US', label: 'United States' },
          ]}
        />
      </div>
      <div className="divide-y divide-border/60">
        {rows === null ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="h-8 w-8 shrink-0 rounded-full bg-border/50 animate-pulse" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-24 rounded bg-border/50 animate-pulse" />
                <div className="h-3 w-14 rounded bg-border/40 animate-pulse" />
              </div>
              <div className="h-4 w-16 rounded bg-border/50 animate-pulse" />
            </div>
          ))
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted px-4 py-3.5">{error ?? 'Nothing trending right now.'}</p>
        ) : (
          rows.map((r) => {
            const q = r.quote
            const up = q ? q.change >= 0 : true
            const inList = watched.has(r.symbol.toUpperCase())
            return (
              <div key={r.symbol} className="flex items-center gap-2.5 px-3.5 py-2.5">
                <button
                  type="button"
                  onClick={() => onSelect({ symbol: r.symbol, name: q?.name })}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                >
                  <TickerLogo symbol={r.symbol} size={32} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{q?.name || r.symbol}</span>
                    <span className="block text-xs text-faint truncate">{r.symbol}{q?.exchange ? ` · ${q.exchange}` : ''}</span>
                  </span>
                  <span className="text-right shrink-0">
                    {q ? (
                      <>
                        <span className="block text-sm font-semibold tabular-nums">{nativeMoney(q.price, q.currency)}</span>
                        <span className={`block text-xs tabular-nums ${up ? 'text-positive' : 'text-negative'}`}>
                          {up ? '+' : '−'}{Math.abs(q.percentChange).toFixed(2)}%
                        </span>
                      </>
                    ) : r.error ? (
                      <span className="text-xs text-faint">—</span>
                    ) : (
                      <span className="block h-8 w-16 rounded bg-border/50 animate-pulse" />
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => !inList && onAdd(r.symbol)}
                  disabled={inList}
                  className={`shrink-0 grid place-items-center h-8 w-8 rounded-lg transition-colors ${
                    inList ? 'text-positive' : 'text-faint hover:text-accent hover:bg-elevated'
                  }`}
                  aria-label={inList ? `${r.symbol} is on your watchlist` : `Add ${r.symbol} to watchlist`}
                >
                  {inList ? <IconCheck width={16} /> : <IconPlus width={16} />}
                </button>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}

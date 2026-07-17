import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Sparkline } from '@/components/ui/Sparkline'
import { fetchYahooSeries, RateLimitError, type FullQuote } from '@/lib/quotes'
import { indexPoints, nativeMoney } from '@/lib/marketFormat'

export interface PulseSymbol {
  yahoo: string
  label: string
  /** Indices show plain points; everything else shows currency. */
  kind: 'index' | 'money'
}

export const PULSE_SYMBOLS: PulseSymbol[] = [
  { yahoo: '^AXJO', label: 'ASX 200', kind: 'index' },
  { yahoo: '^GSPC', label: 'S&P 500', kind: 'index' },
  { yahoo: '^IXIC', label: 'Nasdaq', kind: 'index' },
  { yahoo: '^DJI', label: 'Dow Jones', kind: 'index' },
  { yahoo: 'BTC-USD', label: 'Bitcoin', kind: 'money' },
  { yahoo: 'AUDUSD=X', label: 'AUD/USD', kind: 'money' },
]

interface TileState {
  quote?: FullQuote
  spark?: number[]
  error?: boolean
}

const cache = new Map<string, { s: TileState; at: number }>()
const TTL = 60_000

export function MarketPulse({
  refreshToken,
  onSelect,
}: {
  /** Bump to force a refetch (ties into the page's Refresh button). */
  refreshToken: number
  onSelect: (sym: PulseSymbol) => void
}) {
  const [tiles, setTiles] = useState<Record<string, TileState>>({})
  const busy = useRef(false)
  const first = useRef(true)

  useEffect(() => {
    const force = !first.current
    first.current = false
    if (busy.current) return
    busy.current = true
    let cancelled = false
    ;(async () => {
      try {
        for (const sym of PULSE_SYMBOLS) {
          const hit = cache.get(sym.yahoo)
          if (!force && hit && Date.now() - hit.at < TTL) {
            if (!cancelled) setTiles((p) => ({ ...p, [sym.yahoo]: hit.s }))
            continue
          }
          try {
            const r = await fetchYahooSeries(sym.yahoo, '1d', '15m')
            const s: TileState = { quote: r.quote, spark: r.closes }
            cache.set(sym.yahoo, { s, at: Date.now() })
            if (!cancelled) setTiles((p) => ({ ...p, [sym.yahoo]: s }))
          } catch (e) {
            if (!cancelled) setTiles((p) => ({ ...p, [sym.yahoo]: { ...p[sym.yahoo], error: true } }))
            if (e instanceof RateLimitError) break
          }
          if (cancelled) break
        }
      } finally {
        busy.current = false
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
      {PULSE_SYMBOLS.map((sym) => {
        const t = tiles[sym.yahoo]
        const q = t?.quote
        const up = q ? q.change >= 0 : true
        return (
          <Card key={sym.yahoo} className="p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => onSelect(sym)}
              className="w-full text-left p-3 hover:bg-elevated/60 transition-colors"
            >
              <span className="block text-xs font-medium text-muted truncate">{sym.label}</span>
              {q ? (
                <>
                  <span className="block font-semibold tabular-nums text-sm mt-0.5 truncate">
                    {sym.kind === 'index' ? indexPoints(q.price) : nativeMoney(q.price, q.currency)}
                  </span>
                  <span className={`block text-xs tabular-nums ${up ? 'text-positive' : 'text-negative'}`}>
                    {up ? '+' : '−'}{Math.abs(q.percentChange).toFixed(2)}%
                  </span>
                </>
              ) : t?.error ? (
                <span className="block text-xs text-faint mt-1.5">Unavailable</span>
              ) : (
                <>
                  <span className="block h-4 w-16 rounded bg-border/50 animate-pulse mt-1.5" />
                  <span className="block h-3 w-10 rounded bg-border/50 animate-pulse mt-1" />
                </>
              )}
              {t?.spark && t.spark.length > 1 && (
                <span className="block h-6 mt-1.5">
                  <Sparkline values={t.spark} className={up ? 'text-positive' : 'text-negative'} />
                </span>
              )}
            </button>
          </Card>
        )
      })}
    </div>
  )
}

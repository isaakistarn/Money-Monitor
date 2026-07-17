import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { fetchNews, RateLimitError, type NewsItem } from '@/lib/quotes'
import { asOfLabel } from '@/lib/marketFormat'

const cache = new Map<string, { items: NewsItem[]; at: number }>()
const TTL = 5 * 60_000
const MAX_SYMBOL_QUERIES = 3
const SHOWN = 10

/** General market query used alongside (or instead of) watchlist tickers. */
const MARKET_QUERY = 'stock market'

export function NewsFeed({
  symbols,
  refreshToken,
}: {
  /** Watchlist Yahoo symbols — news is personalized to the first few. */
  symbols: string[]
  refreshToken: number
}) {
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Run-id (not a busy lock): the watchlist loading from Dexie changes `sig`
  // mid-fetch, and a lock would leave the superseded run's state stuck.
  const runId = useRef(0)
  const prevToken = useRef(refreshToken)

  const queries = [MARKET_QUERY, ...symbols.slice(0, MAX_SYMBOL_QUERIES)]
  const sig = queries.join(',')

  useEffect(() => {
    const force = refreshToken !== prevToken.current
    prevToken.current = refreshToken
    const id = ++runId.current
    ;(async () => {
      const merged = new Map<string, NewsItem>()
      let fetchedAny = false
      for (const q of queries) {
        const hit = cache.get(q)
        let batch: NewsItem[]
        if (!force && hit && Date.now() - hit.at < TTL) {
          batch = hit.items
        } else {
          try {
            batch = await fetchNews(q, 8)
            cache.set(q, { items: batch, at: Date.now() })
            fetchedAny = true
          } catch (e) {
            if (e instanceof RateLimitError) break
            batch = hit?.items ?? []
          }
        }
        if (runId.current !== id) return
        for (const n of batch) if (!merged.has(n.id)) merged.set(n.id, n)
      }
      if (runId.current !== id) return
      const sorted = [...merged.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, SHOWN)
      setItems(sorted)
      setError(sorted.length || fetchedAny ? null : 'Could not load news right now.')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, refreshToken])

  return (
    <Card className="divide-y divide-border/60 overflow-hidden">
      {items === null ? (
        Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex gap-3 p-3.5">
            <div className="h-14 w-20 shrink-0 rounded-lg bg-border/50 animate-pulse" />
            <div className="flex-1 space-y-2 py-0.5">
              <div className="h-3.5 rounded bg-border/50 animate-pulse" />
              <div className="h-3.5 w-2/3 rounded bg-border/50 animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-border/40 animate-pulse" />
            </div>
          </div>
        ))
      ) : items.length === 0 ? (
        <p className="text-sm text-muted p-4">{error ?? 'No market news found right now.'}</p>
      ) : (
        items.map((n) => (
          <a
            key={n.id}
            href={n.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex gap-3 p-3.5 hover:bg-elevated/60 transition-colors"
          >
            {n.thumbnail && (
              <img
                src={n.thumbnail}
                alt=""
                loading="lazy"
                className="h-14 w-20 shrink-0 rounded-lg object-cover bg-elevated"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug line-clamp-2">{n.title}</span>
              <span className="block text-xs text-faint mt-1 truncate">
                {n.publisher}
                {n.publishedAt ? ` · ${asOfLabel(n.publishedAt)}` : ''}
                {n.tickers.length > 0 && (
                  <span className="text-accent"> · {n.tickers.join(' ')}</span>
                )}
              </span>
            </span>
          </a>
        ))
      )}
    </Card>
  )
}

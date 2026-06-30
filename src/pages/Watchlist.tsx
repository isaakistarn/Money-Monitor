import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/Confirm'
import { IconTrend, IconPlus, IconTrash, IconRefresh, IconArrowUp, IconArrowDown } from '@/components/ui/icons'
import { useWatchlist } from '@/hooks/useData'
import { useUI } from '@/state/ui'
import { addWatchItem, deleteWatchItem } from '@/db/repo'
import { getMeta, setMeta } from '@/db/meta'
import { fetchYahooQuote, yahooSymbol, RateLimitError, type FullQuote } from '@/lib/quotes'
import type { WatchItem } from '@/types/models'

interface QState {
  loading?: boolean
  data?: FullQuote
  error?: string
}

// Short in-memory cache so navigating to the page doesn't refetch every time.
const cache = new Map<string, { q: FullQuote; at: number }>()
const TTL = 60_000
const keyOf = (i: WatchItem) => `${i.symbol}|${i.exchange ?? ''}`

function nativeMoney(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: price !== 0 && Math.abs(price) < 1 ? 4 : 2,
    }).format(price)
  } catch {
    return `${price.toFixed(2)} ${currency}`
  }
}

function asOfLabel(ms?: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function Change({ q }: { q: FullQuote }) {
  const up = q.change >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${up ? 'text-positive' : 'text-negative'}`}>
      {up ? <IconArrowUp width={12} /> : <IconArrowDown width={12} />}
      {nativeMoney(Math.abs(q.change), q.currency)} ({up ? '+' : '−'}{Math.abs(q.percentChange).toFixed(2)}%)
    </span>
  )
}

export function Watchlist() {
  const items = useWatchlist()
  const lastUpdated = useLiveQuery(() => getMeta<string | null>('watchUpdatedAt', null), [], null)
  const confirm = useConfirm()
  const { toast } = useUI()

  const [quotes, setQuotes] = useState<Record<string, QState>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [draft, setDraft] = useState<{ symbol: string; exchange: string } | null>(null)
  const busy = useRef(false)

  const setQ = (id: string, s: QState) => setQuotes((prev) => ({ ...prev, [id]: s }))

  const load = async (list: WatchItem[], force: boolean) => {
    if (busy.current) return
    busy.current = true
    setRefreshing(true)
    let fetched = false
    try {
      for (const item of list) {
        const ck = keyOf(item)
        const cached = cache.get(ck)
        if (!force && cached && Date.now() - cached.at < TTL) {
          setQ(item.id, { data: cached.q })
          continue
        }
        setQ(item.id, { loading: true, data: cached?.q })
        try {
          const q = await fetchYahooQuote(yahooSymbol(item.symbol, item.exchange))
          cache.set(ck, { q, at: Date.now() })
          setQ(item.id, { data: q })
          fetched = true
        } catch (e) {
          setQ(item.id, { error: (e as Error).message, data: cached?.q })
          if (e instanceof RateLimitError) {
            toast(e.message, 'error')
            break
          }
        }
      }
      if (fetched) await setMeta('watchUpdatedAt', new Date().toISOString())
    } finally {
      busy.current = false
      setRefreshing(false)
    }
  }

  // Auto-load (cache-aware) when the list becomes available or changes.
  const sig = (items ?? []).map((i) => `${i.id}:${i.symbol}:${i.exchange ?? ''}`).join(',')
  useEffect(() => {
    if (items && items.length) void load(items, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const add = async () => {
    if (!draft?.symbol.trim()) return
    await addWatchItem({ symbol: draft.symbol, exchange: draft.exchange })
    setDraft(null)
  }

  const remove = async (item: WatchItem) => {
    const ok = await confirm({ title: `Remove ${item.symbol}?`, message: 'Remove this ticker from your watchlist.', confirmLabel: 'Remove', tone: 'danger' })
    if (!ok) return
    await deleteWatchItem(item.id)
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Watchlist</h1>
          {lastUpdated && <p className="text-xs text-muted mt-0.5">Updated {asOfLabel(new Date(lastUpdated).getTime())}</p>}
        </div>
        <div className="flex gap-2">
          {(items?.length ?? 0) > 0 && (
            <Button variant="secondary" onClick={() => items && load(items, true)} disabled={refreshing}>
              <IconRefresh width={18} className={refreshing ? 'animate-spin' : undefined} /> Refresh
            </Button>
          )}
          <Button onClick={() => setDraft({ symbol: '', exchange: '' })}><IconPlus width={18} /> Add</Button>
        </div>
      </div>

      {items && items.length === 0 ? (
        <EmptyState
          icon={<IconTrend width={32} />}
          title="No tickers yet"
          message="Add stocks, ETFs, or crypto to watch their live prices — free, no setup."
          action={<Button onClick={() => setDraft({ symbol: '', exchange: '' })}><IconPlus width={18} /> Add a ticker</Button>}
        />
      ) : (
        <div className="space-y-2.5">
          {items?.map((item) => {
            const s = quotes[item.id]
            const q = s?.data
            return (
              <Card key={item.id} className="p-4 flex items-center gap-3">
                <span className="grid place-items-center h-10 w-10 rounded-full bg-elevated text-xs font-bold shrink-0">
                  {item.symbol.slice(0, 4)}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {q?.name || item.symbol}
                    <span className="text-faint font-normal"> · {item.symbol}{item.exchange ? ` · ${item.exchange}` : q?.exchange ? ` · ${q.exchange}` : ''}</span>
                  </p>
                  <p className="text-xs text-faint">
                    {s?.loading && !q ? 'Loading…'
                      : s?.error && !q ? <span className="text-negative">{s.error}</span>
                      : q ? `as of ${asOfLabel(q.asOf)}`
                      : 'Tap Refresh to load'}
                  </p>
                </div>
                <div className="text-right">
                  {q ? (
                    <>
                      <p className="font-semibold tabular-nums">{nativeMoney(q.price, q.currency)}</p>
                      <Change q={q} />
                    </>
                  ) : (
                    <div className="h-9 w-20 rounded bg-border/50 animate-pulse" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(item)}
                  className="shrink-0 grid place-items-center h-9 w-9 rounded-lg text-faint hover:text-negative hover:bg-elevated"
                  aria-label={`Remove ${item.symbol}`}
                >
                  <IconTrash width={17} />
                </button>
              </Card>
            )
          })}
        </div>
      )}

      <p className="text-xs text-faint">
        Live data from Yahoo Finance (free, no key) — refreshed on demand and cached briefly. Prices are shown
        in each market's own currency.
      </p>

      {/* Add modal */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title="Add ticker"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={add}>Add</Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Symbol">
                <Input autoFocus value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} placeholder="AAPL, CBA, BTC/USD" maxLength={16} />
              </Field>
              <Field label="Exchange" hint="e.g. ASX (blank for US)">
                <Input value={draft.exchange} onChange={(e) => setDraft({ ...draft, exchange: e.target.value })} placeholder="ASX, NASDAQ…" maxLength={12} />
              </Field>
            </div>
            <p className="text-xs text-muted">
              US stocks work with just the symbol. For ASX use the symbol + exchange <code className="text-fg">ASX</code>{' '}
              (or enter it Yahoo-style like <code className="text-fg">CBA.AX</code>). For crypto use a pair like{' '}
              <code className="text-fg">BTC/USD</code>.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

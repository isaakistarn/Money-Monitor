import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { Sparkline } from '@/components/ui/Sparkline'
import { useConfirm } from '@/components/ui/Confirm'
import { IconTrend, IconPlus, IconTrash, IconRefresh, IconArrowUp, IconArrowDown, IconSearch } from '@/components/ui/icons'
import { useWatchlist } from '@/hooks/useData'
import { useUI } from '@/state/ui'
import { addWatchItem, deleteWatchItem } from '@/db/repo'
import { getMeta, setMeta } from '@/db/meta'
import { fetchYahooSeries, yahooSymbol, searchSymbols, RateLimitError, type FullQuote, type SymbolMatch } from '@/lib/quotes'
import type { WatchItem } from '@/types/models'

interface QState {
  loading?: boolean
  data?: FullQuote
  closes?: number[]
  error?: string
}

const cache = new Map<string, { q: FullQuote; closes: number[]; at: number }>()
const TTL = 60_000
const keyOf = (i: WatchItem) => `${i.symbol}|${i.exchange ?? ''}`

const RANGES = [
  { key: '1M', range: '1mo', interval: '1d' },
  { key: '6M', range: '6mo', interval: '1d' },
  { key: '1Y', range: '1y', interval: '1wk' },
  { key: '5Y', range: '5y', interval: '1mo' },
]

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
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function pctOf(values: number[]): { up: boolean; pct: number } {
  if (!values || values.length < 2) return { up: true, pct: 0 }
  const first = values[0]
  const last = values[values.length - 1]
  return { up: last >= first, pct: first ? ((last - first) / first) * 100 : 0 }
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

interface Detail {
  item: WatchItem
  rangeKey: string
  quote?: FullQuote
  closes?: number[]
  loading?: boolean
  error?: string
}

export function Watchlist() {
  const items = useWatchlist()
  const lastUpdated = useLiveQuery(() => getMeta<string | null>('watchUpdatedAt', null), [], null)
  const confirm = useConfirm()
  const { toast } = useUI()

  const [quotes, setQuotes] = useState<Record<string, QState>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [draft, setDraft] = useState<{ symbol: string; exchange: string } | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const busy = useRef(false)

  // Symbol search (in the Add modal).
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SymbolMatch[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!draft) return
    const q = query.trim()
    if (q.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        setResults(await searchSymbols(q))
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, draft])

  const openAdd = () => { setQuery(''); setResults([]); setDraft({ symbol: '', exchange: '' }) }
  const closeAdd = () => { setDraft(null); setQuery(''); setResults([]) }
  const pickResult = async (m: SymbolMatch) => {
    await addWatchItem({ symbol: m.symbol, exchange: '' })
    closeAdd()
  }

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
          setQ(item.id, { data: cached.q, closes: cached.closes })
          continue
        }
        setQ(item.id, { loading: true, data: cached?.q, closes: cached?.closes })
        try {
          const r = await fetchYahooSeries(yahooSymbol(item.symbol, item.exchange), '1mo', '1d')
          cache.set(ck, { q: r.quote, closes: r.closes, at: Date.now() })
          setQ(item.id, { data: r.quote, closes: r.closes })
          fetched = true
        } catch (e) {
          setQ(item.id, { error: (e as Error).message, data: cached?.q, closes: cached?.closes })
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

  const sig = (items ?? []).map((i) => `${i.id}:${i.symbol}:${i.exchange ?? ''}`).join(',')
  useEffect(() => {
    if (items && items.length) void load(items, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  const openDetail = (item: WatchItem) => {
    const s = quotes[item.id]
    setDetail({ item, rangeKey: '1M', quote: s?.data, closes: s?.closes })
    if (!s?.closes) void loadDetail(item, '1M')
  }

  const loadDetail = async (item: WatchItem, rangeKey: string) => {
    const cfg = RANGES.find((r) => r.key === rangeKey)!
    setDetail((d) => (d && d.item.id === item.id ? { ...d, rangeKey, loading: true, error: undefined } : d))
    try {
      const r = await fetchYahooSeries(yahooSymbol(item.symbol, item.exchange), cfg.range, cfg.interval)
      setDetail((d) => (d && d.item.id === item.id ? { ...d, rangeKey, quote: r.quote, closes: r.closes, loading: false } : d))
    } catch (e) {
      setDetail((d) => (d && d.item.id === item.id ? { ...d, rangeKey, loading: false, error: (e as Error).message } : d))
    }
  }

  const add = async () => {
    if (!draft?.symbol.trim()) return
    await addWatchItem({ symbol: draft.symbol, exchange: draft.exchange })
    closeAdd()
  }

  const remove = async (item: WatchItem) => {
    const ok = await confirm({ title: `Remove ${item.symbol}?`, message: 'Remove this ticker from your watchlist.', confirmLabel: 'Remove', tone: 'danger' })
    if (!ok) return
    await deleteWatchItem(item.id)
  }

  const detailPct = detail?.closes ? pctOf(detail.closes) : null

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
          <Button onClick={openAdd}><IconPlus width={18} /> Add</Button>
        </div>
      </div>

      {items && items.length === 0 ? (
        <EmptyState
          icon={<IconTrend width={32} />}
          title="No tickers yet"
          message="Add stocks, ETFs, or crypto to watch their live prices and charts — free, no setup."
          action={<Button onClick={openAdd}><IconPlus width={18} /> Add a ticker</Button>}
        />
      ) : (
        <div className="space-y-2.5">
          {items?.map((item) => {
            const s = quotes[item.id]
            const q = s?.data
            const spark = s?.closes
            const up = spark ? spark[spark.length - 1] >= spark[0] : (q ? q.change >= 0 : true)
            return (
              <Card key={item.id} className="p-3.5">
                <div className="flex items-center gap-3">
                  <button onClick={() => openDetail(item)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    <span className="grid place-items-center h-10 w-10 rounded-full bg-elevated text-xs font-bold shrink-0">
                      {item.symbol.slice(0, 4)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-sm truncate">
                        {q?.name || item.symbol}
                        <span className="text-faint font-normal"> · {item.symbol}{item.exchange ? ` · ${item.exchange}` : q?.exchange ? ` · ${q.exchange}` : ''}</span>
                      </span>
                      <span className="block text-xs text-faint">
                        {s?.loading && !q ? 'Loading…'
                          : s?.error && !q ? <span className="text-negative">{s.error}</span>
                          : q ? `as of ${asOfLabel(q.asOf)}`
                          : 'Tap to load'}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      {q ? (
                        <>
                          <span className="block font-semibold tabular-nums">{nativeMoney(q.price, q.currency)}</span>
                          <Change q={q} />
                        </>
                      ) : (
                        <span className="block h-9 w-20 rounded bg-border/50 animate-pulse" />
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    className="shrink-0 grid place-items-center h-9 w-9 rounded-lg text-faint hover:text-negative hover:bg-elevated"
                    aria-label={`Remove ${item.symbol}`}
                  >
                    <IconTrash width={17} />
                  </button>
                </div>
                {spark && spark.length > 1 && (
                  <button onClick={() => openDetail(item)} className="block w-full h-9 mt-2.5" aria-label="Open chart">
                    <Sparkline values={spark} className={up ? 'text-positive' : 'text-negative'} />
                  </button>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <p className="text-xs text-faint">
        Live data and charts from Yahoo Finance (free, no key) — refreshed on demand and cached briefly. Prices
        are shown in each market's own currency. Tap a ticker for a larger chart.
      </p>

      {/* Add modal */}
      <Modal
        open={!!draft}
        onClose={closeAdd}
        title="Add ticker"
        footer={
          <>
            <Button variant="secondary" onClick={closeAdd}>Cancel</Button>
            <Button onClick={add} disabled={!draft?.symbol.trim()}>Add manually</Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <Field label="Search company or ticker">
              <div className="relative">
                <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" width={18} />
                <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Commonwealth Bank, AAPL, BHP" className="pl-10" />
              </div>
            </Field>

            {query.trim().length >= 2 && (
              <div className="rounded-xl border border-border divide-y divide-border/60 max-h-72 overflow-y-auto">
                {searching && results.length === 0 ? (
                  <p className="text-sm text-muted px-3 py-3">Searching…</p>
                ) : results.length === 0 ? (
                  <p className="text-sm text-muted px-3 py-3">No matches. Try the full company name or the ticker.</p>
                ) : (
                  results.map((m) => (
                    <button
                      key={`${m.symbol}-${m.exchange}`}
                      onClick={() => pickResult(m)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-elevated transition-colors"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{m.name}</span>
                        <span className="block text-xs text-faint">
                          {m.symbol}{m.exchange ? ` · ${m.exchange}` : ''}{m.type && m.type !== 'EQUITY' ? ` · ${m.type.toLowerCase()}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-accent"><IconPlus width={18} /></span>
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="border-t border-border pt-3">
              <p className="text-xs text-muted mb-2">Or add manually</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Symbol">
                  <Input value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} placeholder="AAPL, CBA, BTC/USD" maxLength={16} />
                </Field>
                <Field label="Exchange" hint="e.g. ASX (blank for US)">
                  <Input value={draft.exchange} onChange={(e) => setDraft({ ...draft, exchange: e.target.value })} placeholder="ASX, NASDAQ…" maxLength={12} />
                </Field>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Chart detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.quote?.name || detail?.item.symbol || 'Chart'} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                {detail.quote && <p className="text-2xl font-bold tabular-nums">{nativeMoney(detail.quote.price, detail.quote.currency)}</p>}
                {detailPct && (
                  <p className={`text-sm font-medium ${detailPct.up ? 'text-positive' : 'text-negative'}`}>
                    {detailPct.up ? '+' : '−'}{Math.abs(detailPct.pct).toFixed(2)}% · {detail.rangeKey}
                  </p>
                )}
              </div>
              <p className="text-xs text-faint text-right">
                {detail.item.symbol}{detail.item.exchange ? ` · ${detail.item.exchange}` : ''}
              </p>
            </div>

            <div className="h-44 rounded-xl bg-elevated/40 border border-border p-2">
              {detail.loading && !detail.closes ? (
                <div className="h-full w-full rounded bg-border/40 animate-pulse" />
              ) : detail.error && !detail.closes ? (
                <div className="h-full grid place-items-center text-sm text-negative">{detail.error}</div>
              ) : detail.closes && detail.closes.length > 1 ? (
                <Sparkline values={detail.closes} strokeWidth={2} className={detailPct?.up ? 'text-positive' : 'text-negative'} />
              ) : (
                <div className="h-full grid place-items-center text-sm text-muted">No chart data</div>
              )}
            </div>

            <div className="flex gap-2">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => loadDetail(detail.item, r.key)}
                  className={`flex-1 h-9 rounded-lg text-sm font-medium transition-colors ${
                    detail.rangeKey === r.key ? 'bg-accent text-white' : 'bg-elevated text-muted hover:text-fg'
                  }`}
                >
                  {r.key}
                </button>
              ))}
            </div>

            {detail.closes && detail.closes.length > 1 && detail.quote && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between rounded-lg bg-elevated/50 px-3 py-2">
                  <span className="text-muted">High</span>
                  <span className="font-medium tabular-nums">{nativeMoney(Math.max(...detail.closes), detail.quote.currency)}</span>
                </div>
                <div className="flex justify-between rounded-lg bg-elevated/50 px-3 py-2">
                  <span className="text-muted">Low</span>
                  <span className="font-medium tabular-nums">{nativeMoney(Math.min(...detail.closes), detail.quote.currency)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

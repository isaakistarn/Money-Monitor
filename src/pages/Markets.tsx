import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { Sparkline } from '@/components/ui/Sparkline'
import { PriceChart } from '@/components/watchlist/PriceChart'
import { TickerLogo } from '@/components/watchlist/TickerLogo'
import { MarketPulse, type PulseSymbol } from '@/components/markets/MarketPulse'
import { NewsFeed } from '@/components/markets/NewsFeed'
import { TrendingList } from '@/components/markets/TrendingList'
import { useConfirm } from '@/components/ui/Confirm'
import { IconTrend, IconPlus, IconTrash, IconRefresh, IconArrowUp, IconArrowDown, IconSearch } from '@/components/ui/icons'
import { useWatchlist } from '@/hooks/useData'
import { useUI } from '@/state/ui'
import { addWatchItem, deleteWatchItem } from '@/db/repo'
import { getMeta, setMeta } from '@/db/meta'
import { fetchYahooSeries, yahooSymbol, searchSymbols, RateLimitError, type FullQuote, type SymbolMatch } from '@/lib/quotes'
import { nativeMoney, asOfLabel, pctOf, compactNumber } from '@/lib/marketFormat'
import type { WatchItem } from '@/types/models'

interface QState {
  loading?: boolean
  data?: FullQuote
  closes?: number[]
  times?: number[]
  error?: string
}

const cache = new Map<string, { q: FullQuote; closes: number[]; times: number[]; at: number }>()
const TTL = 60_000
const keyOf = (i: WatchItem) => `${i.symbol}|${i.exchange ?? ''}`

const RANGES = [
  { key: '1D', range: '1d', interval: '5m', intraday: true },
  { key: '1W', range: '5d', interval: '30m', intraday: true },
  { key: '1M', range: '1mo', interval: '1d', intraday: false },
  { key: '6M', range: '6mo', interval: '1d', intraday: false },
  { key: '1Y', range: '1y', interval: '1wk', intraday: false },
  { key: '5Y', range: '5y', interval: '1mo', intraday: false },
]

function Change({ q }: { q: FullQuote }) {
  const up = q.change >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs ${up ? 'text-positive' : 'text-negative'}`}>
      {up ? <IconArrowUp width={12} /> : <IconArrowDown width={12} />}
      {nativeMoney(Math.abs(q.change), q.currency)} ({up ? '+' : '−'}{Math.abs(q.percentChange).toFixed(2)}%)
    </span>
  )
}

/** Anything chartable: a watchlist item, a pulse tile, or a trending row. */
interface DetailTarget {
  symbol: string
  exchange?: string
  name?: string
}

interface Detail {
  target: DetailTarget
  rangeKey: string
  quote?: FullQuote
  closes?: number[]
  times?: number[]
  loading?: boolean
  error?: string
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 rounded-lg bg-elevated/50 px-3 py-2">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums text-right">{value}</span>
    </div>
  )
}

export function Markets() {
  const items = useWatchlist()
  const lastUpdated = useLiveQuery(() => getMeta<string | null>('watchUpdatedAt', null), [], null)
  const confirm = useConfirm()
  const { toast } = useUI()

  const [quotes, setQuotes] = useState<Record<string, QState>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
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
          setQ(item.id, { data: cached.q, closes: cached.closes, times: cached.times })
          continue
        }
        setQ(item.id, { loading: true, data: cached?.q, closes: cached?.closes, times: cached?.times })
        try {
          const r = await fetchYahooSeries(yahooSymbol(item.symbol, item.exchange), '1mo', '1d')
          cache.set(ck, { q: r.quote, closes: r.closes, times: r.times, at: Date.now() })
          setQ(item.id, { data: r.quote, closes: r.closes, times: r.times })
          fetched = true
        } catch (e) {
          setQ(item.id, { error: (e as Error).message, data: cached?.q, closes: cached?.closes, times: cached?.times })
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

  const refreshAll = () => {
    setRefreshToken((t) => t + 1)
    if (items?.length) void load(items, true)
  }

  const openItemDetail = (item: WatchItem) => {
    const s = quotes[item.id]
    const target = { symbol: item.symbol, exchange: item.exchange, name: s?.data?.name }
    setDetail({ target, rangeKey: '1M', quote: s?.data, closes: s?.closes, times: s?.times })
    if (!s?.closes) void loadDetail(target, '1M')
  }

  const openSymbolDetail = (target: DetailTarget) => {
    setDetail({ target, rangeKey: '1M', loading: true })
    void loadDetail(target, '1M')
  }

  const loadDetail = async (target: DetailTarget, rangeKey: string) => {
    const cfg = RANGES.find((r) => r.key === rangeKey)!
    setDetail((d) => (d && d.target.symbol === target.symbol ? { ...d, rangeKey, loading: true, error: undefined } : d))
    try {
      const r = await fetchYahooSeries(yahooSymbol(target.symbol, target.exchange), cfg.range, cfg.interval)
      setDetail((d) => (d && d.target.symbol === target.symbol ? { ...d, rangeKey, quote: r.quote, closes: r.closes, times: r.times, loading: false } : d))
    } catch (e) {
      setDetail((d) => (d && d.target.symbol === target.symbol ? { ...d, rangeKey, loading: false, error: (e as Error).message } : d))
    }
  }

  const add = async () => {
    if (!draft?.symbol.trim()) return
    await addWatchItem({ symbol: draft.symbol, exchange: draft.exchange })
    closeAdd()
  }

  const addSymbol = async (symbol: string) => {
    await addWatchItem({ symbol, exchange: '' })
    toast(`${symbol} added to watchlist`, 'success')
  }

  const remove = async (item: WatchItem) => {
    const ok = await confirm({ title: `Remove ${item.symbol}?`, message: 'Remove this ticker from your watchlist.', confirmLabel: 'Remove', tone: 'danger' })
    if (!ok) return
    await deleteWatchItem(item.id)
  }

  const watchedYahoo = new Set((items ?? []).map((i) => yahooSymbol(i.symbol, i.exchange).toUpperCase()))
  const detailPct = detail?.closes ? pctOf(detail.closes) : null
  const dq = detail?.quote

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Markets</h1>
          {lastUpdated && <p className="text-xs text-muted mt-0.5">Updated {asOfLabel(new Date(lastUpdated).getTime())}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={refreshAll} disabled={refreshing}>
            <IconRefresh width={18} className={refreshing ? 'animate-spin' : undefined} /> Refresh
          </Button>
          <Button onClick={openAdd}><IconPlus width={18} /> Add</Button>
        </div>
      </div>

      <section>
        <SectionHeader title="Market pulse" />
        <MarketPulse
          refreshToken={refreshToken}
          onSelect={(sym: PulseSymbol) => openSymbolDetail({ symbol: sym.yahoo, name: sym.label })}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-5 items-start">
        <section className="xl:col-span-3 min-w-0">
          <SectionHeader title="Watchlist" />
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
                      <button onClick={() => openItemDetail(item)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                        <TickerLogo symbol={item.symbol} exchange={item.exchange} size={40} />
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
                      <button onClick={() => openItemDetail(item)} className="block w-full h-9 mt-2.5" aria-label="Open chart">
                        <Sparkline values={spark} className={up ? 'text-positive' : 'text-negative'} />
                      </button>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
          <p className="text-xs text-faint mt-3">
            Live data, news, and charts from Yahoo Finance (free, no key) — refreshed on demand and cached briefly.
            Prices are shown in each market's own currency. Tap any tile or ticker for a larger chart.
          </p>
        </section>

        <div className="xl:col-span-2 min-w-0 space-y-6">
          <section>
            <SectionHeader title="Trending" />
            <TrendingList
              refreshToken={refreshToken}
              watched={watchedYahoo}
              onSelect={(r) => openSymbolDetail(r)}
              onAdd={(symbol) => void addSymbol(symbol)}
            />
          </section>

          <section>
            <SectionHeader title="Latest news" />
            <NewsFeed
              symbols={(items ?? []).map((i) => yahooSymbol(i.symbol, i.exchange))}
              refreshToken={refreshToken}
            />
          </section>
        </div>
      </div>

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
      <Modal open={!!detail} onClose={() => setDetail(null)} title={dq?.name || detail?.target.name || detail?.target.symbol || 'Chart'} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                {dq && <p className="text-2xl font-bold tabular-nums">{nativeMoney(dq.price, dq.currency)}</p>}
                {detailPct && (
                  <p className={`text-sm font-medium ${detailPct.up ? 'text-positive' : 'text-negative'}`}>
                    {detailPct.up ? '+' : '−'}{Math.abs(detailPct.pct).toFixed(2)}% · {detail.rangeKey}
                  </p>
                )}
              </div>
              <p className="text-xs text-faint text-right">
                {detail.target.symbol}{detail.target.exchange ? ` · ${detail.target.exchange}` : dq?.exchange ? ` · ${dq.exchange}` : ''}
              </p>
            </div>

            <div className="h-56 rounded-xl bg-elevated/40 border border-border p-2 pr-1">
              {detail.loading && !detail.closes ? (
                <div className="h-full w-full rounded bg-border/40 animate-pulse" />
              ) : detail.error && !detail.closes ? (
                <div className="h-full grid place-items-center text-sm text-negative">{detail.error}</div>
              ) : detail.closes && detail.times && detail.closes.length > 1 ? (
                <PriceChart
                  closes={detail.closes}
                  times={detail.times}
                  currency={dq?.currency || 'USD'}
                  up={!!detailPct?.up}
                  intraday={RANGES.find((r) => r.key === detail.rangeKey)?.intraday ?? false}
                />
              ) : (
                <div className="h-full grid place-items-center text-sm text-muted">No chart data</div>
              )}
            </div>

            <div className="flex gap-1.5">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => loadDetail(detail.target, r.key)}
                  className={`flex-1 h-9 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                    detail.rangeKey === r.key ? 'bg-accent text-white' : 'bg-elevated text-muted hover:text-fg'
                  }`}
                >
                  {r.key}
                </button>
              ))}
            </div>

            {dq && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                {dq.previousClose && <StatRow label="Prev close" value={nativeMoney(dq.previousClose, dq.currency)} />}
                {dq.volume && <StatRow label="Volume" value={compactNumber(dq.volume)} />}
                {dq.dayLow && dq.dayHigh && (
                  <StatRow label="Day range" value={`${nativeMoney(dq.dayLow, dq.currency)} – ${nativeMoney(dq.dayHigh, dq.currency)}`} />
                )}
                {dq.fiftyTwoWeekLow && dq.fiftyTwoWeekHigh && (
                  <StatRow label="52-wk range" value={`${nativeMoney(dq.fiftyTwoWeekLow, dq.currency)} – ${nativeMoney(dq.fiftyTwoWeekHigh, dq.currency)}`} />
                )}
                {detail.closes && detail.closes.length > 1 && (
                  <>
                    <StatRow label={`High (${detail.rangeKey})`} value={nativeMoney(Math.max(...detail.closes), dq.currency)} />
                    <StatRow label={`Low (${detail.rangeKey})`} value={nativeMoney(Math.min(...detail.closes), dq.currency)} />
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

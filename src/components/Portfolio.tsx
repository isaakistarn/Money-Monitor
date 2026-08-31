import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Field'
import { useConfirm } from '@/components/ui/Confirm'
import { IconPlus, IconTrash, IconChart, IconRefresh, IconWarning } from '@/components/ui/icons'
import { useHoldings } from '@/hooks/useData'
import { useCurrency } from '@/state/settings'
import { useUI } from '@/state/ui'
import { addHolding, updateHolding, deleteHolding } from '@/db/repo'
import { refreshHoldingPrices, fetchLivePrice } from '@/db/prices'
import { recordPortfolioSnapshot } from '@/db/history'
import { getMeta } from '@/db/meta'
import { parseMoney, minorToInput, currencySymbol, formatMoney } from '@/lib/money'
import { holdingValueMinor, holdingGainMinor, gainPct, costBasisOf, autoPriceOn } from '@/lib/portfolio'
import type { Holding, HoldingType } from '@/types/models'

const TYPE_LABELS: Record<HoldingType, string> = {
  stock: 'Stock', etf: 'ETF / Fund', crypto: 'Crypto', commodity: 'Commodity', cash: 'Cash', other: 'Other',
}
const TYPE_ICON: Record<HoldingType, string> = {
  stock: '📈', etf: '🧺', crypto: '🪙', commodity: '🥇', cash: '💵', other: '📊',
}

interface Draft {
  id?: string
  name: string
  symbol: string
  exchange: string
  type: HoldingType
  quantity: string
  price: string
  /** Buy price per share/unit (what you paid), used for profit/loss. */
  buyPrice: string
  /** Pull `price` live from Yahoo instead of typing it in. */
  auto: boolean
  /** True while `name` is one WE filled from a quote, so a later lookup may
   *  replace it. Cleared the moment the user types a name of their own. */
  nameAuto: boolean
  note: string
}

function emptyDraft(): Draft {
  return { name: '', symbol: '', exchange: '', type: 'stock', quantity: '', price: '', buyPrice: '', auto: true, nameAuto: false, note: '' }
}

/** Status of the live-price lookup behind the auto toggle. */
type PriceState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; label: string }
  | { kind: 'error'; message: string }

function Gain({ minor, pct }: { minor?: number; pct?: number }) {
  const currency = useCurrency()
  if (minor == null) return null
  const cls = minor > 0 ? 'text-positive' : minor < 0 ? 'text-negative' : 'text-muted'
  return (
    <span className={`text-xs ${cls}`}>
      {formatMoney(minor, currency, { signed: true })}
      {pct != null && ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`}
    </span>
  )
}

function updatedAgo(iso: string | null): string {
  if (!iso) return ''
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function Portfolio() {
  const holdings = useHoldings()
  const currency = useCurrency()
  const confirm = useConfirm()
  const { toast } = useUI()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [priceState, setPriceState] = useState<PriceState>({ kind: 'idle' })
  const [refreshing, setRefreshing] = useState(false)
  const pricesUpdatedAt = useLiveQuery(() => getMeta<string | null>('pricesUpdatedAt', null), [])
  const autoRan = useRef(false)

  const list = holdings ?? []
  // Only holdings tracking Yahoo are refreshed; hand-priced ones are left alone.
  const tracked = list.filter(autoPriceOn)

  const refreshPrices = async (notify = true) => {
    if (tracked.length === 0) {
      if (notify) toast('No holdings are tracking live prices yet.', 'error')
      return
    }
    setRefreshing(true)
    try {
      const res = await refreshHoldingPrices(tracked, { appCurrency: currency })
      if (!notify) return
      if (res.updated > 0) {
        toast(
          `Updated ${res.updated} price${res.updated === 1 ? '' : 's'}` +
            (res.failed.length ? ` · ${res.failed.length} failed` : ''),
          res.failed.length ? 'error' : 'success',
        )
      } else {
        toast(res.failed[0]?.error ?? 'No prices updated.', 'error')
      }
    } catch (e) {
      if (notify) toast((e as Error).message, 'error')
    } finally {
      setRefreshing(false)
    }
  }

  // Auto-refresh (quietly) when prices are stale, so the portfolio tracks live.
  useEffect(() => {
    if (autoRan.current || pricesUpdatedAt === undefined || tracked.length === 0) return
    const stale = !pricesUpdatedAt || Date.now() - new Date(pricesUpdatedAt).getTime() > 15 * 60_000
    if (!stale) return
    autoRan.current = true
    void refreshPrices(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricesUpdatedAt, tracked.length])
  const totalValue = list.reduce((s, h) => s + h.valueMinor, 0)
  const hasCost = list.some((h) => h.gainMinor != null)
  const totalGain = list.reduce((s, h) => s + (h.gainMinor ?? 0), 0)
  const totalCost = list.reduce((s, h) => s + (costBasisOf(h) ?? 0), 0)
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : undefined

  // Record a daily snapshot of portfolio value so Analytics can chart it over
  // time (keyed by date, so intraday updates just refresh today's point).
  useEffect(() => {
    if (!holdings || holdings.length === 0) return
    void recordPortfolioSnapshot(totalValue, totalCost)
  }, [holdings, totalValue, totalCost])

  const open = (h?: (typeof list)[number]) => {
    setPriceState({ kind: 'idle' })
    setDraft(
      h
        ? {
            id: h.id, name: h.name, symbol: h.symbol ?? '', exchange: h.exchange ?? '', type: h.type,
            quantity: String(h.quantity), price: minorToInput(h.unitPriceMinor, currency),
            auto: autoPriceOn(h), nameAuto: false,
            // Prefer the stored per-unit buy price; fall back to deriving it from
            // a legacy total-invested amount so existing holdings edit cleanly.
            buyPrice:
              h.avgCostMinor != null
                ? minorToInput(h.avgCostMinor, currency)
                : h.costBasisMinor != null && h.quantity > 0
                  ? minorToInput(Math.round(h.costBasisMinor / h.quantity), currency)
                  : '',
            note: h.note ?? '',
          }
        : emptyDraft(),
    )
  }

  // Live price lookup behind the auto toggle. Debounced so typing a ticker
  // fires one request rather than one per keystroke, and guarded by a token so
  // a slow earlier response can never overwrite a newer symbol's price.
  const autoSymbol = draft?.auto ? draft.symbol.trim().toUpperCase() : ''
  const autoExchange = draft?.exchange.trim() ?? ''
  const autoType = draft?.type ?? 'stock'
  useEffect(() => {
    if (!draft) return
    if (!autoSymbol) {
      setPriceState({ kind: 'idle' })
      return
    }
    let live = true
    setPriceState({ kind: 'loading' })
    const timer = setTimeout(async () => {
      try {
        const res = await fetchLivePrice({ symbol: autoSymbol, exchange: autoExchange, type: autoType }, currency)
        if (!live) return
        setPriceState({
          kind: 'ok',
          label:
            `${res.quote.name || autoSymbol}` +
            (res.converted ? ` · converted from ${res.quote.currency}` : ''),
        })
        setDraft((d) => {
          // Re-read the draft rather than closing over it: the user may have
          // edited other fields while the request was in flight.
          if (!d || !d.auto || d.symbol.trim().toUpperCase() !== autoSymbol) return d
          // Replace the name only when it's blank or still the one we filled in
          // for a previous ticker — never a name the user typed themselves.
          const takeName = !d.name.trim() || d.nameAuto
          return {
            ...d,
            price: minorToInput(res.priceMinor, currency),
            name: takeName ? res.quote.name : d.name,
            nameAuto: takeName,
          }
        })
      } catch (e) {
        if (live) setPriceState({ kind: 'error', message: (e as Error).message })
      }
    }, 600)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSymbol, autoExchange, autoType, currency, !!draft])

  // Live preview of the holding currently being edited.
  const draftQty = draft ? Number(draft.quantity) || 0 : 0
  const draftPrice = draft ? parseMoney(draft.price, currency) || 0 : 0
  const draftValue = holdingValueMinor(draftQty, draftPrice)
  const draftBuy = draft && draft.buyPrice.trim() ? parseMoney(draft.buyPrice, currency) : undefined
  const draftCost = draftBuy != null && Number.isFinite(draftBuy) ? Math.round(draftQty * draftBuy) : undefined
  const draftGain = holdingGainMinor(draftValue, draftCost)

  const save = async () => {
    if (!draft || !draft.name.trim()) return toast('Give the holding a name.', 'error')
    const quantity = Number(draft.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) return toast('Enter a valid quantity.', 'error')
    const symbol = draft.symbol.trim().toUpperCase()
    const auto = draft.auto && !!symbol
    if (draft.auto && !symbol) return toast('Add a ticker symbol to track the price live.', 'error')
    const unitPriceMinor = parseMoney(draft.price, currency)
    if (!Number.isFinite(unitPriceMinor) || unitPriceMinor < 0)
      return toast(
        auto ? "Couldn't fetch a price for that symbol — check it, or turn off live pricing." : 'Enter a valid price.',
        'error',
      )
    const avgCostMinor = draft.buyPrice.trim() ? parseMoney(draft.buyPrice, currency) : undefined
    if (avgCostMinor != null && (!Number.isFinite(avgCostMinor) || avgCostMinor < 0))
      return toast('Enter a valid buy price.', 'error')
    const hasCost = avgCostMinor != null && Number.isFinite(avgCostMinor)
    const payload = {
      name: draft.name.trim(),
      symbol: symbol || undefined,
      exchange: draft.exchange.trim().toUpperCase() || undefined,
      type: draft.type,
      quantity,
      unitPriceMinor,
      // Stored explicitly (not inferred from the symbol) so a holding can keep
      // its ticker for reference while its price stays hand-entered.
      autoPrice: auto,
      // Store the per-unit buy price and keep the total cost basis in sync so
      // every consumer (Net Worth, totals, gain/loss) stays consistent.
      avgCostMinor: hasCost ? avgCostMinor : undefined,
      costBasisMinor: hasCost ? Math.round(quantity * avgCostMinor!) : undefined,
      note: draft.note.trim() || undefined,
    }
    if (draft.id) await updateHolding(draft.id, payload)
    else await addHolding(payload as Omit<Holding, 'id' | 'createdAt' | 'updatedAt'>)
    setDraft(null)
    toast(draft.id ? 'Holding updated' : 'Holding added', 'success')
  }

  const remove = async () => {
    if (!draft?.id) return
    const ok = await confirm({
      title: `Delete “${draft.name}”?`,
      message: 'This removes the holding from your portfolio. Your Net Worth updates accordingly.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    await deleteHolding(draft.id)
    setDraft(null)
    toast('Holding deleted')
  }

  return (
    <section>
      <SectionHeader
        title="Investments"
        action={
          <div className="flex gap-2">
            {tracked.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => refreshPrices()} disabled={refreshing}>
                <IconRefresh width={15} className={refreshing ? 'animate-spin' : undefined} />
                {refreshing ? 'Updating…' : 'Refresh'}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => open()}><IconPlus width={16} /> Add</Button>
          </div>
        }
      />

      {list.length === 0 ? (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <span className="text-muted mt-0.5"><IconChart width={20} /></span>
            <p className="text-sm text-muted leading-relaxed">
              Track stocks, funds, crypto, and commodities here. Add a holding with its quantity and ticker
              and the price is pulled live from Yahoo Finance — it counts toward your Net Worth.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-4 mb-2.5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted">Portfolio value</p>
              <p className="text-lg md:text-xl font-bold mt-0.5"><Money minor={totalValue} /></p>
              {pricesUpdatedAt && <p className="text-[11px] text-faint mt-0.5">Prices updated {updatedAgo(pricesUpdatedAt)}</p>}
            </div>
            {hasCost && (
              <div className="text-right">
                <p className="text-xs text-muted">Total gain/loss</p>
                <p className="mt-0.5 font-semibold"><Gain minor={totalGain} pct={totalGainPct} /></p>
              </div>
            )}
          </Card>
          <div className="space-y-2.5">
            {list.map((h) => (
              <Card
                key={h.id}
                className="p-4 flex items-center gap-3 cursor-pointer hover:border-accent/40 transition-colors"
                onClick={() => open(h)}
              >
                <span className="grid place-items-center h-10 w-10 rounded-full bg-elevated text-lg shrink-0">
                  {TYPE_ICON[h.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {h.name}
                    {h.symbol && <span className="text-faint font-normal"> · {h.symbol}</span>}
                  </p>
                  <p className="text-xs text-faint flex items-center gap-1.5">
                    <span>{h.quantity} × {formatMoney(h.unitPriceMinor, currency)}</span>
                    {autoPriceOn(h) && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-positive"
                        title="Price tracked live from Yahoo Finance"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                        LIVE
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <Money minor={h.valueMinor} className="font-semibold tabular-nums" />
                  <div><Gain minor={h.gainMinor} pct={h.gainPct} /></div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Editor */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit holding' : 'Add holding'}
        footer={
          <>
            {draft?.id && (
              <Button variant="ghost" className="mr-auto text-negative" onClick={remove}>
                <IconTrash width={18} /> Delete
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save}>{draft?.id ? 'Save' : 'Add'}</Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Name" className="col-span-2">
                <Input
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value, nameAuto: false })}
                  placeholder="e.g. Apple"
                  maxLength={40}
                />
              </Field>
              <Field label="Symbol" hint="Used for live prices">
                <Input value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} placeholder="AAPL" maxLength={12} />
              </Field>
            </div>
            <div className={draft.type === 'crypto' ? '' : 'grid grid-cols-2 gap-3'}>
              <Field label="Type">
                <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as HoldingType })}>
                  {(Object.keys(TYPE_LABELS) as HoldingType[]).map((t) => (
                    <option key={t} value={t}>{TYPE_ICON[t]} {TYPE_LABELS[t]}</option>
                  ))}
                </Select>
              </Field>
              {draft.type !== 'crypto' && (
                <Field label="Exchange" hint="For live prices, e.g. ASX">
                  <Input value={draft.exchange} onChange={(e) => setDraft({ ...draft, exchange: e.target.value })} placeholder="ASX, NASDAQ…" maxLength={12} />
                </Field>
              )}
            </div>
            <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none rounded-xl border border-border p-3">
              <input
                type="checkbox"
                checked={draft.auto}
                onChange={(e) => setDraft({ ...draft, auto: e.target.checked })}
                className="h-4 w-4 mt-0.5 accent-accent shrink-0"
              />
              <span>
                <span className="font-medium">Track price from Yahoo Finance</span>
                <span className="block text-xs text-muted mt-0.5">
                  Looks the current price up from the ticker above and keeps it updated on every refresh,
                  converting into {currency} when the market trades in another currency. Turn off to type
                  the price yourself.
                </span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <Input value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} inputMode="decimal" placeholder="0" />
              </Field>
              <Field
                label={draft.auto ? 'Live price (each)' : 'Current price (each)'}
                error={draft.auto && priceState.kind === 'error' ? priceState.message : undefined}
                hint={
                  draft.auto
                    ? priceState.kind === 'loading'
                      ? 'Fetching latest price…'
                      : priceState.kind === 'ok'
                        ? priceState.label
                        : 'Enter a ticker symbol above'
                    : undefined
                }
              >
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{currencySymbol(currency)}</span>
                  <Input
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`pl-8 ${draft.auto ? 'pr-9 text-muted' : ''}`}
                    readOnly={draft.auto}
                    aria-busy={draft.auto && priceState.kind === 'loading'}
                  />
                  {draft.auto && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                      {priceState.kind === 'loading' ? (
                        <IconRefresh width={15} className="animate-spin" />
                      ) : priceState.kind === 'error' ? (
                        <IconWarning width={15} className="text-negative" />
                      ) : null}
                    </span>
                  )}
                </div>
              </Field>
            </div>
            <Field label="Buy price / share (optional)" hint="What you paid per share — compared to the live price for profit/loss.">
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{currencySymbol(currency)}</span>
                <Input value={draft.buyPrice} onChange={(e) => setDraft({ ...draft, buyPrice: e.target.value })} inputMode="decimal" placeholder="0.00" className="pl-8" />
              </div>
            </Field>

            <div className="rounded-xl bg-elevated/60 border border-border p-3.5 space-y-2 text-sm">
              {draftBuy != null && (
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>Per share</span>
                  <span className="tabular-nums">
                    {formatMoney(draftBuy, currency)} <span className="text-faint">→</span> {formatMoney(draftPrice, currency)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted">Current value</span>
                <span className="text-right">
                  <Money minor={draftValue} className="font-semibold" />
                  {draftGain != null && <div><Gain minor={draftGain} pct={gainPct(draftValue, draftCost)} /></div>}
                </span>
              </div>
            </div>

            <Field label="Note (optional)">
              <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="e.g. Long-term hold" maxLength={80} />
            </Field>
          </div>
        )}
      </Modal>
    </section>
  )
}

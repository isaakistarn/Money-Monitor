import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Field'
import { useConfirm } from '@/components/ui/Confirm'
import { IconPlus, IconTrash, IconChart, IconRefresh } from '@/components/ui/icons'
import { useHoldings } from '@/hooks/useData'
import { useCurrency } from '@/state/settings'
import { useUI } from '@/state/ui'
import { addHolding, updateHolding, deleteHolding } from '@/db/repo'
import { refreshHoldingPrices } from '@/db/prices'
import { getMeta } from '@/db/meta'
import { parseMoney, minorToInput, currencySymbol, formatMoney } from '@/lib/money'
import { holdingValueMinor, holdingGainMinor, gainPct } from '@/lib/portfolio'
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
  type: HoldingType
  quantity: string
  price: string
  cost: string
  note: string
}

function emptyDraft(): Draft {
  return { name: '', symbol: '', type: 'stock', quantity: '', price: '', cost: '', note: '' }
}

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
  const [refreshing, setRefreshing] = useState(false)
  const pricesUpdatedAt = useLiveQuery(() => getMeta<string | null>('pricesUpdatedAt', null), [], null)

  const list = holdings ?? []
  const withSymbols = list.filter((h) => h.symbol)

  const refreshPrices = async () => {
    const apikey = await getMeta<string>('alphaVantageKey', '')
    if (!apikey) return toast('Add your Alpha Vantage key in Settings → Live prices.', 'error')
    if (withSymbols.length === 0) return toast('Add ticker symbols to your holdings first.', 'error')
    const quoteCurrency = await getMeta<string>('quoteCurrency', 'USD')
    setRefreshing(true)
    try {
      const res = await refreshHoldingPrices(withSymbols, { apikey, quoteCurrency, appCurrency: currency })
      if (res.updated > 0) {
        toast(
          `Updated ${res.updated} price${res.updated === 1 ? '' : 's'}` +
            (res.failed.length ? ` · ${res.failed.length} failed` : ''),
          res.failed.length ? 'error' : 'success',
        )
      } else {
        toast(res.rateLimited ? res.failed[0]?.error ?? 'Rate limit reached.' : res.failed[0]?.error ?? 'No prices updated.', 'error')
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setRefreshing(false)
    }
  }
  const totalValue = list.reduce((s, h) => s + h.valueMinor, 0)
  const hasCost = list.some((h) => h.gainMinor != null)
  const totalGain = list.reduce((s, h) => s + (h.gainMinor ?? 0), 0)
  const totalCost = list.reduce((s, h) => s + (h.costBasisMinor ?? 0), 0)
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : undefined

  const open = (h?: (typeof list)[number]) =>
    setDraft(
      h
        ? {
            id: h.id, name: h.name, symbol: h.symbol ?? '', type: h.type,
            quantity: String(h.quantity), price: minorToInput(h.unitPriceMinor, currency),
            cost: h.costBasisMinor != null ? minorToInput(h.costBasisMinor, currency) : '', note: h.note ?? '',
          }
        : emptyDraft(),
    )

  // Live preview of the holding currently being edited.
  const draftValue = draft ? holdingValueMinor(Number(draft.quantity) || 0, parseMoney(draft.price, currency) || 0) : 0
  const draftCost = draft && draft.cost.trim() ? parseMoney(draft.cost, currency) : undefined
  const draftGain = holdingGainMinor(draftValue, draftCost)

  const save = async () => {
    if (!draft || !draft.name.trim()) return toast('Give the holding a name.', 'error')
    const quantity = Number(draft.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) return toast('Enter a valid quantity.', 'error')
    const unitPriceMinor = parseMoney(draft.price, currency)
    if (!Number.isFinite(unitPriceMinor) || unitPriceMinor < 0) return toast('Enter a valid price.', 'error')
    const costBasisMinor = draft.cost.trim() ? parseMoney(draft.cost, currency) : undefined
    const payload = {
      name: draft.name.trim(),
      symbol: draft.symbol.trim().toUpperCase() || undefined,
      type: draft.type,
      quantity,
      unitPriceMinor,
      costBasisMinor: costBasisMinor != null && Number.isFinite(costBasisMinor) ? costBasisMinor : undefined,
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
            {withSymbols.length > 0 && (
              <Button size="sm" variant="secondary" onClick={refreshPrices} disabled={refreshing}>
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
              Track stocks, funds, crypto, and commodities here. Add a holding with its quantity and current
              price — it counts toward your Net Worth (prices are updated manually).
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
                  <p className="text-xs text-faint">
                    {h.quantity} × {formatMoney(h.unitPriceMinor, currency)}
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
                <Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Apple" maxLength={40} />
              </Field>
              <Field label="Symbol">
                <Input value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} placeholder="AAPL" maxLength={12} />
              </Field>
            </div>
            <Field label="Type">
              <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as HoldingType })}>
                {(Object.keys(TYPE_LABELS) as HoldingType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_ICON[t]} {TYPE_LABELS[t]}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <Input value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} inputMode="decimal" placeholder="0" />
              </Field>
              <Field label="Current price (each)">
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{currencySymbol(currency)}</span>
                  <Input value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} inputMode="decimal" placeholder="0.00" className="pl-8" />
                </div>
              </Field>
            </div>
            <Field label="Total invested (optional)" hint="Used to show gain/loss.">
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{currencySymbol(currency)}</span>
                <Input value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} inputMode="decimal" placeholder="0.00" className="pl-8" />
              </div>
            </Field>

            <div className="rounded-xl bg-elevated/60 border border-border p-3.5 flex items-center justify-between text-sm">
              <span className="text-muted">Current value</span>
              <span className="text-right">
                <Money minor={draftValue} className="font-semibold" />
                {draftGain != null && <div><Gain minor={draftGain} pct={gainPct(draftValue, draftCost)} /></div>}
              </span>
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

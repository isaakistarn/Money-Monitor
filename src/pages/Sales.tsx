import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { MonthNav } from '@/components/MonthNav'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/Confirm'
import { IconPlus, IconTrash, IconChart, IconWallet } from '@/components/ui/icons'
import { DoughnutChart, MultiBarChart, AreaLineChart } from '@/components/charts'
import { CHART_PALETTE, INCOME_PALETTE, INCOME_COLOR, EXPENSE_COLOR } from '@/components/charts/chartSetup'
import { useSales, useSalesOverview, useSalesDailyTrend, useSalesNames } from '@/hooks/useData'
import { addSale, updateSale, deleteSale } from '@/db/repo'
import { useCurrency } from '@/state/settings'
import { useUI } from '@/state/ui'
import { parseMoney, minorToInput, currencySymbol, formatMoney } from '@/lib/money'
import { salesByBuyer, salesByReferral, referralPayouts, netMinorOf, salesTotals, type SalesSlice } from '@/lib/sales'
import { currentYm, todayISO, ymLabel, dayLabel, relativeDateLabel } from '@/lib/date'
import type { Sale } from '@/types/models'

/** Compact segmented toggle for the chart ranges (mirrors Analytics). */
function Segmented<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="inline-flex gap-1 text-xs">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`px-2.5 h-7 rounded-lg font-medium transition-colors ${
            value === o.value ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <div className="text-lg md:text-xl font-bold mt-0.5">{children}</div>
      {hint && <p className="text-[11px] text-faint mt-0.5">{hint}</p>}
    </Card>
  )
}

/** A labelled colour swatch list, pairing with a doughnut. */
function SliceLegend({
  slices,
  palette,
  currency,
}: {
  slices: SalesSlice[]
  palette: string[]
  currency: string
}) {
  return (
    <div className="space-y-2">
      {slices.map((s, i) => (
        <div key={s.name} className="flex items-center gap-2.5 text-sm">
          <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: palette[i % palette.length] }} />
          <span className="flex-1 truncate">{s.name}</span>
          <span className="text-faint text-xs">{s.pct.toFixed(0)}%</span>
          <span className="font-medium tabular-nums w-20 text-right">{formatMoney(s.amountMinor, currency)}</span>
        </div>
      ))}
    </div>
  )
}

interface Draft {
  id?: string
  buyer: string
  amount: string
  referral: string
  referralAmount: string
  date: string
  note: string
}

function emptyDraft(ym: string): Draft {
  // Adding while browsing a past month should land in that month, not today.
  return {
    buyer: '',
    amount: '',
    referral: '',
    referralAmount: '',
    date: ym === currentYm() ? todayISO() : `${ym}-01`,
    note: '',
  }
}

function toDraft(s: Sale, currency: string): Draft {
  return {
    id: s.id,
    buyer: s.buyer,
    amount: minorToInput(s.amountMinor, currency),
    referral: s.referral ?? '',
    referralAmount: s.referralAmountMinor != null ? minorToInput(s.referralAmountMinor, currency) : '',
    date: s.date,
    note: s.note ?? '',
  }
}

export function Sales() {
  const currency = useCurrency()
  const confirm = useConfirm()
  const { toast } = useUI()

  const [ym, setYm] = useState(currentYm())
  const [monthsN, setMonthsN] = useState(12)
  const [dayN, setDayN] = useState(30)
  const [draft, setDraft] = useState<Draft | null>(null)

  const monthSales = useSales(ym)
  const overview = useSalesOverview(ym, monthsN)
  const daily = useSalesDailyTrend(dayN)
  const names = useSalesNames()

  const rows = useMemo(() => monthSales ?? [], [monthSales])
  const month = overview?.month ?? salesTotals([])
  const allTime = overview?.allTime ?? salesTotals([])

  // Breakdowns are scoped to the month on screen, so they move with the stepper.
  const byBuyer = useMemo(() => salesByBuyer(rows), [rows])
  const byReferral = useMemo(() => salesByReferral(rows), [rows])
  const payouts = useMemo(() => referralPayouts(rows), [rows])

  const monthly = overview?.monthly ?? []
  const hasMonthly = monthly.some((m) => m.count > 0)
  const hasDaily = (daily ?? []).some((d) => d.count > 0)

  const save = async () => {
    if (!draft) return
    const buyer = draft.buyer.trim()
    if (!buyer) return toast('Enter the buyer.', 'error')
    const amountMinor = parseMoney(draft.amount, currency)
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) return toast('Enter a valid amount.', 'error')
    if (!draft.date) return toast('Pick a date for the sale.', 'error')

    const referral = draft.referral.trim()
    let referralAmountMinor: number | undefined
    if (referral && draft.referralAmount.trim()) {
      referralAmountMinor = parseMoney(draft.referralAmount, currency)
      if (!Number.isFinite(referralAmountMinor) || referralAmountMinor < 0)
        return toast('Enter a valid referral amount.', 'error')
      if (referralAmountMinor > amountMinor)
        return toast('The referral payout is more than the sale itself.', 'error')
    }

    const payload = {
      buyer,
      amountMinor,
      referral: referral || undefined,
      referralAmountMinor,
      date: draft.date,
      note: draft.note.trim() || undefined,
    }
    if (draft.id) await updateSale(draft.id, payload)
    else await addSale(payload)
    // Follow the sale to whichever month it landed in.
    setYm(draft.date.slice(0, 7))
    setDraft(null)
    toast(draft.id ? 'Sale updated' : 'Sale recorded', 'success')
  }

  const remove = async () => {
    if (!draft?.id) return
    const ok = await confirm({
      title: 'Delete this sale?',
      message: `The sale to ${draft.buyer || 'this buyer'} is removed from your totals and charts.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    await deleteSale(draft.id)
    setDraft(null)
    toast('Sale deleted')
  }

  // Live preview of what the sale nets after the referral payout.
  const draftAmount = draft ? parseMoney(draft.amount, currency) : NaN
  const draftPayout =
    draft && draft.referral.trim() && draft.referralAmount.trim()
      ? parseMoney(draft.referralAmount, currency)
      : 0
  const draftNet = Number.isFinite(draftAmount)
    ? draftAmount - (Number.isFinite(draftPayout) ? draftPayout : 0)
    : 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales"
        subtitle="Product sales, referrals, and what you kept"
        action={
          <Button onClick={() => setDraft(emptyDraft(ym))}>
            <IconPlus width={18} /> Record sale
          </Button>
        }
      />

      {/* All-time headline */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Stat label="Total revenue" hint={`${allTime.count} sale${allTime.count === 1 ? '' : 's'} all time`}>
          <Money minor={allTime.grossMinor} />
        </Stat>
        <Stat label="Net after referrals" hint={`${formatMoney(allTime.referralMinor, currency)} paid out`}>
          <Money minor={allTime.netMinor} />
        </Stat>
        <Stat label="Average sale">
          <Money minor={allTime.avgMinor} />
        </Stat>
        <Stat
          label="Referred sales"
          hint={allTime.count ? `${Math.round((allTime.referredCount / allTime.count) * 100)}% of all sales` : undefined}
        >
          <span className="tabular-nums">{allTime.referredCount}</span>
        </Stat>
      </div>

      {/* The month on screen */}
      <Card className="p-5">
        <SectionHeader title="Month" action={<MonthNav ym={ym} onChange={setYm} />} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted">Revenue</p>
            <p className="text-lg font-bold mt-0.5"><Money minor={month.grossMinor} /></p>
          </div>
          <div>
            <p className="text-xs text-muted">Referrals paid</p>
            <p className="text-lg font-bold mt-0.5 text-negative tabular-nums">
              {formatMoney(month.referralMinor, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Net kept</p>
            <p className="text-lg font-bold mt-0.5 text-positive tabular-nums">
              {formatMoney(month.netMinor, currency)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Sales</p>
            <p className="text-lg font-bold mt-0.5 tabular-nums">{month.count}</p>
          </div>
        </div>
      </Card>

      {/* Revenue by month (stacked: net + payouts = gross) */}
      <Card className="p-5">
        <SectionHeader
          title="Revenue by Month"
          action={
            <Segmented
              value={monthsN}
              onChange={setMonthsN}
              options={[
                { value: 6, label: '6m' },
                { value: 12, label: '12m' },
                { value: 24, label: '24m' },
              ]}
            />
          }
        />
        {!hasMonthly ? (
          <EmptyState
            icon={<IconChart width={30} />}
            title="No sales recorded yet"
            message="Record a sale and your revenue builds up here month by month."
          />
        ) : (
          <>
            <div className="h-56">
              <MultiBarChart
                labels={monthly.map((m) => ymLabel(m.key).split(' ')[0])}
                series={[
                  { label: 'Net kept', values: monthly.map((m) => m.netMinor), color: INCOME_COLOR },
                  { label: 'Referrals paid', values: monthly.map((m) => m.referralMinor), color: EXPENSE_COLOR },
                ]}
                currency={currency}
                stacked
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-positive" /> Net kept</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-negative" /> Referrals paid</span>
              <span className="text-faint">Stacked, so each bar is that month&rsquo;s total revenue.</span>
            </div>
          </>
        )}
      </Card>

      {/* Daily revenue */}
      <Card className="p-5">
        <SectionHeader
          title="Revenue Over Time"
          action={
            <Segmented
              value={dayN}
              onChange={setDayN}
              options={[
                { value: 14, label: '14d' },
                { value: 30, label: '30d' },
                { value: 90, label: '90d' },
              ]}
            />
          }
        />
        {!hasDaily ? (
          <EmptyState icon={<IconChart width={30} />} title="No sales in this window" />
        ) : (
          <div className="h-56">
            <AreaLineChart
              labels={(daily ?? []).map((d) => dayLabel(d.key))}
              values={(daily ?? []).map((d) => d.grossMinor)}
              currency={currency}
              color="#60a5fa"
            />
          </div>
        )}
      </Card>

      {/* Buyers & referral sources for the selected month */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <SectionHeader title={`Top Buyers · ${ymLabel(ym)}`} />
          {byBuyer.length === 0 ? (
            <EmptyState icon={<IconChart width={30} />} title="No sales this month" />
          ) : (
            <div className="grid sm:grid-cols-2 gap-6 items-center">
              <div className="relative h-52">
                <DoughnutChart
                  labels={byBuyer.map((b) => b.name)}
                  values={byBuyer.map((b) => b.amountMinor)}
                  currency={currency}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xs text-muted">Revenue</span>
                  <Money minor={month.grossMinor} className="text-base font-bold" />
                </div>
              </div>
              <SliceLegend slices={byBuyer} palette={CHART_PALETTE} currency={currency} />
            </div>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeader title={`Revenue by Referral · ${ymLabel(ym)}`} />
          {byReferral.length === 0 ? (
            <EmptyState icon={<IconChart width={30} />} title="No sales this month" />
          ) : (
            <div className="grid sm:grid-cols-2 gap-6 items-center">
              <div className="relative h-52">
                <DoughnutChart
                  labels={byReferral.map((r) => r.name)}
                  values={byReferral.map((r) => r.amountMinor)}
                  currency={currency}
                  palette={INCOME_PALETTE}
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xs text-muted">Sources</span>
                  <span className="text-base font-bold tabular-nums">{byReferral.length}</span>
                </div>
              </div>
              <SliceLegend slices={byReferral} palette={INCOME_PALETTE} currency={currency} />
            </div>
          )}
        </Card>
      </div>

      {/* What each referrer was actually paid */}
      {payouts.length > 0 && (
        <Card className="p-5">
          <SectionHeader title={`Referral Payouts · ${ymLabel(ym)}`} />
          <div className="space-y-2">
            {payouts.map((r) => (
              <div key={r.name} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate font-medium">{r.name}</span>
                <span className="text-xs text-faint">
                  {r.count} sale{r.count === 1 ? '' : 's'}
                </span>
                <span className="tabular-nums font-medium w-24 text-right">
                  {formatMoney(r.amountMinor, currency)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* The month's sales */}
      <section>
        <SectionHeader title={`Sales · ${ymLabel(ym)}`} action={<MonthNav ym={ym} onChange={setYm} />} />
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconWallet width={30} />}
              title="No sales this month"
              message="Record a sale to start tracking revenue, buyers, and referral payouts."
              action={
                <Button onClick={() => setDraft(emptyDraft(ym))}>
                  <IconPlus width={18} /> Record sale
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-2.5">
            {rows.map((s) => (
              <Card
                key={s.id}
                className="p-4 flex items-center gap-3 cursor-pointer hover:border-accent/40 transition-colors"
                onClick={() => setDraft(toDraft(s, currency))}
              >
                <span className="grid place-items-center h-10 w-10 rounded-full bg-elevated text-sm font-semibold shrink-0">
                  {s.buyer.trim().charAt(0).toUpperCase() || '?'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{s.buyer}</p>
                  <p className="text-xs text-faint truncate">
                    {relativeDateLabel(s.date)}
                    {s.referral && <> · via {s.referral}</>}
                    {s.note && <> · {s.note}</>}
                  </p>
                </div>
                <div className="text-right">
                  <Money minor={s.amountMinor} className="font-semibold" />
                  {s.referralAmountMinor ? (
                    <p className="text-xs text-muted tabular-nums">net {formatMoney(netMinorOf(s), currency)}</p>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Editor */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit sale' : 'Record sale'}
        footer={
          <>
            {draft?.id && (
              <Button variant="ghost" className="mr-auto text-negative" onClick={remove}>
                <IconTrash width={18} /> Delete
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save}>{draft?.id ? 'Save' : 'Record'}</Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            {/* Reusing a past buyer/referrer keeps the grouped reports from
                splitting one person across two spellings. */}
            <datalist id="sales-buyers">
              {(names?.buyers ?? []).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <datalist id="sales-referrals">
              {(names?.referrals ?? []).map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Buyer">
                <Input
                  autoFocus
                  list="sales-buyers"
                  value={draft.buyer}
                  onChange={(e) => setDraft({ ...draft, buyer: e.target.value })}
                  placeholder="e.g. Jordan Blake"
                  maxLength={60}
                />
              </Field>
              <Field label="Amount">
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                    {currencySymbol(currency)}
                  </span>
                  <Input
                    value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="pl-8"
                  />
                </div>
              </Field>
            </div>

            <Field label="Date">
              <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Referral (optional)" hint="Who sent this buyer your way">
                <Input
                  list="sales-referrals"
                  value={draft.referral}
                  onChange={(e) => setDraft({ ...draft, referral: e.target.value })}
                  placeholder="Blank if direct"
                  maxLength={60}
                />
              </Field>
              <Field
                label="Referral amount"
                hint={draft.referral.trim() ? 'Paid to the referrer' : 'Add a referral first'}
              >
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                    {currencySymbol(currency)}
                  </span>
                  <Input
                    value={draft.referralAmount}
                    onChange={(e) => setDraft({ ...draft, referralAmount: e.target.value })}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="pl-8"
                    disabled={!draft.referral.trim()}
                  />
                </div>
              </Field>
            </div>

            <div className="rounded-xl bg-elevated/60 border border-border p-3.5 flex items-center justify-between text-sm">
              <span className="text-muted">You keep</span>
              <span className="font-semibold tabular-nums">{formatMoney(draftNet, currency)}</span>
            </div>

            <Field label="Note (optional)">
              <Input
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="e.g. Bundle deal"
                maxLength={80}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

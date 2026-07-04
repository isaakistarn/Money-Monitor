import { useEffect, useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { EmptyState } from '@/components/ui/EmptyState'
import { MonthNav } from '@/components/MonthNav'
import { Select } from '@/components/ui/Field'
import { DoughnutChart, TrendLineChart, ComparisonBarChart, AreaLineChart } from '@/components/charts'
import { IconChart } from '@/components/ui/icons'
import {
  useCategorySpend,
  useMonthlyTrend,
  useDailyTrend,
  useWeeklyTrend,
  useAccountBalanceHistory,
  usePortfolioHistory,
  useAccounts,
} from '@/hooks/useData'
import { useCurrency } from '@/state/settings'
import { ymLabel, dayLabel, currentYm } from '@/lib/date'
import { CHART_PALETTE } from '@/components/charts/chartSetup'

/** A compact segmented button group used for the chart toggles. */
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

export function Analytics() {
  const currency = useCurrency()

  // Spending-by-category (pie) is browsed month-by-month.
  const [ym, setYm] = useState(currentYm())
  const spend = useCategorySpend(ym)
  const spendTotal = (spend ?? []).reduce((s, c) => s + c.spentMinor, 0)

  // Shared time-series (queried at the widest range, then sliced per view).
  const daily = useDailyTrend(90)
  const weekly = useWeeklyTrend(12)
  const monthly = useMonthlyTrend(12)

  // Income & expenses over time — switch between daily and monthly buckets.
  const [trendMode, setTrendMode] = useState<'day' | 'month'>('day')
  const [dayN, setDayN] = useState(30)
  const [monthN, setMonthN] = useState(6)
  const trendRows =
    trendMode === 'day' ? (daily ?? []).slice(-dayN) : (monthly ?? []).slice(-monthN)
  const trendLabels =
    trendMode === 'day'
      ? trendRows.map((r) => dayLabel((r as { date: string }).date))
      : trendRows.map((r) => ymLabel((r as { ym: string }).ym).split(' ')[0])
  const hasTrend = trendRows.some((t) => t.incomeMinor || t.expenseMinor)

  // Spending comparison (bars) — daily / weekly / monthly.
  const [cmpMode, setCmpMode] = useState<'day' | 'week' | 'month'>('week')
  const cmpRows =
    cmpMode === 'day'
      ? (daily ?? []).slice(-14)
      : cmpMode === 'week'
        ? (weekly ?? []).slice(-8)
        : (monthly ?? []).slice(-6)
  const cmpLabels = cmpRows.map((r) => {
    if (cmpMode === 'day') return dayLabel((r as { date: string }).date)
    if (cmpMode === 'week') return dayLabel((r as { weekStart: string }).weekStart)
    return ymLabel((r as { ym: string }).ym).split(' ')[0]
  })
  const hasCmp = cmpRows.some((r) => r.expenseMinor)

  // Account balance over time.
  const accounts = useAccounts()
  const [accountId, setAccountId] = useState<string>('')
  const [balN, setBalN] = useState(30)
  useEffect(() => {
    const live = (accounts ?? []).filter((a) => !a.archived)
    if (live.length && !live.some((a) => a.id === accountId)) setAccountId(live[0].id)
  }, [accounts, accountId])
  const balHistory = useAccountBalanceHistory(accountId || undefined, balN)

  // Portfolio value over time (device-local daily snapshots).
  const [pfN, setPfN] = useState(90)
  const pfHistory = usePortfolioHistory(pfN)
  const hasPortfolio = (pfHistory ?? []).length >= 2

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>

      {/* Spending by category (pie) */}
      <Card className="p-5">
        <SectionHeader title="Spending by Category" action={<MonthNav ym={ym} onChange={setYm} />} />
        {spend && spend.length === 0 ? (
          <EmptyState icon={<IconChart width={30} />} title="No spending this month" />
        ) : (
          <div className="grid sm:grid-cols-2 gap-6 items-center">
            <div className="relative h-60">
              <DoughnutChart
                labels={(spend ?? []).map((c) => c.name)}
                values={(spend ?? []).map((c) => c.spentMinor)}
                currency={currency}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xs text-muted">Total</span>
                <Money minor={spendTotal} className="text-lg font-bold" />
              </div>
            </div>
            <div className="space-y-2">
              {(spend ?? []).map((c, i) => (
                <div key={c.categoryId} className="flex items-center gap-2.5 text-sm">
                  <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-faint text-xs">{c.pct.toFixed(0)}%</span>
                  <Money minor={c.spentMinor} className="font-medium tabular-nums w-20 text-right" />
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Income & expenses over time (line) */}
      <Card className="p-5">
        <SectionHeader
          title="Income & Expenses Over Time"
          action={
            <div className="flex items-center gap-2">
              <Segmented
                value={trendMode}
                onChange={setTrendMode}
                options={[
                  { value: 'day', label: 'Day' },
                  { value: 'month', label: 'Month' },
                ]}
              />
              {trendMode === 'day' ? (
                <Segmented
                  value={dayN}
                  onChange={setDayN}
                  options={[
                    { value: 14, label: '14d' },
                    { value: 30, label: '30d' },
                    { value: 90, label: '90d' },
                  ]}
                />
              ) : (
                <Segmented
                  value={monthN}
                  onChange={setMonthN}
                  options={[
                    { value: 3, label: '3m' },
                    { value: 6, label: '6m' },
                    { value: 12, label: '12m' },
                  ]}
                />
              )}
            </div>
          }
        />
        {!hasTrend ? (
          <EmptyState icon={<IconChart width={30} />} title="Not enough data yet" />
        ) : (
          <div className="h-64">
            <TrendLineChart
              labels={trendLabels}
              income={trendRows.map((t) => t.incomeMinor)}
              expense={trendRows.map((t) => t.expenseMinor)}
              currency={currency}
            />
          </div>
        )}
        <div className="mt-3 flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-positive" /> Income</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-negative" /> Expenses</span>
        </div>
      </Card>

      {/* Spending comparison (bar) — daily / weekly / monthly */}
      <Card className="p-5">
        <SectionHeader
          title="Spending Comparison"
          action={
            <Segmented
              value={cmpMode}
              onChange={setCmpMode}
              options={[
                { value: 'day', label: 'Daily' },
                { value: 'week', label: 'Weekly' },
                { value: 'month', label: 'Monthly' },
              ]}
            />
          }
        />
        {!hasCmp ? (
          <EmptyState icon={<IconChart width={30} />} title="Not enough data yet" />
        ) : (
          <div className="h-56">
            <ComparisonBarChart
              labels={cmpLabels}
              values={cmpRows.map((r) => r.expenseMinor)}
              currency={currency}
            />
          </div>
        )}
      </Card>

      {/* Account balance over time (line) */}
      <Card className="p-5">
        <SectionHeader
          title="Account Balance Over Time"
          action={
            <Segmented
              value={balN}
              onChange={setBalN}
              options={[
                { value: 30, label: '30d' },
                { value: 90, label: '90d' },
                { value: 365, label: '1y' },
              ]}
            />
          }
        />
        {(accounts ?? []).filter((a) => !a.archived).length === 0 ? (
          <EmptyState icon={<IconChart width={30} />} title="No accounts yet" />
        ) : (
          <>
            <div className="mb-4 max-w-xs">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {(accounts ?? [])
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </div>
            <div className="h-56">
              {balHistory && balHistory.length > 0 && (
                <AreaLineChart
                  labels={balHistory.map((b) => dayLabel(b.date))}
                  values={balHistory.map((b) => b.balanceMinor)}
                  currency={currency}
                  color="#a78bfa"
                />
              )}
            </div>
          </>
        )}
      </Card>

      {/* Portfolio value over time (line) */}
      <Card className="p-5">
        <SectionHeader
          title="Portfolio Value Over Time"
          action={
            <Segmented
              value={pfN}
              onChange={setPfN}
              options={[
                { value: 30, label: '30d' },
                { value: 90, label: '90d' },
                { value: 365, label: '1y' },
              ]}
            />
          }
        />
        {!hasPortfolio ? (
          <EmptyState
            icon={<IconChart width={30} />}
            title="Building your portfolio history"
            message="Add investment holdings and check back — value is recorded daily as prices update."
          />
        ) : (
          <div className="h-56">
            <AreaLineChart
              labels={(pfHistory ?? []).map((p) => dayLabel(p.date))}
              values={(pfHistory ?? []).map((p) => p.valueMinor)}
              currency={currency}
              color="#34d399"
            />
          </div>
        )}
      </Card>
    </div>
  )
}

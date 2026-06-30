import { useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { EmptyState } from '@/components/ui/EmptyState'
import { MonthNav } from '@/components/MonthNav'
import { DoughnutChart, TrendLineChart, ComparisonBarChart } from '@/components/charts'
import { IconChart } from '@/components/ui/icons'
import { useCategorySpend, useMonthlyTrend } from '@/hooks/useData'
import { useCurrency } from '@/state/settings'
import { ymLabel, currentYm } from '@/lib/date'
import { CHART_PALETTE } from '@/components/charts/chartSetup'

export function Analytics() {
  const [ym, setYm] = useState(currentYm())
  const [range, setRange] = useState(6)
  const spend = useCategorySpend(ym)
  const trend = useMonthlyTrend(range)
  const currency = useCurrency()

  const spendTotal = (spend ?? []).reduce((s, c) => s + c.spentMinor, 0)
  const hasTrend = (trend ?? []).some((t) => t.incomeMinor || t.expenseMinor)

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
            <div className="inline-flex gap-1 text-xs">
              {[3, 6, 12].map((n) => (
                <button
                  key={n}
                  onClick={() => setRange(n)}
                  className={`px-2.5 h-7 rounded-lg font-medium transition-colors ${range === n ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'}`}
                >
                  {n}m
                </button>
              ))}
            </div>
          }
        />
        {!hasTrend ? (
          <EmptyState icon={<IconChart width={30} />} title="Not enough data yet" />
        ) : (
          <div className="h-64">
            <TrendLineChart
              labels={(trend ?? []).map((t) => ymLabel(t.ym).split(' ')[0])}
              income={(trend ?? []).map((t) => t.incomeMinor)}
              expense={(trend ?? []).map((t) => t.expenseMinor)}
              currency={currency}
            />
          </div>
        )}
      </Card>

      {/* Monthly spending comparison (bar) */}
      <Card className="p-5">
        <SectionHeader title="Monthly Spending Comparison" />
        {!hasTrend ? (
          <EmptyState icon={<IconChart width={30} />} title="Not enough data yet" />
        ) : (
          <div className="h-56">
            <ComparisonBarChart
              labels={(trend ?? []).map((t) => ymLabel(t.ym).split(' ')[0])}
              values={(trend ?? []).map((t) => t.expenseMinor)}
              currency={currency}
            />
          </div>
        )}
      </Card>
    </div>
  )
}

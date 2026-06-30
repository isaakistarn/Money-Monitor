import { useNavigate } from 'react-router-dom'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { TransactionRow } from '@/components/transactions/TransactionRow'
import { TrendLineChart } from '@/components/charts'
import { IconPlus, IconList } from '@/components/ui/icons'
import {
  useBalanceTotals,
  useMonthlyStat,
  useCategorySpend,
  useMonthlyTrend,
  useRecentTransactions,
} from '@/hooks/useData'
import { useRowMeta } from '@/hooks/useRowMeta'
import { useUI } from '@/state/ui'
import { useCurrency } from '@/state/settings'
import { ymLabel, currentYm } from '@/lib/date'
import { CHART_PALETTE } from '@/components/charts/chartSetup'

function SummaryCard({
  label,
  minor,
  tone,
}: {
  label: string
  minor: number | undefined
  tone?: 'positive' | 'negative'
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted">{label}</p>
      {minor === undefined ? (
        <div className="h-7 mt-1.5 w-24 bg-border/60 rounded animate-pulse" />
      ) : (
        <p className="text-xl md:text-2xl font-bold mt-1 tabular-nums">
          <Money
            minor={minor}
            className={tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : ''}
          />
        </p>
      )}
    </Card>
  )
}

export function Dashboard() {
  const totals = useBalanceTotals()
  const month = useMonthlyStat()
  const spend = useCategorySpend()
  const trend = useMonthlyTrend(6)
  const recent = useRecentTransactions(10)
  const rowMeta = useRowMeta()
  const { openEditor } = useUI()
  const navigate = useNavigate()
  const currency = useCurrency()

  const topSpend = (spend ?? []).slice(0, 5)

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted mt-0.5">{ymLabel(currentYm())}</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Net Worth" minor={totals?.netWorthMinor} />
        <SummaryCard label="Spendable Cash" minor={totals?.spendableCashMinor} />
        <SummaryCard label="Income this month" minor={month?.incomeMinor} tone="positive" />
        <SummaryCard label="Expenses this month" minor={month?.expenseMinor} tone="negative" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Monthly trend */}
        <Card className="p-5">
          <SectionHeader title="Income vs Expenses" />
          <div className="h-56">
            {trend && (
              <TrendLineChart
                labels={trend.map((t) => ymLabel(t.ym).split(' ')[0])}
                income={trend.map((t) => t.incomeMinor)}
                expense={trend.map((t) => t.expenseMinor)}
                currency={currency}
              />
            )}
          </div>
          <div className="flex items-center gap-5 mt-3 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" /> Income</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#fb7185]" /> Expenses</span>
            <span className="ml-auto">
              Saved: <Money minor={month?.savingsMinor ?? 0} className="font-semibold text-fg" />
            </span>
          </div>
        </Card>

        {/* Spending breakdown */}
        <Card className="p-5">
          <SectionHeader title="Top Spending" action={
            <button onClick={() => navigate('/analytics')} className="text-xs text-accent font-medium">Details</button>
          } />
          {topSpend.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">No spending recorded this month.</p>
          ) : (
            <div className="space-y-3.5">
              {topSpend.map((c, i) => (
                <div key={c.categoryId}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="flex items-center gap-2">
                      <span>{c.icon}</span>
                      <span className="font-medium">{c.name}</span>
                      <span className="text-faint text-xs">{c.pct.toFixed(0)}%</span>
                    </span>
                    <Money minor={c.spentMinor} className="font-medium" />
                  </div>
                  <div className="h-2 rounded-full bg-border/70 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${c.pct}%`, background: CHART_PALETTE[i % CHART_PALETTE.length] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recent transactions */}
      <Card className="p-3 sm:p-4">
        <SectionHeader
          title="Recent Transactions"
          className="px-1"
          action={
            <button onClick={() => navigate('/transactions')} className="text-xs text-accent font-medium">
              View all
            </button>
          }
        />
        {recent && recent.length === 0 ? (
          <EmptyState
            icon={<IconList width={32} />}
            title="No transactions yet"
            message="Add your first transaction to start tracking."
            action={<Button onClick={() => openEditor()}><IconPlus width={18} /> Add transaction</Button>}
          />
        ) : (
          <div className="divide-y divide-border/60">
            {recent?.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} meta={rowMeta(tx)} onClick={() => openEditor(tx)} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

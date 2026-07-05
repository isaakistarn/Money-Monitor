import { useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Money } from '@/components/ui/Money'
import { Button } from '@/components/ui/Button'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { EmptyState } from '@/components/ui/EmptyState'
import { MonthNav, WeekNav } from '@/components/MonthNav'
import { IconTarget, IconPlus } from '@/components/ui/icons'
import { useBudgets, useCategories } from '@/hooks/useData'
import { useCurrency } from '@/state/settings'
import { upsertBudget } from '@/db/repo'
import { parseMoney, minorToInput, currencySymbol } from '@/lib/money'
import { currentYm, currentWeekStart, addDaysISO, addMonthsISO } from '@/lib/date'
import type { BudgetPeriod } from '@/types/models'

export function Budgets() {
  const [period, setPeriod] = useState<BudgetPeriod>('monthly')
  const [ym, setYm] = useState(currentYm())
  const [week, setWeek] = useState(currentWeekStart())
  // The active period key: 'yyyy-mm' (monthly) or Monday week-start (weekly).
  const key = period === 'weekly' ? week : ym
  const budgets = useBudgets(key)
  const categories = useCategories()
  const currency = useCurrency()

  // Previous period, so an empty week/month can start from the last one's limits.
  const prevKey = period === 'weekly' ? addDaysISO(week, -7) : addMonthsISO(ym + '-01', -1).slice(0, 7)
  const prevBudgets = useBudgets(prevKey)

  const [editing, setEditing] = useState<{ categoryId: string; amount: string } | null>(null)

  const periodNoun = period === 'weekly' ? 'week' : 'month'
  const expenseCats = (categories ?? []).filter((c) => c.kind === 'expense')
  const budgetedIds = new Set((budgets ?? []).map((b) => b.categoryId))
  const unbudgeted = expenseCats.filter((c) => !budgetedIds.has(c.id))

  const totalBudget = (budgets ?? []).reduce((s, b) => s + b.amountMinor, 0)
  const totalSpent = (budgets ?? []).reduce((s, b) => s + b.spentMinor, 0)

  const save = async () => {
    if (!editing) return
    const minor = parseMoney(editing.amount, currency)
    await upsertBudget(editing.categoryId, key, Number.isFinite(minor) ? minor : 0)
    setEditing(null)
  }

  const copyPrevious = async () => {
    for (const b of prevBudgets ?? []) await upsertBudget(b.categoryId, key, b.amountMinor)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
        <div className="flex items-center flex-wrap gap-2">
          <div className="w-48">
            <Segmented<BudgetPeriod>
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'weekly', label: 'Weekly' },
              ]}
            />
          </div>
          {period === 'weekly' ? <WeekNav weekStart={week} onChange={setWeek} /> : <MonthNav ym={ym} onChange={setYm} />}
        </div>
      </div>

      {/* Period summary */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs text-muted">Spent of budget</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">
              <Money minor={totalSpent} /> <span className="text-muted text-base font-medium">/ <Money minor={totalBudget} /></span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">Remaining</p>
            <p className="text-lg font-semibold tabular-nums mt-0.5">
              <Money minor={Math.max(0, totalBudget - totalSpent)} className={totalSpent > totalBudget ? 'text-negative' : 'text-positive'} />
            </p>
          </div>
        </div>
        <ProgressBar pct={totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0} />
      </Card>

      {/* Per-category budgets */}
      {budgets && budgets.length === 0 ? (
        <EmptyState
          icon={<IconTarget width={32} />}
          title={`No budgets for this ${periodNoun}`}
          message={`Set a ${period} limit for a category to track your spending against it.`}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {unbudgeted[0] && (
                <Button onClick={() => setEditing({ categoryId: unbudgeted[0].id, amount: '' })}>
                  <IconPlus width={18} /> Add budget
                </Button>
              )}
              {(prevBudgets?.length ?? 0) > 0 && (
                <Button variant="secondary" onClick={copyPrevious}>
                  Copy last {periodNoun}’s budgets
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <div className="space-y-3">
          {budgets?.map((b) => {
            const over = b.spentMinor > b.amountMinor
            return (
              <Card key={b.id} className="p-4 cursor-pointer hover:border-accent/40 transition-colors"
                onClick={() => setEditing({ categoryId: b.categoryId, amount: minorToInput(b.amountMinor, currency) })}>
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-2 font-medium text-sm">
                    <span className="text-base">{b.icon}</span> {b.name}
                  </span>
                  <span className="text-sm tabular-nums">
                    <Money minor={b.spentMinor} className={over ? 'text-negative font-semibold' : ''} />
                    <span className="text-muted"> / <Money minor={b.amountMinor} /></span>
                  </span>
                </div>
                <ProgressBar pct={b.pct} />
                <div className="flex justify-between mt-1.5 text-xs">
                  <span className={over ? 'text-negative font-medium' : 'text-faint'}>
                    {over ? <>Over by <Money minor={b.spentMinor - b.amountMinor} /></> : `${b.pct.toFixed(0)}% used`}
                  </span>
                  {!over && <span className="text-faint"><Money minor={b.remainingMinor} /> left</span>}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {unbudgeted.length > 0 && (budgets?.length ?? 0) > 0 && (
        <Card className="p-4">
          <SectionHeader title="Add a budget" />
          <div className="flex flex-wrap gap-2">
            {unbudgeted.map((c) => (
              <button
                key={c.id}
                onClick={() => setEditing({ categoryId: c.id, amount: '' })}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-border text-sm hover:border-accent hover:text-accent transition-colors"
              >
                <span>{c.icon}</span> {c.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Editor */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Set budget"
        footer={
          <>
            {editing && budgetedIds.has(editing.categoryId) && (
              <Button variant="ghost" className="mr-auto text-negative" onClick={async () => {
                if (editing) await upsertBudget(editing.categoryId, key, 0)
                setEditing(null)
              }}>
                Remove
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field label="Category">
              <Select
                value={editing.categoryId}
                onChange={(e) => setEditing({ ...editing, categoryId: e.target.value })}
              >
                {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              </Select>
            </Field>
            <Field label={period === 'weekly' ? 'Weekly limit' : 'Monthly limit'}>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{currencySymbol(currency)}</span>
                <Input
                  autoFocus
                  value={editing.amount}
                  onChange={(e) => setEditing({ ...editing, amount: e.target.value })}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="pl-8"
                />
              </div>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

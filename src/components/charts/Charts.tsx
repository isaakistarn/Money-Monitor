import { useMemo } from 'react'
import { Doughnut, Line, Bar } from 'react-chartjs-2'
import type { ChartOptions } from 'chart.js'
import { cssVar, CHART_PALETTE, INCOME_COLOR, EXPENSE_COLOR } from './chartSetup'
import { useSettings } from '@/state/settings'
import { formatMoney } from '@/lib/money'

function useThemeTick() {
  // Re-evaluate colors when the resolved theme flips.
  return useSettings().resolvedTheme
}

function moneyTooltip(currency: string): ChartOptions<'line' | 'bar' | 'doughnut'>['plugins'] {
  return {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: { parsed: { y?: number } | number; label?: string }) => {
          const v = typeof ctx.parsed === 'number' ? ctx.parsed : (ctx.parsed.y ?? 0)
          return ` ${formatMoney(v, currency)}`
        },
      },
    },
  } as ChartOptions['plugins']
}

export function DoughnutChart({
  labels,
  values,
  currency,
  palette = CHART_PALETTE,
}: {
  labels: string[]
  values: number[]
  currency: string
  palette?: string[]
}) {
  useThemeTick()
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: labels.map((_, i) => palette[i % palette.length]),
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    }),
    [labels, values, palette],
  )
  const options: ChartOptions<'doughnut'> = {
    cutout: '66%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.label}: ${formatMoney(ctx.parsed, currency)}`,
        },
      },
    },
    maintainAspectRatio: false,
  }
  return <Doughnut data={data} options={options} />
}

export function TrendLineChart({
  labels,
  income,
  expense,
  currency,
}: {
  labels: string[]
  income: number[]
  expense: number[]
  currency: string
}) {
  const theme = useThemeTick()
  const grid = cssVar('--border', 0.6)
  const tickColor = cssVar('--faint', 1)
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: 'Income',
          data: income,
          borderColor: INCOME_COLOR,
          backgroundColor: 'rgba(52,211,153,0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          borderWidth: 2,
        },
        {
          label: 'Expenses',
          data: expense,
          borderColor: EXPENSE_COLOR,
          backgroundColor: 'rgba(251,113,133,0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          borderWidth: 2,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, income, expense, theme],
  )
  const options: ChartOptions<'line'> = {
    plugins: moneyTooltip(currency) as ChartOptions<'line'>['plugins'],
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 11 }, maxTicksLimit: 8, autoSkip: true } },
      y: {
        grid: { color: grid },
        ticks: {
          color: tickColor,
          font: { size: 11 },
          callback: (v) => formatMoney(Number(v), currency, { compact: true }),
        },
      },
    },
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
  }
  return <Line data={data} options={options} />
}

/** A single-series area line — used for balances and portfolio value over time. */
export function AreaLineChart({
  labels,
  values,
  currency,
  color = '#60a5fa',
}: {
  labels: string[]
  values: number[]
  currency: string
  color?: string
}) {
  const theme = useThemeTick()
  const grid = cssVar('--border', 0.6)
  const tickColor = cssVar('--faint', 1)
  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: values,
          borderColor: color,
          backgroundColor: `${color}20`,
          fill: true,
          tension: 0.3,
          pointRadius: values.length > 45 ? 0 : 2,
          borderWidth: 2,
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, values, theme, color],
  )
  const options: ChartOptions<'line'> = {
    plugins: moneyTooltip(currency) as ChartOptions<'line'>['plugins'],
    scales: {
      x: { grid: { display: false }, ticks: { color: tickColor, font: { size: 11 }, maxTicksLimit: 8, autoSkip: true } },
      y: {
        grid: { color: grid },
        ticks: {
          color: tickColor,
          font: { size: 11 },
          callback: (v) => formatMoney(Number(v), currency, { compact: true }),
        },
      },
    },
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
  }
  return <Line data={data} options={options} />
}

export interface BarSeries {
  label: string
  values: number[]
  color: string
}

/**
 * Several bar series on one axis — grouped side-by-side (income vs spending)
 * or stacked (income broken down by source). Unlike the single-series charts
 * the tooltip names the series, since the colour alone no longer says which.
 */
export function MultiBarChart({
  labels,
  series,
  currency,
  stacked = false,
}: {
  labels: string[]
  series: BarSeries[]
  currency: string
  stacked?: boolean
}) {
  const theme = useThemeTick()
  const grid = cssVar('--border', 0.6)
  const tickColor = cssVar('--faint', 1)
  const data = useMemo(
    () => ({
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.values,
        backgroundColor: s.color,
        borderRadius: 4,
        maxBarThickness: 38,
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, series, theme],
  )
  const options: ChartOptions<'bar'> = {
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${formatMoney(ctx.parsed.y ?? 0, currency)}`,
        },
      },
    },
    scales: {
      x: {
        stacked,
        grid: { display: false },
        ticks: { color: tickColor, font: { size: 11 }, maxTicksLimit: 12, autoSkip: true },
      },
      y: {
        stacked,
        grid: { color: grid },
        ticks: {
          color: tickColor,
          font: { size: 11 },
          callback: (v) => formatMoney(Number(v), currency, { compact: true }),
        },
      },
    },
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
  }
  return <Bar data={data} options={options} />
}

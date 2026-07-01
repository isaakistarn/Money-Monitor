import { useMemo } from 'react'
import { Line } from 'react-chartjs-2'
import type { ChartOptions } from 'chart.js'
// Importing chartSetup also runs Chart.js's register() side-effect, so the
// line/point/linear scales exist even when the Reports page hasn't mounted.
import { cssVar } from '@/components/charts/chartSetup'

/** Compact axis label, e.g. "$1.2K" / "€164". */
function axisMoney(v: number, currency: string): string {
  const abs = Math.abs(v)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      notation: abs >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: abs < 1 ? 4 : abs >= 10_000 ? 1 : 2,
      minimumFractionDigits: 0,
    }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

/** Full price for the tooltip, e.g. "$164.62". */
function fullMoney(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: Math.abs(v) < 1 ? 4 : 2,
    }).format(v)
  } catch {
    return `${v.toFixed(2)} ${currency}`
  }
}

function fmtTick(ms: number, intraday: boolean): string {
  const d = new Date(ms)
  return intraday
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtTitle(ms: number, intraday: boolean): string {
  const d = new Date(ms)
  return intraday
    ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * A price-over-time line chart with a money y-axis (right) and a time x-axis.
 * `times` are epoch ms aligned 1:1 with `closes`. `intraday` switches the axis
 * labels between clock times (day/week) and dates (month+).
 */
export function PriceChart({
  closes,
  times,
  currency,
  up,
  intraday,
}: {
  closes: number[]
  times: number[]
  currency: string
  up: boolean
  intraday: boolean
}) {
  const grid = cssVar('--border', 0.5)
  const tickColor = cssVar('--faint', 1)
  const color = up ? '#34d399' : '#fb7185'
  const fill = up ? 'rgba(52,211,153,0.14)' : 'rgba(251,113,133,0.14)'

  const data = useMemo(
    () => ({
      datasets: [
        {
          data: closes.map((y, i) => ({ x: times[i], y })),
          borderColor: color,
          backgroundColor: fill,
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: color,
          borderWidth: 2,
        },
      ],
    }),
    [closes, times, color, fill],
  )

  const options: ChartOptions<'line'> = {
    animation: false,
    parsing: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: (items) => fmtTitle(Number(items[0]?.parsed.x), intraday),
          label: (ctx) => ` ${fullMoney(Number(ctx.parsed.y), currency)}`,
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        grid: { display: false },
        ticks: {
          color: tickColor,
          font: { size: 10 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 5,
          callback: (v) => fmtTick(Number(v), intraday),
        },
      },
      y: {
        position: 'right',
        grid: { color: grid },
        ticks: {
          color: tickColor,
          font: { size: 10 },
          maxTicksLimit: 5,
          callback: (v) => axisMoney(Number(v), currency),
        },
      },
    },
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
  }

  return <Line data={data} options={options} />
}

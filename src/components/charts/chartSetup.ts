import {
  Chart as ChartJS,
  ArcElement,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(
  ArcElement,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
)

/** Read a CSS theme variable (e.g. '--muted') as an rgb() string. */
export function cssVar(name: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return `rgba(120,120,120,${alpha})`
  return `rgba(${raw.split(/\s+/).join(',')}, ${alpha})`
}

/** A palette derived from the accent + a fixed set of distinct hues for categories. */
export const CHART_PALETTE = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa',
  '#fb7185', '#22d3ee', '#facc15', '#4ade80', '#c084fc',
  '#f97316', '#2dd4bf',
]

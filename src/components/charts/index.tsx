import { lazy, Suspense, type ComponentType } from 'react'

/**
 * Chart.js is heavy (~150KB). Loading it lazily keeps it out of the initial
 * bundle so the app shell paints fast; a lightweight skeleton holds the space.
 */
const Charts = () => import('./Charts')

function lazyChart<P extends object>(pick: (m: Awaited<ReturnType<typeof Charts>>) => ComponentType<P>) {
  const C = lazy(() => Charts().then((m) => ({ default: pick(m) }))) as unknown as ComponentType<P>
  return function Wrapped(props: P) {
    return (
      <Suspense fallback={<ChartSkeleton />}>
        <C {...props} />
      </Suspense>
    )
  }
}

function ChartSkeleton() {
  return <div className="h-full w-full rounded-xl bg-border/40 animate-pulse" />
}

export const DoughnutChart = lazyChart((m) => m.DoughnutChart)
export const TrendLineChart = lazyChart((m) => m.TrendLineChart)
export const AreaLineChart = lazyChart((m) => m.AreaLineChart)
export const ComparisonBarChart = lazyChart((m) => m.ComparisonBarChart)

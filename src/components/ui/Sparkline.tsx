import { cn } from '@/lib/cn'

/**
 * Dependency-free SVG sparkline. Stretches to fill its container (set width/
 * height on the parent); the stroke stays crisp via non-scaling-stroke. Colour
 * comes from the parent's text colour (use text-positive / text-negative).
 */
export function Sparkline({ values, className, strokeWidth = 1.5, area = true }: {
  values: number[]
  className?: string
  strokeWidth?: number
  area?: boolean
}) {
  if (!values || values.length < 2) return null
  const W = 100
  const H = 32
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = W / (values.length - 1)
  const pts = values.map((v, i) => `${(i * stepX).toFixed(2)},${(H - ((v - min) / range) * H).toFixed(2)}`)
  const line = `M${pts.join(' L')}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cn('w-full h-full overflow-visible', className)}>
      {area && <path d={`${line} L${W},${H} L0,${H} Z`} fill="currentColor" opacity={0.1} />}
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

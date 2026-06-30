import { cn } from '@/lib/cn'

/** Budget progress: neutral < 90%, amber 90–99%, red ≥ 100%. */
export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, pct))
  const tone =
    pct >= 100 ? 'bg-negative' : pct >= 90 ? 'bg-warning' : 'bg-accent'
  return (
    <div className={cn('h-2 rounded-full bg-border/70 overflow-hidden', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', tone)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

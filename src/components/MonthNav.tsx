import { Button } from '@/components/ui/Button'
import { IconChevron } from '@/components/ui/icons'
import { ymLabel, addMonthsISO } from '@/lib/date'

/** Compact previous/next month stepper. `ym` is 'yyyy-mm'. */
export function MonthNav({ ym, onChange }: { ym: string; onChange: (ym: string) => void }) {
  const shift = (delta: number) => onChange(addMonthsISO(ym + '-01', delta).slice(0, 7))
  return (
    <div className="inline-flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
        <IconChevron className="rotate-180" />
      </Button>
      <span className="text-sm font-semibold w-28 text-center tabular-nums">{ymLabel(ym)}</span>
      <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Next month">
        <IconChevron />
      </Button>
    </div>
  )
}

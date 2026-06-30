import { cn } from '@/lib/cn'

interface Option<T extends string> {
  value: T
  label: string
  icon?: React.ReactNode
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: Option<T>[]
  className?: string
}) {
  return (
    <div className={cn('inline-flex p-1 bg-bg border border-border rounded-xl gap-1 w-full', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-9 px-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

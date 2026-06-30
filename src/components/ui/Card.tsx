import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('bg-surface border border-border rounded-2xl shadow-card', className)}
      {...props}
    />
  )
}

export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between mb-3', className)}>
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{title}</h2>
      {action}
    </div>
  )
}

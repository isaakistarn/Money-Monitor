import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="block text-sm font-medium text-fg mb-1.5">{label}</span>}
      {children}
      {error ? (
        <span className="block text-xs text-negative mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-faint mt-1">{hint}</span>
      ) : null}
    </label>
  )
}

const inputClass =
  'w-full h-11 px-3.5 bg-bg border border-border rounded-xl text-fg placeholder:text-faint ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputClass, className)} {...props} />
  ),
)
Input.displayName = 'Input'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(inputClass, 'appearance-none pr-9 cursor-pointer', className)} {...props}>
      {children}
    </select>
  ),
)
Select.displayName = 'Select'

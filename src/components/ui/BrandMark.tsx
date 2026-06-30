import { useId } from 'react'

/**
 * The app's brand mark: a banknote on a mint→sky gradient tile with a "$"
 * medallion. Used for the in-app logo; the same artwork backs favicon.svg and
 * the generated PWA icons. `useId` keeps the gradient id unique per instance.
 */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} aria-hidden role="img">
      <defs>
        <linearGradient id={`tile-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill={`url(#tile-${id})`} />
      <g transform="rotate(7 256 256)">
        <rect x="116" y="190" width="280" height="150" rx="22" fill="#ffffff" />
        <rect x="132" y="206" width="248" height="118" rx="12" fill="none" stroke="#34d399" strokeWidth="4" opacity="0.5" />
        <circle cx="256" cy="265" r="44" fill="#d1fae5" />
        <circle cx="256" cy="265" r="44" fill="none" stroke="#10b981" strokeWidth="5" />
        <g stroke="#059669" strokeLinecap="round" fill="none">
          <path d="M284 247 C284 233 229 233 229 254 C229 274 283 259 283 281 C283 299 240 299 227 287" strokeWidth="14" />
          <path d="M256 231 V301" strokeWidth="12" />
        </g>
      </g>
    </svg>
  )
}

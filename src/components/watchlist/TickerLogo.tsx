import { useEffect, useState } from 'react'
import { yahooSymbol } from '@/lib/quotes'

/**
 * Circular company logo with a graceful initials fallback. Logos come from
 * Financial Modeling Prep's keyless image endpoint, keyed by the Yahoo-style
 * symbol (so ASX `CBA.AX`, crypto `BTC-USD`, etc. all resolve). If no logo
 * exists the endpoint 404s and we show the ticker's initials instead.
 */
export function TickerLogo({
  symbol,
  exchange,
  size = 40,
}: {
  symbol: string
  exchange?: string
  size?: number
}) {
  const src = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(yahooSymbol(symbol, exchange))}.png`
  const [failed, setFailed] = useState(false)

  // Reset when the ticker changes so a new symbol gets a fresh attempt.
  useEffect(() => setFailed(false), [src])

  const initials = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || '?'

  return (
    <span
      className="grid place-items-center rounded-full bg-elevated overflow-hidden shrink-0 text-xs font-bold"
      style={{ height: size, width: size }}
    >
      {failed ? (
        initials
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-full w-full object-contain p-1"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  )
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Clickjacking guard. GitHub Pages can't send frame-ancestors/X-Frame-Options
// headers (and meta CSP ignores frame-ancestors), so if another origin frames
// the app we refuse to render instead of letting our UI be overlaid and
// click-hijacked. Lives here (module code) because the strict CSP —
// script-src 'self' — rightly blocks inline <script> in index.html.
function framedByAnotherOrigin(): boolean {
  if (window.self === window.top) return false
  try {
    // Throws cross-origin; same-origin framing (e.g. some in-app browsers) is fine.
    return window.location.origin !== window.top!.location.origin
  } catch {
    return true
  }
}

if (framedByAnotherOrigin()) {
  document.getElementById('root')!.textContent =
    'Money Monitor refused to load inside a frame on another site. Open it directly instead.'
  throw new Error('Blocked: framed by another origin')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

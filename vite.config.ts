import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { FALLBACK_PROXIES, proxyOrigins } from './src/lib/proxies'

// `base` controls the public path the app is served from.
// - Local dev / custom domain / user-site (username.github.io): leave as '/'.
// - GitHub Pages *project* site (username.github.io/<repo>/): set VITE_BASE=/<repo>/.
// The CI workflow sets VITE_BASE automatically from the repository name.
const base = process.env.VITE_BASE || '/'

// Fill the CSP's `__QUOTE_PROXIES__` placeholder with the origins the quote
// layer may actually contact, derived from the same list the app fails over
// through (src/lib/proxies.ts) so the two can never drift apart.
//
// When a self-hosted quote proxy is configured (VITE_QUOTES_PROXY, see
// proxy/cloudflare-worker.js) it collapses to that origin alone. This is what
// closes the CSP's exfiltration hole: your worker only forwards to Yahoo, while
// the public proxies forward anywhere — allow-listing an open proxy defeats the
// point of connect-src.
const quotesProxy = process.env.VITE_QUOTES_PROXY
function cspQuotesProxy() {
  const origins = quotesProxy ? [new URL(quotesProxy).origin] : proxyOrigins(FALLBACK_PROXIES)
  return {
    name: 'csp-quotes-proxy',
    transformIndexHtml(html: string) {
      return html.replaceAll('__QUOTE_PROXIES__', origins.join(' '))
    },
  }
}

export default defineConfig({
  base,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Vite 8 (rolldown) only accepts the function form. Match charts/db
        // before react — "react-chartjs-2" would otherwise land in the react
        // chunk.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/](chart\.js|react-chartjs-2|@kurkle)[\\/]/.test(id)) return 'charts'
          if (/[\\/](dexie|dexie-react-hooks)[\\/]/.test(id)) return 'db'
          if (/[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
  plugins: [
    cspQuotesProxy(),
    react(),
    VitePWA({
      // 'prompt' so a new deploy waits for the user to apply it via the in-app
      // update button, instead of silently swapping under them.
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Money Monitor',
        short_name: 'Money Monitor',
        description: 'Money Monitor — a fast, private, local-first personal finance tracker.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        id: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
})

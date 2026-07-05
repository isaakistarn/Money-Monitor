/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_BASE?: string
  /** Self-hosted quote-proxy prefix, e.g. "https://quotes.<you>.workers.dev/?url=". */
  readonly VITE_QUOTES_PROXY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

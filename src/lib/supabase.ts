import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * A single shared Supabase client, or `null` when the app is built without
 * Supabase credentials (the default — the app then runs fully local-only and
 * the Sync section in Settings shows "not configured").
 *
 * The anon key is a PUBLIC client key; Row Level Security on the `records`
 * table (see supabase/schema.sql) is what actually protects each user's data.
 */
const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Tokens land in the URL hash on email-confirmation links; the app uses
        // a hash router, so disable URL session detection to avoid clobbering it.
        detectSessionInUrl: false,
      },
    })
  : null

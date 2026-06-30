import { useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { IconCloud, IconRefresh, IconLogout, IconCheck } from '@/components/ui/icons'
import { useSync } from '@/state/sync'
import { useUI } from '@/state/ui'

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function SyncCard() {
  const sync = useSync()
  const { toast } = useUI()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  if (!sync.configured) {
    return (
      <Card className="p-5">
        <SectionHeader title="Sync across devices" />
        <div className="flex gap-3">
          <span className="text-muted mt-0.5"><IconCloud width={18} /></span>
          <p className="text-sm text-muted leading-relaxed">
            Cross-device sync isn’t configured in this build. Add your Supabase URL and anon key
            (see <code className="text-fg">DEPLOY.md</code>) and rebuild to enable signing in and
            syncing your data between your phone and computer.
          </p>
        </div>
      </Card>
    )
  }

  if (!sync.authReady) {
    return (
      <Card className="p-5">
        <SectionHeader title="Sync across devices" />
        <p className="text-sm text-muted">Connecting…</p>
      </Card>
    )
  }

  const submit = async () => {
    if (!email || !password) return
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { needsConfirmation } = await sync.signUp(email, password)
        toast(needsConfirmation ? 'Check your email to confirm your account' : 'Account created', 'success')
      } else {
        await sync.signIn(email, password)
        toast('Signed in — syncing…', 'success')
      }
      setPassword('')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  // Signed out: auth form.
  if (!sync.session) {
    return (
      <Card className="p-5">
        <SectionHeader title="Sync across devices" />
        <p className="text-sm text-muted mb-4 leading-relaxed">
          Sign in to securely sync your accounts and transactions to your other devices. Your data is
          private to your account.
        </p>
        <div className="space-y-3">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
            <Input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="••••••••"
            />
          </Field>
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-accent hover:underline"
            onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}
          >
            {mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </button>
        </div>
      </Card>
    )
  }

  // Signed in: status + controls.
  return (
    <Card className="p-5">
      <SectionHeader title="Sync across devices" />
      <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <span className="text-positive"><IconCheck width={15} /></span>
            <span className="truncate">{sync.email}</span>
          </p>
          <p className="text-xs text-muted mt-0.5">
            {sync.status === 'syncing'
              ? 'Syncing…'
              : sync.status === 'error'
                ? `Sync error: ${sync.error}`
                : `Last synced ${relativeTime(sync.lastSyncAt)}${sync.pending > 0 ? ` · ${sync.pending} pending` : ''}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" onClick={() => void sync.sync()} disabled={sync.status === 'syncing'}>
            <IconRefresh width={16} className={sync.status === 'syncing' ? 'animate-spin' : undefined} /> Sync now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void sync.signOut()}>
            <IconLogout width={16} /> Sign out
          </Button>
        </div>
      </div>
      <p className="text-xs text-faint mt-2 leading-relaxed">
        Signing out stops syncing but keeps all data on this device.
      </p>
    </Card>
  )
}

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { useConfirm } from '@/components/ui/Confirm'
import { IconCheck, IconLogout, IconRefresh } from '@/components/ui/icons'
import { useUI } from '@/state/ui'
import { db } from '@/db/db'
import { Money } from '@/components/ui/Money'
import {
  beginUpConnect,
  completeUpConnect,
  disconnectUp,
  getUpSettings,
  saveUpSettings,
  syncUpNow,
  type UpConnectChoice,
} from '@/db/upsync'
import type { UpAccount } from '@/lib/up'

function relativeTime(iso: string | undefined): string {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

const HISTORY_OPTIONS = [
  { days: 0, label: 'Nothing — start from today' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 3 months' },
  { days: 365, label: 'Last 12 months' },
]

export function UpBankCard() {
  const { toast } = useUI()
  const confirm = useConfirm()
  const settings = useLiveQuery(() => getUpSettings(), [])
  const accounts = useLiveQuery(
    () => db.accounts.filter((a) => !a.archived).toArray().then((r) => r.sort((a, b) => a.order - b.order)),
    [],
  )

  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  // Connect step 2: the Up accounts behind the token + where each should land.
  const [pending, setPending] = useState<UpAccount[] | null>(null)
  const [targets, setTargets] = useState<Record<string, string>>({})
  const [historyDays, setHistoryDays] = useState(0)
  const [roundUps, setRoundUps] = useState(true)

  if (settings === undefined) {
    return (
      <Card className="p-5">
        <SectionHeader title="Up Bank" />
        <p className="text-sm text-muted">Loading…</p>
      </Card>
    )
  }

  const connect = async () => {
    if (!token.trim()) return
    setBusy(true)
    try {
      const ups = await beginUpConnect(token.trim())
      if (ups.length === 0) {
        toast('No accounts found for that token', 'error')
        return
      }
      setTargets(Object.fromEntries(ups.map((a) => [a.id, 'create'])))
      setPending(ups)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const startImport = async () => {
    if (!pending) return
    const choices: UpConnectChoice[] = pending.map((account) => ({
      account,
      target: targets[account.id] ?? 'create',
    }))
    if (choices.every((c) => c.target === 'skip')) {
      toast('Choose at least one account to import', 'error')
      return
    }
    setBusy(true)
    try {
      const r = await completeUpConnect({
        token: token.trim(),
        choices,
        historyDays,
        roundUpsAsSpend: roundUps,
      })
      toast(`Connected to Up — imported ${r.added} transaction${r.added === 1 ? '' : 's'}`, 'success')
      setPending(null)
      setToken('')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const syncNow = async () => {
    setBusy(true)
    try {
      const r = await syncUpNow()
      if (!r) return
      toast(
        r.added === 0 && r.updated === 0
          ? 'Up is in sync — nothing new'
          : `Up sync: ${r.added} new${r.updated > 0 ? `, ${r.updated} updated` : ''}`,
        'success',
      )
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect Up Bank?',
      message:
        'The saved token and account links are removed from this device. Everything already imported stays.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    })
    if (!ok) return
    await disconnectUp()
    toast('Up Bank disconnected')
  }

  /* --------------------- Connected: status card --------------------- */
  if (settings?.token) {
    const linked = Object.keys(settings.accountMap).length
    return (
      <Card className="p-5">
        <SectionHeader title="Up Bank" />
        <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <span className="text-positive"><IconCheck width={15} /></span>
              Connected · {linked} account{linked === 1 ? '' : 's'} linked
            </p>
            <p className="text-xs text-muted mt-0.5">
              Last synced {relativeTime(settings.lastSyncAt)} · new charges import automatically when the app opens
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => void syncNow()} disabled={busy}>
              <IconRefresh width={16} className={busy ? 'animate-spin' : undefined} /> Sync now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void disconnect()}>
              <IconLogout width={16} /> Disconnect
            </Button>
          </div>
        </div>
        <div className="border-t border-border mt-2" />
        <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Count round-ups as spending</p>
            <p className="text-xs text-muted mt-0.5">
              Imports Up round-up transfers as Spare Change — the moved cents count toward monthly spend.
            </p>
          </div>
          <div className="w-full sm:w-40 shrink-0">
            <Segmented<'on' | 'off'>
              value={settings.roundUpsAsSpend ? 'on' : 'off'}
              onChange={(v) => void saveUpSettings({ roundUpsAsSpend: v === 'on' })}
              options={[
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </div>
        </div>
      </Card>
    )
  }

  /* ------------------ Connect step 2: map accounts ------------------- */
  if (pending) {
    return (
      <Card className="p-5">
        <SectionHeader title="Up Bank" />
        <p className="text-sm text-muted mb-4 leading-relaxed">
          Choose where each Up account should live. “Create new” adds a matching account whose balance
          is set to the live Up balance.
        </p>
        <div className="space-y-3">
          {pending.map((a) => (
            <div key={a.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {a.accountType === 'SAVER' ? '💰 ' : '💳 '}
                  {a.displayName}
                </p>
                <p className="text-xs text-muted">
                  <Money minor={a.balanceMinor} />
                </p>
              </div>
              <Select
                value={targets[a.id] ?? 'create'}
                onChange={(e) => setTargets((t) => ({ ...t, [a.id]: e.target.value }))}
                className="w-full sm:w-56 h-10"
              >
                <option value="create">Create “{a.displayName}”</option>
                {(accounts ?? []).map((local) => (
                  <option key={local.id} value={local.id}>Link to: {local.name}</option>
                ))}
                <option value="skip">Don’t import</option>
              </Select>
            </div>
          ))}
        </div>
        <div className="border-t border-border my-4" />
        <div className="space-y-3">
          <Field
            label="Import history"
            hint="Already tracking by hand? Keep “start from today” — only new charges import, so nothing you’ve entered gets duplicated. More history can be brought in later by reconnecting."
          >
            <Select value={String(historyDays)} onChange={(e) => setHistoryDays(Number(e.target.value))}>
              {HISTORY_OPTIONS.map((o) => (
                <option key={o.days} value={o.days}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Count round-ups as spending</p>
              <p className="text-xs text-muted mt-0.5">Spare Change transfers count toward monthly spend.</p>
            </div>
            <div className="w-40 shrink-0">
              <Segmented<'on' | 'off'>
                value={roundUps ? 'on' : 'off'}
                onChange={(v) => setRoundUps(v === 'on')}
                options={[
                  { value: 'on', label: 'On' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>Back</Button>
          <Button className="flex-1" onClick={() => void startImport()} disabled={busy}>
            {busy ? 'Importing…' : 'Start importing'}
          </Button>
        </div>
      </Card>
    )
  }

  /* --------------------- Disconnected: token form -------------------- */
  return (
    <Card className="p-5">
      <SectionHeader title="Up Bank" />
      <p className="text-sm text-muted mb-4 leading-relaxed">
        Connect your Up account to import charges automatically — no more manual entry. Get a
        personal access token at{' '}
        <a
          href="https://api.up.com.au/getting_started"
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline"
        >
          api.up.com.au/getting_started
        </a>
        . The token is stored only on this device and is only ever sent to Up itself.
      </p>
      <div className="space-y-3">
        <Field label="Personal access token" hint="Starts with “up:yeah:”. Treat it like a password — it can read your whole transaction history.">
          <Input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void connect()}
            placeholder="up:yeah:…"
          />
        </Field>
        <Button className="w-full" onClick={() => void connect()} disabled={busy || !token.trim()}>
          {busy ? 'Checking…' : 'Connect to Up'}
        </Button>
      </div>
    </Card>
  )
}

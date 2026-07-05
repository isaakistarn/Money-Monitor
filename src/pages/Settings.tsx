import { useEffect, useRef, useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Segmented } from '@/components/ui/Segmented'
import { useConfirm } from '@/components/ui/Confirm'
import { IconDownload, IconUpload, IconTrash, IconSun, IconMoon, IconSettings, IconRefresh } from '@/components/ui/icons'
import { useSettings, type ThemeMode } from '@/state/settings'
import { useUI } from '@/state/ui'
import { useUpdate } from '@/state/update'
import { versionLabel } from '@/lib/version'
import { CURRENCIES } from '@/lib/money'
import { exportBackup, importBackup, backupNeedsPassphrase, clearAllData } from '@/db/backup'
import { seedSampleData } from '@/db/seed'
import { getMeta } from '@/db/meta'
import { estimateStorage, requestPersistentStorage } from '@/lib/storage'
import { useLiveQuery } from 'dexie-react-hooks'
import { RecurringManager } from '@/components/RecurringManager'
import { PaySplitManager } from '@/components/PaySplitManager'
import { SyncCard } from '@/components/SyncCard'
import { useTotalTransactionCount } from '@/hooks/useData'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Settings() {
  const { theme, setTheme, currency, setCurrency } = useSettings()
  const { toast } = useUI()
  const update = useUpdate()
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const txCount = useTotalTransactionCount()

  const lastBackup = useLiveQuery(() => getMeta<string | null>('lastBackup', null), [])
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
    estimateStorage().then(setStorage)
  }, [])

  // Export modal: optional passphrase → AES-GCM-encrypted backup file.
  const [exportOpen, setExportOpen] = useState(false)
  const [exportPass, setExportPass] = useState('')
  const [exportPass2, setExportPass2] = useState('')
  // Import modal: shown when the chosen file is an encrypted backup.
  const [importPending, setImportPending] = useState<string | null>(null)
  const [importPass, setImportPass] = useState('')

  const doExport = async () => {
    if (exportPass && exportPass !== exportPass2) {
      toast('Passphrases don’t match', 'error')
      return
    }
    if (exportPass && exportPass.length < 8) {
      toast('Use at least 8 characters', 'error')
      return
    }
    try {
      await exportBackup(exportPass || undefined)
      toast(exportPass ? 'Encrypted backup exported' : 'Backup exported', 'success')
      setExportOpen(false)
      setExportPass('')
      setExportPass2('')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const confirmAndImport = async (text: string, passphrase?: string) => {
    const ok = await confirm({
      title: 'Replace all data?',
      message: 'Importing a backup replaces everything currently in the app. Consider exporting first.',
      confirmLabel: 'Import & replace',
      tone: 'danger',
    })
    if (!ok) return
    try {
      const { transactions, dropped } = await importBackup(text, passphrase)
      toast(
        dropped > 0
          ? `Imported ${transactions} transactions (${dropped} invalid row${dropped === 1 ? '' : 's'} skipped)`
          : `Imported ${transactions} transactions`,
        'success',
      )
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const onImport = async (file: File) => {
    const text = await file.text()
    if (backupNeedsPassphrase(text)) {
      setImportPass('')
      setImportPending(text)
      return
    }
    await confirmAndImport(text)
  }

  const onClear = async () => {
    const ok = await confirm({
      title: 'Clear all data?',
      message: 'This permanently deletes every account, transaction, budget, and setting on this device. This cannot be undone.',
      confirmLabel: 'Delete everything',
      tone: 'danger',
    })
    if (!ok) return
    await clearAllData()
    toast('All data cleared')
    setTimeout(() => location.reload(), 600)
  }

  const lastBackupLabel = lastBackup
    ? new Date(lastBackup).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never'

  const usedMb = storage ? (storage.usage / 1_048_576).toFixed(1) : null

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      {/* Appearance */}
      <Card className="p-5">
        <SectionHeader title="Appearance" />
        <Row label="Theme">
          <div className="w-full sm:w-64">
            <Segmented<ThemeMode>
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: 'Light', icon: <IconSun width={15} /> },
                { value: 'dark', label: 'Dark', icon: <IconMoon width={15} /> },
                { value: 'system', label: 'Auto', icon: <IconSettings width={15} /> },
              ]}
            />
          </div>
        </Row>
        <div className="border-t border-border" />
        <Row label="Currency" hint="Used to format all amounts.">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full sm:w-44">
            {Object.entries(CURRENCIES).map(([code, c]) => (
              <option key={code} value={code}>{c.symbol} {code}</option>
            ))}
          </Select>
        </Row>
      </Card>

      {/* Cross-device sync */}
      <SyncCard />

      {/* Recurring */}
      <RecurringManager />

      {/* Pay splits */}
      <PaySplitManager />

      {/* Data & backup */}
      <Card className="p-5">
        <SectionHeader title="Data & Backup" />
        <Row label="Last backup" hint={`${txCount ?? 0} transactions stored`}>
          <span className="text-sm text-muted">{lastBackupLabel}</span>
        </Row>
        <div className="grid grid-cols-2 gap-2 py-2">
          <Button variant="secondary" onClick={() => setExportOpen(true)}>
            <IconDownload width={18} /> Export JSON
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <IconUpload width={18} /> Import JSON
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImport(f)
              e.target.value = ''
            }}
          />
        </div>

        <div className="border-t border-border mt-2" />
        <Row
          label="Persistent storage"
          hint={persisted === true ? 'Granted — your data is protected from automatic eviction.' : 'Not granted. Tap to request protection.'}
        >
          {persisted ? (
            <span className="text-sm text-positive font-medium">On</span>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const r = await requestPersistentStorage()
                setPersisted(r)
                toast(r ? 'Persistent storage enabled' : 'Browser declined the request', r ? 'success' : 'error')
              }}
            >
              Enable
            </Button>
          )}
        </Row>
        {usedMb && (
          <Row label="Storage used"><span className="text-sm text-muted">{usedMb} MB</span></Row>
        )}

        <div className="border-t border-border mt-2 pt-1" />
        <Row label="Load sample data" hint="Adds example accounts and transactions.">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await seedSampleData()
              toast('Sample data added', 'success')
            }}
          >
            Add samples
          </Button>
        </Row>
        <Row label="Clear all data" hint="Permanently delete everything on this device.">
          <Button size="sm" variant="danger" onClick={onClear}>
            <IconTrash width={16} /> Clear
          </Button>
        </Row>
      </Card>

      {/* Install help */}
      <Card className="p-5">
        <SectionHeader title="Install as an app" />
        {isIOS ? (
          <ol className="text-sm text-muted space-y-1.5 list-decimal pl-5">
            <li>Tap the <b>Share</b> button in Safari.</li>
            <li>Choose <b>Add to Home Screen</b>.</li>
            <li>Tap <b>Add</b> — Money Monitor installs like a native app.</li>
          </ol>
        ) : (
          <p className="text-sm text-muted leading-relaxed">
            Use your browser’s <b>Install</b> option (an install icon in the address bar, or the browser
            menu → “Install Money Monitor”) to add it to your device. It then runs full-screen and works offline.
          </p>
        )}
      </Card>

      {/* About / version */}
      <Card className="p-5">
        <SectionHeader title="About" />
        <Row label="Version" hint={update.updateAvailable ? 'A new version is ready to install.' : 'You’re on the latest version.'}>
          {update.updateAvailable ? (
            <Button size="sm" onClick={update.updateNow} disabled={update.updating}>
              <IconRefresh width={15} className={update.updating ? 'animate-spin' : undefined} />
              {update.updating ? 'Updating…' : 'Update now'}
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => update.checkForUpdates()} disabled={update.checking}>
              <IconRefresh width={15} className={update.checking ? 'animate-spin' : undefined} />
              {update.checking ? 'Checking…' : 'Check for updates'}
            </Button>
          )}
        </Row>
        <p className="text-xs text-faint">{versionLabel}</p>
      </Card>

      <p className="text-center text-xs text-faint pb-4">Money Monitor · local-first · {versionLabel}</p>

      {/* Export: optional encryption passphrase */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export backup"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button onClick={() => void doExport()}>
              {exportPass ? 'Export encrypted' : 'Export'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted leading-relaxed">
            A backup contains your entire financial history. Add a passphrase to encrypt it —
            recommended if the file will live in a cloud drive, email, or shared computer.
          </p>
          <Field label="Passphrase (optional)" hint="Leave blank for a plain, unencrypted export.">
            <Input
              type="password"
              autoComplete="new-password"
              value={exportPass}
              onChange={(e) => setExportPass(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          {exportPass && (
            <Field label="Repeat passphrase" hint="There is no recovery — a lost passphrase means a lost backup.">
              <Input
                type="password"
                autoComplete="new-password"
                value={exportPass2}
                onChange={(e) => setExportPass2(e.target.value)}
                placeholder="••••••••"
              />
            </Field>
          )}
        </div>
      </Modal>

      {/* Import: passphrase prompt for encrypted backups */}
      <Modal
        open={importPending !== null}
        onClose={() => setImportPending(null)}
        title="Encrypted backup"
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportPending(null)}>Cancel</Button>
            <Button
              disabled={!importPass}
              onClick={() => {
                const text = importPending
                setImportPending(null)
                if (text) void confirmAndImport(text, importPass)
              }}
            >
              Unlock & import
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted leading-relaxed">
            This backup is protected. Enter the passphrase it was exported with.
          </p>
          <Field label="Passphrase">
            <Input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={importPass}
              onChange={(e) => setImportPass(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

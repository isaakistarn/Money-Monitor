import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { IconShield, IconList, IconWallet } from '@/components/ui/icons'
import { seedSampleData, ensureBaseData } from '@/db/seed'
import { setMeta } from '@/db/meta'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)

  const finish = async (withSample: boolean) => {
    setBusy(true)
    if (withSample) await seedSampleData()
    else await ensureBaseData()
    await setMeta('onboarded', true)
    setBusy(false)
    onDone()
  }

  return (
    <Modal open onClose={() => void finish(false)} title="Welcome to Money Monitor">
      <div className="space-y-5">
        <p className="text-sm text-muted leading-relaxed">
          A fast, private place to track your money. Everything is described in three sections:
        </p>
        <ul className="space-y-3">
          <li className="flex gap-3 text-sm">
            <span className="text-accent mt-0.5"><IconList width={20} /></span>
            <span><b>Transactions</b> — log income, expenses, and transfers in a couple of taps.</span>
          </li>
          <li className="flex gap-3 text-sm">
            <span className="text-accent mt-0.5"><IconWallet width={20} /></span>
            <span><b>Accounts &amp; Budgets</b> — see your real balance and stay on target.</span>
          </li>
          <li className="flex gap-3 text-sm">
            <span className="text-warning mt-0.5"><IconShield width={20} /></span>
            <span>
              <b>Your data stays on this device.</b> No account, no servers. Because of that, please
              export a backup now and then — some browsers (especially iOS) can clear local data.
            </span>
          </li>
        </ul>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <Button variant="secondary" disabled={busy} onClick={() => finish(false)}>
            Start empty
          </Button>
          <Button disabled={busy} onClick={() => finish(true)}>
            Explore with sample data
          </Button>
        </div>
      </div>
    </Modal>
  )
}

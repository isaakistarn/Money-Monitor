import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { importBackup, backupNeedsPassphrase } from './backup'
import { encryptBackupJson, decryptBackupJson, isEncryptedBackup } from './cryptobackup'

async function reset() {
  await Promise.all([
    db.accounts.clear(), db.categories.clear(), db.transactions.clear(),
    db.budgets.clear(), db.recurring.clear(), db.meta.clear(),
    db.accountRollup.clear(), db.monthlyStats.clear(), db.categoryMonthly.clear(),
    db.paySplits.clear(), db.holdings.clear(), db.watchlist.clear(), db.outbox.clear(),
  ])
}

const tx = (id: string, amountMinor: unknown) => ({
  id, type: 'expense', amountMinor, categoryId: 'food', accountId: 'a1',
  date: '2026-07-01', ym: '2026-07', createdAt: '2026-07-01T00:00:00Z',
})

function backupWith(transactions: unknown[]) {
  return JSON.stringify({
    app: 'finance-tracker',
    version: 1,
    exportedAt: '2026-07-05T00:00:00Z',
    data: {
      accounts: [{ id: 'a1', name: 'Bank', type: 'bank', openingBalanceMinor: 100_00, archived: false, order: 0, createdAt: '' }],
      categories: [{ id: 'food', name: 'Food', kind: 'expense', icon: '🍔', isDefault: true }],
      transactions,
      budgets: [],
      recurring: [],
      meta: [],
    },
  })
}

describe('importBackup validates untrusted rows', () => {
  beforeEach(reset)

  it('imports well-formed rows and rebuilds rollups', async () => {
    const res = await importBackup(backupWith([tx('t1', 20_00), tx('t2', 5_00)]))
    expect(res).toEqual({ transactions: 2, dropped: 0 })
    expect((await db.monthlyStats.get('2026-07'))?.expenseMinor).toBe(25_00)
  })

  it('drops rows with missing ids, duplicate ids, or non-finite amounts', async () => {
    const res = await importBackup(backupWith([
      tx('t1', 20_00),
      tx('t1', 7_00), // duplicate id
      tx('t2', 'lots'), // string amount → NaN poison
      tx('t3', Infinity), // non-finite
      { ...tx('t4', 3_00), id: '' }, // empty id
      'not even an object',
      tx('t5', 5_00),
    ]))
    expect(res).toEqual({ transactions: 2, dropped: 5 })
    // Only the two clean rows influence balances/stats.
    expect((await db.monthlyStats.get('2026-07'))?.expenseMinor).toBe(25_00)
  })

  it('rejects files that are not Money Monitor backups', async () => {
    await expect(importBackup('{"app":"other"}')).rejects.toThrow(/does not look like/)
    await expect(importBackup('not json')).rejects.toThrow(/not valid JSON/)
  })
})

describe('encrypted backups (AES-GCM + PBKDF2)', () => {
  beforeEach(reset)

  it('round-trips: encrypt → detect → decrypt → import', async () => {
    const plain = backupWith([tx('t1', 20_00), tx('t2', 5_00)])
    const encrypted = JSON.stringify(await encryptBackupJson(plain, 'correct horse battery'))

    expect(backupNeedsPassphrase(encrypted)).toBe(true)
    expect(backupNeedsPassphrase(plain)).toBe(false)
    expect(isEncryptedBackup(JSON.parse(encrypted))).toBe(true)

    // Ciphertext must not leak the plaintext.
    expect(encrypted).not.toContain('Bank')
    expect(encrypted).not.toContain('transactions')

    const res = await importBackup(encrypted, 'correct horse battery')
    expect(res).toEqual({ transactions: 2, dropped: 0 })
    expect((await db.monthlyStats.get('2026-07'))?.expenseMinor).toBe(25_00)
  })

  it('fails closed on a wrong or missing passphrase and on tampering', async () => {
    const encrypted = await encryptBackupJson(backupWith([tx('t1', 20_00)]), 'right')
    const text = JSON.stringify(encrypted)

    await expect(importBackup(text)).rejects.toThrow(/encrypted/)
    await expect(importBackup(text, 'wrong')).rejects.toThrow(/Wrong passphrase/)

    // GCM authentication: flipping ciphertext bits must fail, not import garbage.
    const tampered = { ...encrypted, data: encrypted.data.slice(0, -4) + (encrypted.data.endsWith('AAAA') ? 'BBBB' : 'AAAA') }
    await expect(decryptBackupJson(tampered, 'right')).rejects.toThrow(/Wrong passphrase|corrupted/)

    // Nothing was imported by any failed attempt.
    expect(await db.transactions.count()).toBe(0)
  })

  it('uses a fresh salt and IV per export', async () => {
    const a = await encryptBackupJson('{"x":1}', 'p')
    const b = await encryptBackupJson('{"x":1}', 'p')
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.cipher.iv).not.toBe(b.cipher.iv)
    expect(a.data).not.toBe(b.data)
  })
})

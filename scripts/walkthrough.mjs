import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:5180/'
const shots = new URL('../.walkthrough/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(shots, { recursive: true })

const log = (...a) => console.log('•', ...a)
const results = []
function check(name, cond) {
  results.push({ name, ok: !!cond })
  console.log(cond ? `  ✓ ${name}` : `  ✗ ${name}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

try {
  // --- Onboarding -> sample data ---
  log('Loading app')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /sample data/i }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: shots + '01-dashboard.png' })

  const bodyText = await page.locator('body').innerText()
  check('Dashboard shows Net Worth', /Net Worth/i.test(bodyText))
  check('Dashboard shows Spendable Cash', /Spendable Cash/i.test(bodyText))
  check('Sample transactions visible (Salary or Groceries)', /Salary|Groceries|Rent/i.test(bodyText))

  // Capture the income figure for a later comparison.
  const grabIncome = async () => {
    const card = page.locator('div', { hasText: /^Income this month/ }).first()
    const txt = await card.innerText().catch(() => '')
    return txt
  }
  const incomeBefore = await grabIncome()
  log('Income card before transfer:', incomeBefore.replace(/\n/g, ' '))

  // --- Add an EXPENSE via keyboard shortcut N ---
  log('Adding an expense (shortcut: N)')
  await page.keyboard.press('n')
  await page.waitForTimeout(300)
  const amount = page.getByPlaceholder('0.00').first()
  await amount.fill('42.50')
  await page.getByRole('button', { name: /^Add$/ }).click()
  await page.waitForTimeout(500)
  check('Modal closed after add', !(await page.getByText('New transaction').isVisible().catch(() => false)))

  // --- Add a TRANSFER and verify income does NOT change ---
  log('Adding a transfer and checking income is unaffected')
  await page.keyboard.press('n')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /Transfer/i }).click()
  await page.getByPlaceholder('0.00').first().fill('100')
  await page.getByRole('button', { name: /^Add$/ }).click()
  await page.waitForTimeout(500)
  const incomeAfter = await grabIncome()
  check('Income unchanged by transfer', incomeBefore === incomeAfter)

  // --- Transactions page: search + virtualization ---
  log('Transactions page')
  await page.getByRole('link', { name: 'Transactions' }).click()
  await page.waitForTimeout(400)
  await page.getByPlaceholder(/Search/i).fill('rent')
  await page.waitForTimeout(300)
  await page.screenshot({ path: shots + '02-transactions-search.png' })
  const txText = await page.locator('body').innerText()
  check('Search narrows results', /Rent|No matches/i.test(txText))
  await page.getByPlaceholder(/Search/i).fill('')

  // --- Budgets page ---
  log('Budgets page')
  await page.getByRole('link', { name: 'Budgets' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: shots + '03-budgets.png' })
  check('Budgets render progress (% used or Over)', /% used|Over by|left/i.test(await page.locator('body').innerText()))

  // --- Accounts page ---
  log('Accounts page')
  await page.getByRole('link', { name: 'Accounts' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: shots + '04-accounts.png' })
  const accText = await page.locator('body').innerText()
  check('Accounts shows Assets & Liabilities', /Assets/i.test(accText) && /Liabilities/i.test(accText))
  check('Credit card present', /Credit Card/i.test(accText))

  // --- Analytics page (lazy charts) ---
  log('Analytics page (charts)')
  await page.getByRole('link', { name: 'Analytics' }).click()
  await page.waitForTimeout(900)
  const canvases = await page.locator('canvas').count()
  check('Charts rendered (canvas present)', canvases >= 1)
  await page.screenshot({ path: shots + '05-analytics.png' })

  // --- Theme toggle persists ---
  log('Toggling theme to light')
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: /^Light$/ }).click()
  await page.waitForTimeout(200)
  const isLight = !(await page.evaluate(() => document.documentElement.classList.contains('dark')))
  check('Light theme applied', isLight)
  await page.screenshot({ path: shots + '06-settings-light.png' })

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const stillLight = !(await page.evaluate(() => document.documentElement.classList.contains('dark')))
  check('Theme persisted across reload', stillLight)

  check('No console/page errors during walkthrough', errors.length === 0)
  if (errors.length) console.log('  errors:', errors.slice(0, 5))
} catch (e) {
  console.error('WALKTHROUGH FAILED:', e)
  await page.screenshot({ path: shots + 'failure.png' }).catch(() => {})
  results.push({ name: 'walkthrough completed', ok: false })
} finally {
  await browser.close()
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
console.log('screenshots in', shots)
process.exit(passed === results.length ? 0 : 1)

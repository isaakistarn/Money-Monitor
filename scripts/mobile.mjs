import { chromium, devices } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ ...devices['iPhone 13'] })
const p = await ctx.newPage()
await p.goto('http://localhost:5180/', { waitUntil: 'networkidle' })
const btn = p.getByRole('button', { name: /sample data/i })
if (await btn.isVisible().catch(() => false)) { await btn.click(); await p.waitForTimeout(800) }
const dir = new URL('../.walkthrough/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
await p.screenshot({ path: dir + '07-mobile.png' })
await p.locator('button[aria-label="New transaction"]').click()
await p.waitForTimeout(400)
await p.screenshot({ path: dir + '08-mobile-add.png' })
await b.close()
console.log('mobile shots done')

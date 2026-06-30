import { chromium, devices } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ ...devices['iPhone 13'] })
const p = await ctx.newPage()
await p.goto('http://localhost:5180/', { waitUntil: 'networkidle' })
const seed = p.getByRole('button', { name: /sample data/i })
if (await seed.isVisible().catch(() => false)) { await seed.click(); await p.waitForTimeout(600) }
await p.goto('http://localhost:5180/#/settings', { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
const dir = new URL('../.walkthrough/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
await p.screenshot({ path: dir + '09-settings-mobile.png', fullPage: true })
console.log('settings shot done')
await b.close()

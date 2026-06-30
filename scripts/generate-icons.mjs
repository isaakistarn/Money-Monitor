// Dependency-free PNG icon generator. Renders the brand mark — a banknote with
// a "$" medallion on a mint→sky gradient tile — at the sizes the manifest
// references. All geometry is authored in a 512-unit design space (matching
// public/favicon.svg) and scaled per target. 3x3 supersampling smooths edges.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '../public/icons')
mkdirSync(outDir, { recursive: true })

/* ----------------------------- PNG encoding ----------------------------- */

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = pixels[p]
      raw[o + 1] = pixels[p + 1]
      raw[o + 2] = pixels[p + 2]
      raw[o + 3] = pixels[p + 3]
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------ Geometry -------------------------------- */
// All coordinates below are in the 512x512 design space.

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]

const EMERALD = [52, 211, 153]
const SKY = [14, 165, 233]
const FRAME = [150, 226, 198]
const DISC = [209, 250, 229]
const RING = [16, 185, 129]
const INK = [5, 150, 105]

function inRR(X, Y, x0, y0, w, h, r) {
  const x1 = x0 + w, y1 = y0 + h
  if (X < x0 || X > x1 || Y < y0 || Y > y1) return false
  const inCornerX = X < x0 + r || X > x1 - r
  const inCornerY = Y < y0 + r || Y > y1 - r
  if (inCornerX && inCornerY) {
    const cx = X < x0 + r ? x0 + r : x1 - r
    const cy = Y < y0 + r ? y0 + r : y1 - r
    return (X - cx) ** 2 + (Y - cy) ** 2 <= r * r
  }
  return true
}

const rect = (X, Y, x0, y0, x1, y1) => X >= x0 && X <= x1 && Y >= y0 && Y <= y1

// "$" as a seven-segment "S" plus a full-height stem, centred on the medallion.
function inDollar(X, Y) {
  const cx = 256, cy = 262, t = 13
  const gx0 = cx - 23, gx1 = cx + 23, gy0 = cy - 36, gy1 = cy + 36
  if (rect(X, Y, gx0, gy0, gx1, gy0 + t)) return true // top bar
  if (rect(X, Y, gx0, cy - t / 2, gx1, cy + t / 2)) return true // middle bar
  if (rect(X, Y, gx0, gy1 - t, gx1, gy1)) return true // bottom bar
  if (rect(X, Y, gx0, gy0, gx0 + t, cy)) return true // upper-left riser
  if (rect(X, Y, gx1 - t, cy, gx1, gy1)) return true // lower-right riser
  if (rect(X, Y, cx - 6.5, gy0 - 14, cx + 6.5, gy1 + 14)) return true // $ stem
  return false
}

// Rotate (x,y) by `deg` around the canvas centre.
function rotate(x, y, deg) {
  const a = (deg * Math.PI) / 180
  const dx = x - 256, dy = y - 256
  return [256 + dx * Math.cos(a) - dy * Math.sin(a), 256 + dx * Math.sin(a) + dy * Math.cos(a)]
}

// Colour (rgba) of the icon at design-space point (x,y).
function colorAt(x, y, maskable) {
  // Tile (rounded unless maskable, which must bleed to the edges).
  if (!maskable && !inRR(x, y, 0, 0, 512, 512, 120)) return [0, 0, 0, 0]
  let col = mix(EMERALD, SKY, (x + y) / 1024)

  // Everything else lives on the rotated bill; rotate the sample into its frame.
  const [X, Y] = rotate(x, y, -8)
  if (inRR(X, Y, 104, 176, 304, 172, 24)) {
    col = mix([255, 255, 255], [238, 242, 247], Math.max(0, Math.min(1, (Y - 176) / 172)))
    // Subtle banknote frame.
    if (inRR(X, Y, 124, 196, 264, 132, 14) && !inRR(X, Y, 128, 200, 256, 124, 11)) col = FRAME
    const d = Math.hypot(X - 256, Y - 262)
    if (d <= 52) col = DISC
    if (d <= 52 && d >= 47) col = RING
    if (inDollar(X, Y)) col = INK
  }
  return [col[0], col[1], col[2], 255]
}

function render(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const SS = 3 // 3x3 supersampling
  const scale = 512 / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = (x + (sx + 0.5) / SS) * scale
          const dy = (y + (sy + 0.5) / SS) * scale
          const [cr, cg, cb, ca] = colorAt(dx, dy, maskable)
          const af = ca / 255
          r += cr * af; g += cg * af; b += cb * af; a += ca
        }
      }
      const n = SS * SS
      const af = a / 255
      const i = (y * size + x) * 4
      px[i] = af ? Math.round(r / af) : 0
      px[i + 1] = af ? Math.round(g / af) : 0
      px[i + 2] = af ? Math.round(b / af) : 0
      px[i + 3] = Math.round(a / n)
    }
  }
  return px
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-512-maskable.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
]

for (const [name, size, opts] of targets) {
  const png = encodePNG(size, render(size, opts))
  writeFileSync(resolve(outDir, name), png)
  console.log('wrote', name, `${size}x${size}`, png.length, 'bytes')
}

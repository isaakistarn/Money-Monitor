/**
 * Passphrase encryption for backup files (WebCrypto, no dependencies).
 *
 * AES-256-GCM with a key derived from the passphrase via PBKDF2-SHA-256 at
 * 600k iterations (OWASP guidance). GCM authenticates as well as encrypts, so
 * a tampered file fails to decrypt instead of importing garbage. The app/
 * version header stays in the clear so import can recognise the file and ask
 * for the passphrase; everything financial is ciphertext.
 */

export interface EncryptedBackupFile {
  app: 'finance-tracker'
  version: 1
  encrypted: true
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-GCM'; iv: string }
  /** Base64 ciphertext of the plain backup JSON. */
  data: string
}

const ITERATIONS = 600_000

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBackupJson(plainJson: string, passphrase: string): Promise<EncryptedBackupFile> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainJson),
  )
  return {
    app: 'finance-tracker',
    version: 1,
    encrypted: true,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    data: toB64(ciphertext),
  }
}

export function isEncryptedBackup(x: unknown): x is EncryptedBackupFile {
  const f = x as EncryptedBackupFile
  return (
    !!f && f.app === 'finance-tracker' && f.encrypted === true &&
    typeof f.data === 'string' &&
    typeof f.kdf?.salt === 'string' && typeof f.cipher?.iv === 'string'
  )
}

export async function decryptBackupJson(file: EncryptedBackupFile, passphrase: string): Promise<string> {
  // Cap iterations so a doctored file can't stall the device for minutes.
  const iterations = Math.min(Math.max(1, Number(file.kdf.iterations) || ITERATIONS), 5_000_000)
  const key = await deriveKey(passphrase, fromB64(file.kdf.salt), iterations)
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(file.cipher.iv) }, key, fromB64(file.data),
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    // GCM auth failure: wrong passphrase or tampered/corrupted ciphertext.
    throw new Error('Wrong passphrase (or the file is corrupted).')
  }
}

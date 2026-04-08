/**
 * E2E Encryption — Asymmetric key management for secure CLI ↔ Pod communication.
 *
 * Architecture:
 * - RSA-OAEP 4096-bit keypair generated once, stored locally
 * - AES-256-GCM used for bulk payload encryption (symmetric)
 * - RSA encrypts the per-message AES key (hybrid encryption)
 * - Private key never leaves the local machine
 * - Public key is uploaded to the pod on startup
 *
 * Flow:
 *   CLI → Pod:  CLI generates AES key, encrypts payload with AES,
 *               encrypts AES key with pod's public key, sends both
 *   Pod → CLI:  Pod generates AES key, encrypts response with AES,
 *               encrypts AES key with CLI's public key, sends both
 */

import { createHash, generateKeyPairSync, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const KEYS_DIR_NAME = 'keys'
const PRIVATE_KEY_FILE = 'void_cli.pem'
const PUBLIC_KEY_FILE = 'void_cli.pub.pem'
const KEY_BITS = 4096

function getKeysDir(): string {
  const configDir = process.env.VOID_CONFIG_DIR
    || process.env.CLAUDE_CONFIG_DIR
    || join(process.env.HOME || '~', '.void')
  const keysDir = join(configDir, KEYS_DIR_NAME)
  if (!existsSync(keysDir)) {
    mkdirSync(keysDir, { recursive: true, mode: 0o700 })
  }
  return keysDir
}

export interface VoidKeyPair {
  publicKey: string
  privateKey: string
  fingerprint: string
}

/**
 * Generate a new RSA-OAEP 4096-bit keypair.
 */
export function generateKeyPair(): VoidKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: KEY_BITS,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  const fingerprint = createHash('sha256')
    .update(publicKey)
    .digest('hex')
    .slice(0, 16)

  return { publicKey, privateKey, fingerprint }
}

/**
 * Load existing keypair from disk, or generate and persist a new one.
 */
export function loadOrCreateKeyPair(): VoidKeyPair {
  const keysDir = getKeysDir()
  const privPath = join(keysDir, PRIVATE_KEY_FILE)
  const pubPath = join(keysDir, PUBLIC_KEY_FILE)

  if (existsSync(privPath) && existsSync(pubPath)) {
    const privateKey = readFileSync(privPath, 'utf-8')
    const publicKey = readFileSync(pubPath, 'utf-8')
    const fingerprint = createHash('sha256')
      .update(publicKey)
      .digest('hex')
      .slice(0, 16)
    return { publicKey, privateKey, fingerprint }
  }

  const keyPair = generateKeyPair()
  writeFileSync(privPath, keyPair.privateKey, { mode: 0o600 })
  writeFileSync(pubPath, keyPair.publicKey, { mode: 0o644 })
  return keyPair
}

/**
 * Load only the public key (for uploading to a pod).
 */
export function loadPublicKey(): string {
  const keysDir = getKeysDir()
  const pubPath = join(keysDir, PUBLIC_KEY_FILE)
  if (!existsSync(pubPath)) {
    const kp = loadOrCreateKeyPair()
    return kp.publicKey
  }
  return readFileSync(pubPath, 'utf-8')
}

/**
 * Get the fingerprint of the current keypair.
 */
export function getKeyFingerprint(): string {
  const publicKey = loadPublicKey()
  return createHash('sha256')
    .update(publicKey)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Generate a random 256-bit AES key.
 */
export function generateAESKey(): Buffer {
  return randomBytes(32)
}

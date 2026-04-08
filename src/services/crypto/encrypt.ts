/**
 * E2E Encryption — Hybrid RSA + AES-256-GCM encryption/decryption.
 *
 * Payload format (encrypted):
 * {
 *   v: 1,                          // protocol version
 *   key: "<base64 RSA-encrypted AES key>",
 *   iv: "<base64 12-byte IV>",
 *   tag: "<base64 16-byte auth tag>",
 *   data: "<base64 AES-GCM ciphertext>",
 *   fp: "<sender key fingerprint>"
 * }
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'crypto'
import { generateAESKey } from './keys.js'

export interface EncryptedPayload {
  /** Protocol version */
  v: 1
  /** RSA-encrypted AES key (base64) */
  key: string
  /** AES-GCM initialization vector (base64) */
  iv: string
  /** AES-GCM auth tag (base64) */
  tag: string
  /** AES-GCM ciphertext (base64) */
  data: string
  /** Sender's public key fingerprint */
  fp: string
}

/**
 * Encrypt a plaintext payload for a recipient using their public key.
 *
 * Uses hybrid encryption:
 * 1. Generate random AES-256 key
 * 2. Encrypt payload with AES-256-GCM
 * 3. Encrypt AES key with recipient's RSA public key
 */
export function encryptPayload(
  plaintext: string,
  recipientPublicKey: string,
  senderPublicKey: string,
): EncryptedPayload {
  // Generate ephemeral AES key and IV
  const aesKey = generateAESKey()
  const iv = randomBytes(12)

  // Encrypt payload with AES-256-GCM
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  // Encrypt the AES key with recipient's RSA public key
  const encryptedKey = publicEncrypt(
    {
      key: recipientPublicKey,
      oaepHash: 'sha256',
    },
    aesKey,
  )

  const fingerprint = createHash('sha256')
    .update(senderPublicKey)
    .digest('hex')
    .slice(0, 16)

  return {
    v: 1,
    key: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
    fp: fingerprint,
  }
}

/**
 * Decrypt an encrypted payload using our private key.
 */
export function decryptPayload(
  payload: EncryptedPayload,
  privateKey: string,
): string {
  if (payload.v !== 1) {
    throw new Error(`Unsupported encryption protocol version: ${payload.v}`)
  }

  // Decrypt the AES key with our RSA private key
  const aesKey = privateDecrypt(
    {
      key: privateKey,
      oaepHash: 'sha256',
    },
    Buffer.from(payload.key, 'base64'),
  )

  // Decrypt the payload with AES-256-GCM
  const decipher = createDecipheriv(
    'aes-256-gcm',
    aesKey,
    Buffer.from(payload.iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final(),
  ])

  return decrypted.toString('utf-8')
}

/**
 * Encrypt a Buffer (for file uploads — session data, memory, etc.).
 */
export function encryptBuffer(
  data: Buffer,
  recipientPublicKey: string,
  senderPublicKey: string,
): EncryptedPayload {
  return encryptPayload(data.toString('base64'), recipientPublicKey, senderPublicKey)
}

/**
 * Decrypt a payload back to a Buffer.
 */
export function decryptToBuffer(
  payload: EncryptedPayload,
  privateKey: string,
): Buffer {
  const base64 = decryptPayload(payload, privateKey)
  return Buffer.from(base64, 'base64')
}

/**
 * Check if a value looks like an encrypted payload.
 */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return obj.v === 1
    && typeof obj.key === 'string'
    && typeof obj.iv === 'string'
    && typeof obj.tag === 'string'
    && typeof obj.data === 'string'
}

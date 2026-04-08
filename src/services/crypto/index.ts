/**
 * E2E Encryption — Public API.
 *
 * Provides hybrid RSA-4096 + AES-256-GCM encryption for all
 * CLI ↔ GPU pod communication. Private keys never leave the
 * local machine.
 */

export {
  generateKeyPair,
  loadOrCreateKeyPair,
  loadPublicKey,
  getKeyFingerprint,
  generateAESKey,
  type VoidKeyPair,
} from './keys.js'

export {
  encryptPayload,
  decryptPayload,
  encryptBuffer,
  decryptToBuffer,
  isEncryptedPayload,
  type EncryptedPayload,
} from './encrypt.js'

export {
  createEncryptedFetch,
  resetPodKeyCache,
} from './transport.js'

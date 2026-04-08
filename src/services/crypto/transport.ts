/**
 * Encrypted Transport Wrapper — E2E encrypts HTTP payloads to GPU pods.
 *
 * Wraps the global `fetch` function to transparently encrypt request bodies
 * and decrypt response bodies for RunPod endpoints. The model server on the
 * pod has a thin sidecar that handles decryption/re-encryption.
 *
 * For direct llama.cpp / vLLM pods without sidecar, this module can be
 * bypassed — the pod's network is already private (RunPod proxy).
 * Enable with VOID_ENCRYPT_TRANSPORT=1 for maximum privacy.
 */

import {
  encryptPayload,
  decryptPayload,
  isEncryptedPayload,
  type EncryptedPayload,
} from './encrypt.js'
import { loadOrCreateKeyPair } from './keys.js'

/** Cached pod public key (fetched once per session) */
let _podPublicKey: string | null = null

/**
 * Fetch the pod's public key from its /void/pubkey endpoint.
 */
async function fetchPodPublicKey(podBaseURL: string): Promise<string> {
  if (_podPublicKey) return _podPublicKey

  const response = await fetch(`${podBaseURL}/void/pubkey`, {
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch pod public key: ${response.status}`)
  }

  _podPublicKey = await response.text()
  return _podPublicKey
}

/**
 * Reset cached pod key (call when switching pods).
 */
export function resetPodKeyCache(): void {
  _podPublicKey = null
}

/**
 * Create an encrypted fetch wrapper for a specific pod endpoint.
 *
 * Returns a `fetch`-compatible function that:
 * 1. Encrypts POST bodies with the pod's public key
 * 2. Decrypts response bodies with our private key
 * 3. Passes through non-POST requests unchanged
 */
export function createEncryptedFetch(podBaseURL: string): typeof fetch {
  const keyPair = loadOrCreateKeyPair()

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Only encrypt POST requests with JSON bodies (model API calls)
    if (init?.method === 'POST' && init.body && typeof init.body === 'string') {
      try {
        const podPubKey = await fetchPodPublicKey(podBaseURL)

        // Encrypt the request body
        const encrypted = encryptPayload(
          init.body,
          podPubKey,
          keyPair.publicKey,
        )

        const encryptedInit: RequestInit = {
          ...init,
          body: JSON.stringify(encrypted),
          headers: {
            ...Object.fromEntries(
              new Headers(init.headers).entries(),
            ),
            'X-Void-Encrypted': '1',
            'X-Void-Key-Fingerprint': keyPair.fingerprint,
          },
        }

        const response = await fetch(input, encryptedInit)

        // Check if response is encrypted
        if (response.headers.get('X-Void-Encrypted') === '1') {
          const encryptedResponse = (await response.json()) as EncryptedPayload
          const decrypted = decryptPayload(encryptedResponse, keyPair.privateKey)

          return new Response(decrypted, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          })
        }

        return response
      } catch {
        // If encryption fails, fall through to unencrypted
        // (pod may not have sidecar)
        return fetch(input, init)
      }
    }

    return fetch(input, init)
  }
}

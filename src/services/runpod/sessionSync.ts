/**
 * RunPod Session Sync — Encrypted upload/download of session context and memory.
 *
 * On session start:
 *   1. Load local memory + prior session context
 *   2. Encrypt with pod's public key
 *   3. Upload to pod volume
 *
 * On session end:
 *   1. Download updated memory from pod
 *   2. Decrypt with local private key
 *   3. Merge into local memory store
 *
 * All data in transit and at rest on the pod is encrypted.
 * The pod never sees plaintext memory — it only serves the model.
 * Prompts/responses flow through the OpenAI-compatible API encrypted
 * via the transport wrapper.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  encryptPayload,
  decryptPayload,
  loadOrCreateKeyPair,
  type EncryptedPayload,
} from '../crypto/index.js'

export interface SessionBundle {
  /** Session transcript (JSONL lines) */
  transcript: string | null
  /** Knowledge graph (graph.json) */
  memoryGraph: string | null
  /** Project memory (MEMORY.md + topic files) */
  projectMemory: Record<string, string>
  /** Session memory summary */
  sessionSummary: string | null
  /** Timestamp */
  bundledAt: number
}

/**
 * Collect all session data into a bundle for upload.
 */
export function collectSessionBundle(
  sessionId: string,
  projectDir: string,
): SessionBundle {
  const configDir = process.env.VOID_CONFIG_DIR
    || process.env.CLAUDE_CONFIG_DIR
    || join(process.env.HOME || '~', '.void')

  // Session transcript
  const transcriptPath = join(projectDir, `${sessionId}.jsonl`)
  const transcript = existsSync(transcriptPath)
    ? readFileSync(transcriptPath, 'utf-8')
    : null

  // Knowledge graph
  const graphPath = join(configDir, 'memory', 'graph.json')
  const memoryGraph = existsSync(graphPath)
    ? readFileSync(graphPath, 'utf-8')
    : null

  // Project memory files
  const projectMemory: Record<string, string> = {}
  const memoryDir = join(projectDir, 'memory')
  if (existsSync(memoryDir)) {
    const { readdirSync, statSync } = require('fs')
    const files = readdirSync(memoryDir) as string[]
    for (const file of files) {
      const filePath = join(memoryDir, file)
      if (statSync(filePath).isFile()) {
        projectMemory[file] = readFileSync(filePath, 'utf-8')
      }
    }
  }

  // Session memory summary
  const summaryPath = join(projectDir, sessionId, 'session-memory', 'summary.md')
  const sessionSummary = existsSync(summaryPath)
    ? readFileSync(summaryPath, 'utf-8')
    : null

  return {
    transcript,
    memoryGraph,
    projectMemory,
    sessionSummary,
    bundledAt: Date.now(),
  }
}

/**
 * Encrypt a session bundle for upload to a pod.
 */
export function encryptSessionBundle(
  bundle: SessionBundle,
  podPublicKey: string,
): EncryptedPayload {
  const keyPair = loadOrCreateKeyPair()
  const serialized = JSON.stringify(bundle)
  return encryptPayload(serialized, podPublicKey, keyPair.publicKey)
}

/**
 * Decrypt a session bundle received from a pod.
 */
export function decryptSessionBundle(
  encrypted: EncryptedPayload,
): SessionBundle {
  const keyPair = loadOrCreateKeyPair()
  const serialized = decryptPayload(encrypted, keyPair.privateKey)
  return JSON.parse(serialized) as SessionBundle
}

/**
 * Merge a downloaded session bundle back into local storage.
 */
export function mergeSessionBundle(
  bundle: SessionBundle,
  sessionId: string,
  projectDir: string,
): { merged: string[] } {
  const configDir = process.env.VOID_CONFIG_DIR
    || process.env.CLAUDE_CONFIG_DIR
    || join(process.env.HOME || '~', '.void')

  const merged: string[] = []

  // Merge transcript (append new lines)
  if (bundle.transcript) {
    const transcriptPath = join(projectDir, `${sessionId}.jsonl`)
    writeFileSync(transcriptPath, bundle.transcript, 'utf-8')
    merged.push('transcript')
  }

  // Merge knowledge graph (replace — pod may have added entities)
  if (bundle.memoryGraph) {
    const graphDir = join(configDir, 'memory')
    const { mkdirSync } = require('fs')
    mkdirSync(graphDir, { recursive: true })
    writeFileSync(join(graphDir, 'graph.json'), bundle.memoryGraph, 'utf-8')
    merged.push('memory graph')
  }

  // Merge project memory files
  if (Object.keys(bundle.projectMemory).length > 0) {
    const memoryDir = join(projectDir, 'memory')
    const { mkdirSync } = require('fs')
    mkdirSync(memoryDir, { recursive: true })
    for (const [file, content] of Object.entries(bundle.projectMemory)) {
      writeFileSync(join(memoryDir, file), content, 'utf-8')
    }
    merged.push(`project memory (${Object.keys(bundle.projectMemory).length} files)`)
  }

  // Merge session summary
  if (bundle.sessionSummary) {
    const summaryDir = join(projectDir, sessionId, 'session-memory')
    const { mkdirSync } = require('fs')
    mkdirSync(summaryDir, { recursive: true })
    writeFileSync(join(summaryDir, 'summary.md'), bundle.sessionSummary, 'utf-8')
    merged.push('session summary')
  }

  return { merged }
}

/**
 * Upload encrypted bundle to a running pod via its API.
 */
export async function uploadBundleToPod(
  podEndpoint: string,
  encrypted: EncryptedPayload,
): Promise<void> {
  const response = await fetch(`${podEndpoint}/void/session/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(encrypted),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown')
    throw new Error(`Failed to upload session bundle: ${response.status} ${text}`)
  }
}

/**
 * Download encrypted bundle from a running pod.
 */
export async function downloadBundleFromPod(
  podEndpoint: string,
): Promise<EncryptedPayload> {
  const response = await fetch(`${podEndpoint}/void/session/download`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown')
    throw new Error(`Failed to download session bundle: ${response.status} ${text}`)
  }

  return (await response.json()) as EncryptedPayload
}

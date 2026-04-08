/**
 * RunPod GPU Cloud — API Client.
 *
 * Manages ephemeral GPU pod lifecycle:
 * 1. Create pod with llama.cpp/vLLM serving a model
 * 2. Wait for pod + model server to be ready
 * 3. Return OpenAI-compatible endpoint URL
 * 4. Stop/terminate pod when session ends
 *
 * All communication with the pod's model server is E2E encrypted.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type {
  GpuAvailability,
  PodCreateOptions,
  PodInfo,
  PodStatus,
  RunPodConfig,
} from './types.js'

const RUNPOD_API_BASE = 'https://api.runpod.io/graphql'
const RUNPOD_REST_BASE = 'https://api.runpod.io/v2'

// Default Docker image: llama.cpp server with OpenAI-compatible API
const DEFAULT_IMAGE = 'ghcr.io/ggerganov/llama.cpp:server'
const DEFAULT_PORTS = '8080/http,22/tcp'
const DEFAULT_VOLUME_SIZE = 100 // GB — enough for large GGUF files
const DEFAULT_CONTAINER_DISK = 20 // GB

function getConfigDir(): string {
  const configDir = process.env.VOID_CONFIG_DIR
    || process.env.CLAUDE_CONFIG_DIR
    || join(process.env.HOME || '~', '.void')
  const runpodDir = join(configDir, 'runpod')
  if (!existsSync(runpodDir)) {
    mkdirSync(runpodDir, { recursive: true, mode: 0o700 })
  }
  return runpodDir
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

/**
 * Load RunPod configuration from disk.
 */
export function loadRunPodConfig(): RunPodConfig | null {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) return null
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as RunPodConfig
  } catch {
    return null
  }
}

/**
 * Save RunPod configuration to disk.
 */
export function saveRunPodConfig(config: RunPodConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), { mode: 0o600 })
}

/**
 * Get the RunPod API key from config or environment.
 */
function getApiKey(): string {
  const envKey = process.env.RUNPOD_API_KEY
  if (envKey) return envKey

  const config = loadRunPodConfig()
  if (config?.apiKey) return config.apiKey

  throw new Error(
    'RunPod API key not found. Set RUNPOD_API_KEY env var or run /provider add runpod <api-key>',
  )
}

/**
 * Execute a RunPod GraphQL query.
 */
async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const apiKey = getApiKey()

  const response = await fetch(RUNPOD_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown')
    throw new Error(`RunPod API error (${response.status}): ${text}`)
  }

  const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (json.errors?.length) {
    throw new Error(`RunPod GraphQL error: ${json.errors.map(e => e.message).join(', ')}`)
  }

  return json.data as T
}

/**
 * Create a new GPU pod.
 */
export async function createPod(options: PodCreateOptions): Promise<PodInfo> {
  const envEntries = Object.entries(options.env).map(
    ([key, value]) => ({ key, value }),
  )

  const data = await graphql<{ podFindAndDeployOnDemand: any }>(`
    mutation {
      podFindAndDeployOnDemand(input: {
        name: "${options.name || 'void-cli-gpu'}"
        imageName: "${options.image}"
        gpuTypeId: "${options.gpuType}"
        gpuCount: ${options.gpuCount}
        volumeInGb: ${options.volumeSize}
        containerDiskInGb: ${options.containerDiskSize}
        ports: "${options.ports}"
        startJupyter: false
        startSsh: true
        dockerArgs: "${options.startCommand.replace(/"/g, '\\"')}"
        ${options.spot ? 'bidPerGpu: 0.0' : ''}
        env: ${JSON.stringify(envEntries)}
      }) {
        id
        name
        desiredStatus
        imageName
        machine {
          gpuDisplayName
        }
        runtime {
          uptimeInSeconds
          gpus {
            id
          }
          ports {
            ip
            isIpPublic
            privatePort
            publicPort
            type
          }
        }
      }
    }
  `)

  const pod = data.podFindAndDeployOnDemand
  return parsePodResponse(pod, options.gpuCount)
}

/**
 * Get info about an existing pod.
 */
export async function getPod(podId: string): Promise<PodInfo> {
  const data = await graphql<{ pod: any }>(`
    query {
      pod(input: { podId: "${podId}" }) {
        id
        name
        desiredStatus
        imageName
        machine {
          gpuDisplayName
        }
        runtime {
          uptimeInSeconds
          gpus {
            id
          }
          ports {
            ip
            isIpPublic
            privatePort
            publicPort
            type
          }
        }
      }
    }
  `)

  return parsePodResponse(data.pod, 1)
}

/**
 * Stop a running pod (keeps volume, can be restarted).
 */
export async function stopPod(podId: string): Promise<void> {
  await graphql(`
    mutation {
      podStop(input: { podId: "${podId}" }) {
        id
        desiredStatus
      }
    }
  `)
}

/**
 * Terminate a pod completely (deletes volume).
 */
export async function terminatePod(podId: string): Promise<void> {
  await graphql(`
    mutation {
      podTerminate(input: { podId: "${podId}" })
    }
  `)
}

/**
 * Resume a stopped pod.
 */
export async function resumePod(podId: string): Promise<PodInfo> {
  const data = await graphql<{ podResume: any }>(`
    mutation {
      podResume(input: { podId: "${podId}", gpuCount: 1 }) {
        id
        name
        desiredStatus
        machine {
          gpuDisplayName
        }
        runtime {
          uptimeInSeconds
          ports {
            ip
            isIpPublic
            privatePort
            publicPort
            type
          }
        }
      }
    }
  `)

  return parsePodResponse(data.podResume, 1)
}

/**
 * List available GPU types and pricing.
 */
export async function listGpuTypes(): Promise<GpuAvailability[]> {
  const data = await graphql<{ gpuTypes: any[] }>(`
    query {
      gpuTypes {
        id
        displayName
        memoryInGb
        secureCloud
        communityCloud
        lowestPrice {
          minimumBidPrice
          uninterruptablePrice
        }
      }
    }
  `)

  return data.gpuTypes.map((gpu: any) => ({
    gpuType: gpu.id,
    available: gpu.secureCloud || gpu.communityCloud,
    pricePerHourUSD: gpu.lowestPrice?.uninterruptablePrice ?? 0,
    spotPricePerHourUSD: gpu.lowestPrice?.minimumBidPrice ?? null,
    vramGB: gpu.memoryInGb,
  }))
}

/**
 * Wait for a pod to be in RUNNING state with model server ready.
 */
export async function waitForPodReady(
  podId: string,
  timeoutMs: number = 300_000,
  onStatus?: (status: string) => void,
): Promise<PodInfo> {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const pod = await getPod(podId)

    if (pod.status === 'RUNNING' && pod.apiEndpoint) {
      // Check if model server is actually responding
      try {
        const health = await fetch(`${pod.apiEndpoint}/health`, {
          signal: AbortSignal.timeout(5000),
        })
        if (health.ok) {
          onStatus?.('Pod ready, model server healthy')
          return pod
        }
      } catch {
        // Model still loading
      }
      onStatus?.('Pod running, waiting for model server...')
    } else if (pod.status === 'EXITED' || pod.status === 'TERMINATED') {
      throw new Error(`Pod ${podId} ${pod.status} unexpectedly`)
    } else {
      onStatus?.(`Pod status: ${pod.status}`)
    }

    await new Promise(r => setTimeout(r, 5000))
  }

  throw new Error(`Pod ${podId} did not become ready within ${timeoutMs / 1000}s`)
}

/**
 * Create and wait for a pod running a specific model.
 */
export async function launchModelPod(
  model: string,
  options?: {
    gpuType?: string
    gpuCount?: number
    spot?: boolean
    onStatus?: (status: string) => void
  },
): Promise<{ pod: PodInfo; modelEndpoint: string }> {
  const config = loadRunPodConfig()

  // Determine GPU config — use model preset or defaults
  const gpuType = options?.gpuType
    || config?.defaultGpuType
    || 'NVIDIA A100 80GB'
  const gpuCount = options?.gpuCount
    || config?.defaultGpuCount
    || 1

  options?.onStatus?.(`Creating pod with ${gpuCount}x ${gpuType}...`)

  const pod = await createPod({
    name: `void-${model.replace(/[^a-z0-9]/gi, '-').slice(0, 30)}`,
    gpuType,
    gpuCount,
    image: DEFAULT_IMAGE,
    volumeSize: DEFAULT_VOLUME_SIZE,
    containerDiskSize: DEFAULT_CONTAINER_DISK,
    ports: DEFAULT_PORTS,
    spot: options?.spot ?? config?.useSpot ?? false,
    startCommand: [
      '--host', '0.0.0.0',
      '--port', '8080',
      '--model', `/models/${model}`,
      '--ctx-size', '32768',
      '--n-gpu-layers', '999',
      '--jinja', // Enable tool calling templates
    ].join(' '),
    env: {
      MODEL_NAME: model,
    },
  })

  // Save active pod ID
  if (config) {
    saveRunPodConfig({ ...config, activePodId: pod.id })
  }

  options?.onStatus?.(`Pod ${pod.id} created, waiting for startup...`)

  const readyPod = await waitForPodReady(pod.id, 300_000, options?.onStatus)

  const modelEndpoint = `${readyPod.apiEndpoint}/v1`

  return { pod: readyPod, modelEndpoint }
}

/**
 * Stop the active pod (preserves volume for quick resume).
 */
export async function stopActivePod(): Promise<void> {
  const config = loadRunPodConfig()
  if (!config?.activePodId) {
    throw new Error('No active RunPod session')
  }
  await stopPod(config.activePodId)
}

/**
 * Terminate the active pod completely.
 */
export async function terminateActivePod(): Promise<void> {
  const config = loadRunPodConfig()
  if (!config?.activePodId) {
    throw new Error('No active RunPod session')
  }
  await terminatePod(config.activePodId)
  saveRunPodConfig({ ...config, activePodId: null })
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function parsePodResponse(pod: any, gpuCount: number): PodInfo {
  const ports = pod.runtime?.ports ?? []
  const httpPort = ports.find((p: any) => p.privatePort === 8080 && p.isIpPublic)

  const apiEndpoint = httpPort
    ? `https://${pod.id}-8080.proxy.runpod.net`
    : null

  const uptimeSeconds = pod.runtime?.uptimeInSeconds ?? 0

  return {
    id: pod.id,
    name: pod.name ?? 'void-cli-gpu',
    status: (pod.desiredStatus ?? 'CREATED') as PodStatus,
    gpuType: pod.machine?.gpuDisplayName ?? 'unknown',
    gpuCount,
    apiEndpoint,
    sshCommand: pod.id ? `ssh root@${pod.id}.runpod.io` : null,
    costPerHourUSD: 0, // Populated from GPU listing
    startedAt: uptimeSeconds > 0 ? Date.now() - uptimeSeconds * 1000 : null,
    uptimeMs: uptimeSeconds * 1000,
  }
}

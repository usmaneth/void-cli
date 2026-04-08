/**
 * RunPod GPU Cloud — Type definitions.
 */

export type PodStatus =
  | 'CREATED'
  | 'RUNNING'
  | 'STARTING'
  | 'STOPPING'
  | 'STOPPED'
  | 'EXITED'
  | 'TERMINATED'

export interface PodInfo {
  id: string
  name: string
  status: PodStatus
  gpuType: string
  gpuCount: number
  /** Public IP + port for the model server */
  apiEndpoint: string | null
  /** SSH connection string */
  sshCommand: string | null
  /** Cost per hour in USD */
  costPerHourUSD: number
  /** When the pod was started */
  startedAt: number | null
  /** Uptime in ms */
  uptimeMs: number
}

export interface PodCreateOptions {
  /** Display name */
  name?: string
  /** GPU type (e.g., 'NVIDIA A100 80GB', 'NVIDIA RTX 4090') */
  gpuType: string
  /** Number of GPUs */
  gpuCount: number
  /** Docker image */
  image: string
  /** Volume size in GB */
  volumeSize: number
  /** Container disk size in GB */
  containerDiskSize: number
  /** Ports to expose (e.g., '8080/http,22/tcp') */
  ports: string
  /** Docker start command */
  startCommand: string
  /** Environment variables */
  env: Record<string, string>
  /** Use spot/interruptible pricing */
  spot?: boolean
}

export interface RunPodConfig {
  /** RunPod API key */
  apiKey: string
  /** Default GPU type */
  defaultGpuType: string
  /** Default GPU count */
  defaultGpuCount: number
  /** Default model to serve */
  defaultModel: string
  /** Use spot pricing by default */
  useSpot: boolean
  /** Auto-stop after idle minutes (0 = disabled) */
  autoStopMinutes: number
  /** Pod ID of the current/last pod */
  activePodId: string | null
}

export interface GpuAvailability {
  gpuType: string
  available: boolean
  pricePerHourUSD: number
  spotPricePerHourUSD: number | null
  vramGB: number
}

/** Recommended GPU configurations for common models */
export const MODEL_GPU_CONFIGS: Record<string, {
  gpuType: string
  gpuCount: number
  vramRequired: string
  description: string
}> = {
  'glm-5.1-iq2': {
    gpuType: 'NVIDIA A100 80GB',
    gpuCount: 4,
    vramRequired: '~250 GB',
    description: 'GLM-5.1 2-bit quant — minimum viable config',
  },
  'glm-5.1-q4': {
    gpuType: 'NVIDIA A100 80GB',
    gpuCount: 6,
    vramRequired: '~440 GB',
    description: 'GLM-5.1 4-bit quant — better quality',
  },
  'qwen2.5-coder:32b': {
    gpuType: 'NVIDIA RTX 4090',
    gpuCount: 1,
    vramRequired: '~20 GB',
    description: 'Qwen 2.5 Coder 32B — best coding value',
  },
  'llama-3.3-70b': {
    gpuType: 'NVIDIA A100 80GB',
    gpuCount: 1,
    vramRequired: '~40 GB',
    description: 'Llama 3.3 70B — strong general model',
  },
}

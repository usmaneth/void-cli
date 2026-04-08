/**
 * RunPod GPU Cloud — Public API.
 *
 * Ephemeral GPU pod management for running large models
 * (GLM-5.1, Llama 70B, etc.) without persistent hosting costs.
 *
 * Usage flow:
 *   1. `void` starts → spins up RunPod GPU pod
 *   2. Encrypted session context uploaded to pod
 *   3. Model queries routed to pod's OpenAI-compatible API
 *   4. Session ends → download updated context, stop pod
 *   5. Next session → resume pod, re-upload context
 */

export {
  loadRunPodConfig,
  saveRunPodConfig,
  createPod,
  getPod,
  stopPod,
  terminatePod,
  resumePod,
  listGpuTypes,
  waitForPodReady,
  launchModelPod,
  stopActivePod,
  terminateActivePod,
} from './client.js'

export type {
  PodInfo,
  PodStatus,
  PodCreateOptions,
  RunPodConfig,
  GpuAvailability,
} from './types.js'

export { MODEL_GPU_CONFIGS } from './types.js'

export {
  collectSessionBundle,
  encryptSessionBundle,
  decryptSessionBundle,
  mergeSessionBundle,
  uploadBundleToPod,
  downloadBundleFromPod,
} from './sessionSync.js'

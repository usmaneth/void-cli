/**
 * Analytics metadata - stubbed (telemetry stripped)
 */

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

export function sanitizeToolNameForAnalytics(
  toolName: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export function isToolDetailsLoggingEnabled(): boolean {
  return false
}

export function isAnalyticsToolDetailsLoggingEnabled(
  _mcpServerType: string | undefined,
  _mcpServerBaseUrl: string | undefined,
): boolean {
  return false
}

export function mcpToolDetailsForAnalytics(
  _toolName: string,
  _mcpServerType: string | undefined,
  _mcpServerBaseUrl: string | undefined,
): {
  mcpServerName?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  mcpToolName?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
} {
  return {}
}

export function extractMcpToolDetails(_toolName: string):
  | {
      serverName: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      mcpToolName: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    }
  | undefined {
  return undefined
}

export function extractSkillName(
  _toolName: string,
  _input: unknown,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  return undefined
}

export function extractToolInputForTelemetry(
  _input: unknown,
): string | undefined {
  return undefined
}

export function getFileExtensionForAnalytics(
  _filePath: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  return undefined
}

export function getFileExtensionsFromBashCommand(
  _command: string,
  _simulatedSedEditFilePath?: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  return undefined
}

export type EnvContext = {
  platform: string
  platformRaw: string
  arch: string
  nodeVersion: string
  terminal: string | null
  packageManagers: string
  runtimes: string
  isRunningWithBun: boolean
  isCi: boolean
  isClaubbit: boolean
  isClaudeCodeRemote: boolean
  isLocalAgentMode: boolean
  isConductor: boolean
  remoteEnvironmentType?: string
  coworkerType?: string
  claudeCodeContainerId?: string
  claudeCodeRemoteSessionId?: string
  tags?: string
  isGithubAction: boolean
  isClaudeCodeAction: boolean
  isClaudeAiAuth: boolean
  version: string
  versionBase?: string
  buildTime: string
  deploymentEnvironment: string
  githubEventName?: string
  githubActionsRunnerEnvironment?: string
  githubActionsRunnerOs?: string
  githubActionRef?: string
  wslVersion?: string
  linuxDistroId?: string
  linuxDistroVersion?: string
  linuxKernel?: string
  vcs?: string
}

export type ProcessMetrics = {
  uptime: number
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
  constrainedMemory: number | undefined
  cpuUsage: NodeJS.CpuUsage
  cpuPercent: number | undefined
}

export type EventMetadata = {
  model: string
  sessionId: string
  userType: string
  betas?: string
  envContext: EnvContext
  entrypoint?: string
  agentSdkVersion?: string
  isInteractive: string
  clientType: string
  processMetrics?: ProcessMetrics
  sweBenchRunId: string
  sweBenchInstanceId: string
  sweBenchTaskId: string
  agentId?: string
  parentSessionId?: string
  agentType?: 'teammate' | 'subagent' | 'standalone'
  teamName?: string
  subscriptionType?: string
  rh?: string
  kairosActive?: true
  skillMode?: 'discovery' | 'coach' | 'discovery_and_coach'
  observerMode?: 'backseat' | 'skillcoach' | 'both'
}

export type EnrichMetadataOptions = {
  model?: unknown
  betas?: unknown
  additionalMetadata?: Record<string, unknown>
}

export async function getEventMetadata(
  _options: EnrichMetadataOptions = {},
): Promise<EventMetadata> {
  return {
    model: '',
    sessionId: '',
    userType: '',
    envContext: {
      platform: process.platform,
      platformRaw: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      terminal: null,
      packageManagers: '',
      runtimes: '',
      isRunningWithBun: false,
      isCi: false,
      isClaubbit: false,
      isClaudeCodeRemote: false,
      isLocalAgentMode: false,
      isConductor: false,
      isGithubAction: false,
      isClaudeCodeAction: false,
      isClaudeAiAuth: false,
      version: '',
      buildTime: '',
      deploymentEnvironment: '',
    },
    isInteractive: 'false',
    clientType: '',
    sweBenchRunId: '',
    sweBenchInstanceId: '',
    sweBenchTaskId: '',
  }
}

export type FirstPartyEventLoggingCoreMetadata = {
  session_id: string
  model: string
  user_type: string
  betas?: string
  entrypoint?: string
  agent_sdk_version?: string
  is_interactive: boolean
  client_type: string
  swe_bench_run_id?: string
  swe_bench_instance_id?: string
  swe_bench_task_id?: string
  agent_id?: string
  parent_session_id?: string
  agent_type?: 'teammate' | 'subagent' | 'standalone'
  team_name?: string
}

export type FirstPartyEventLoggingMetadata = {
  env: Record<string, unknown>
  process?: string
  auth?: Record<string, unknown>
  core: FirstPartyEventLoggingCoreMetadata
  additional: Record<string, unknown>
}

export function to1PEventFormat(
  _metadata: EventMetadata,
  _userMetadata: unknown,
  _additionalMetadata: Record<string, unknown> = {},
): FirstPartyEventLoggingMetadata {
  return {
    env: {},
    core: {
      session_id: '',
      model: '',
      user_type: '',
      is_interactive: false,
      client_type: '',
    },
    additional: {},
  }
}

// Auto-generated stub for missing generated types
// These types would normally be generated from Zod schemas in coreSchemas.ts

export type SDKMessage = any
export type SDKUserMessage = any
export type SDKUserMessageReplay = any
export type SDKResultMessage = any
export type SDKResultSuccess = any
export type SDKAssistantMessage = any
export type SDKAssistantMessageError = any
export type SDKSessionInfo = any
export type SDKStatus = any
export type SDKStatusMessage = any
export type ModelUsage = any
export type ExitReason = any
export type PermissionResult = any
export type PermissionMode = any
export type HookInput = any
export type AsyncHookJSONOutput = {
  async: true
  asyncTimeout?: number
}
export type SyncHookJSONOutput = {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  systemMessage?: string
  reason?: string
  hookSpecificOutput?: any
}
export type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput
export type BaseHookInput = any
export type PreToolUseHookInput = any
export type PostToolUseHookInput = any
export type PostToolUseFailureHookInput = any
export type NotificationHookInput = any
export type UserPromptSubmitHookInput = any
export type SessionStartHookInput = any
export type SessionEndHookInput = any
export type StopHookInput = any
export type StopFailureHookInput = any
export type SubagentStartHookInput = any
export type SubagentStopHookInput = any
export type PreCompactHookInput = any
export type PostCompactHookInput = any
export type PermissionRequestHookInput = any
export type PermissionDeniedHookInput = any
export type SetupHookInput = any
export type TeammateIdleHookInput = any
export type TaskCreatedHookInput = any
export type TaskCompletedHookInput = any
export type ElicitationHookInput = any
export type ElicitationResultHookInput = any
export type ConfigChangeHookInput = any
export type WorktreeCreateHookInput = any
export type WorktreeRemoveHookInput = any
export type InstructionsLoadedHookInput = any
export type CwdChangedHookInput = any
export type FileChangedHookInput = any
export type PermissionUpdate = any
export type SDKPartialAssistantMessage = any
export type SDKSystemMessage = any
export type ModelInfo = any
export type McpServerConfigForProcessTransport = any
export type McpServerStatus = any
export type RewindFilesResult = any
export type SDKCompactBoundaryMessage = any
export type SDKPermissionDenial = any
export type SDKToolProgressMessage = any
export type SDKRateLimitInfo = any
export type ApiKeySource = any

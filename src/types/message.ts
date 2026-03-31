// Auto-generated stub for missing module
export type AssistantMessage = {
  type: 'assistant'
  message: any
  uuid?: string
  timestamp?: any
  isMeta?: boolean
  isVirtual?: boolean
  requestId?: string
  error?: any
  isApiErrorMessage?: boolean
  advisorModel?: string
  apiError?: any
  errorDetails?: string
  [key: string]: any
}
export const AssistantMessage: any = undefined as any
export type AttachmentMessage<T = any> = {
  type: string
  data?: T
  attachment: T
  identity?: any
  timestamp?: number
  uuid?: string
  [key: string]: any
}
export type CollapsedReadSearchGroup = any
export const CollapsedReadSearchGroup: any = undefined as any
export type CollapsibleMessage = any
export const CollapsibleMessage: any = undefined as any
export type CompactMetadata = any
export const CompactMetadata: any = undefined as any
export type GroupedToolUseMessage = any
export const GroupedToolUseMessage: any = undefined as any
export type HookResultMessage = any
export const HookResultMessage: any = undefined as any
export type Message = {
  type: string
  message?: any
  uuid?: string
  timestamp?: any
  isMeta?: boolean
  isVirtual?: boolean
  isVisibleInTranscriptOnly?: boolean
  isCompactSummary?: boolean
  toolUseResult?: any
  mcpMeta?: any
  parentToolUseID?: string
  parentUuid?: string | null
  data?: any
  error?: any
  isApiErrorMessage?: boolean
  advisorModel?: string
  requestId?: string
  imagePasteIds?: any[]
  origin?: any
  permissionMode?: any
  apiError?: any
  errorDetails?: string
  [key: string]: any
}
export const Message: any = undefined as any
export type MessageOrigin = any
export const MessageOrigin: any = undefined as any
export type NormalizedAssistantMessage<T = any> = {
  type: string
  data?: T
  timestamp?: number
  message: any
  isMeta?: boolean
  isVirtual?: boolean
  isVisibleInTranscriptOnly?: boolean
  requestId?: string
  uuid: string
  error?: any
  isApiErrorMessage?: boolean
  advisorModel?: string
  toolUseResult?: any
  mcpMeta?: any
  parentToolUseID?: string
  sourceToolUseID?: string
  toolUseID?: string
  subtype?: string
  origin?: any
  isCompactSummary?: boolean
  [key: string]: any
}
export type NormalizedMessage = {
  type: string
  message?: any
  uuid?: string
  timestamp?: any
  isMeta?: boolean
  isVirtual?: boolean
  isVisibleInTranscriptOnly?: boolean
  isCompactSummary?: boolean
  toolUseResult?: any
  mcpMeta?: any
  parentToolUseID?: string
  sourceToolUseID?: string
  toolUseID?: string
  subtype?: string
  error?: any
  origin?: any
  data?: any
  [key: string]: any
}
export const NormalizedMessage: any = undefined as any
export type NormalizedUserMessage = {
  type: 'user'
  message: any
  uuid: string
  timestamp?: number
  isMeta?: boolean
  isVirtual?: boolean
  isVisibleInTranscriptOnly?: boolean
  toolUseResult?: any
  mcpMeta?: any
  imagePasteIds?: string[]
  origin?: any
  isCompactSummary?: boolean
}
export const NormalizedUserMessage: any = undefined as any
export type PartialCompactDirection = any
export const PartialCompactDirection: any = undefined as any
export type ProgressMessage<T = any> = {
  type: string
  data?: T
  progress?: number
  message?: string
  [key: string]: any
}
export type QueueOperationMessage = any
export const QueueOperationMessage: any = undefined as any
export type RenderableMessage = any
export const RenderableMessage: any = undefined as any
export type RequestStartEvent = any
export const RequestStartEvent: any = undefined as any
export type StopHookInfo = any
export const StopHookInfo: any = undefined as any
export type StreamEvent = any
export const StreamEvent: any = undefined as any
export type SystemAPIErrorMessage = any
export const SystemAPIErrorMessage: any = undefined as any
export type SystemAgentsKilledMessage = any
export const SystemAgentsKilledMessage: any = undefined as any
export type SystemApiMetricsMessage = any
export const SystemApiMetricsMessage: any = undefined as any
export type SystemAwaySummaryMessage = any
export const SystemAwaySummaryMessage: any = undefined as any
export type SystemBridgeStatusMessage = any
export const SystemBridgeStatusMessage: any = undefined as any
export type SystemCompactBoundaryMessage = any
export const SystemCompactBoundaryMessage: any = undefined as any
export type SystemFileSnapshotMessage = any
export const SystemFileSnapshotMessage: any = undefined as any
export type SystemInformationalMessage = any
export const SystemInformationalMessage: any = undefined as any
export type SystemLocalCommandMessage = any
export const SystemLocalCommandMessage: any = undefined as any
export type SystemMemorySavedMessage = any
export const SystemMemorySavedMessage: any = undefined as any
export type SystemMessage = any
export const SystemMessage: any = undefined as any
export type SystemMessageLevel = any
export const SystemMessageLevel: any = undefined as any
export type SystemMicrocompactBoundaryMessage = any
export const SystemMicrocompactBoundaryMessage: any = undefined as any
export type SystemPermissionRetryMessage = any
export const SystemPermissionRetryMessage: any = undefined as any
export type SystemScheduledTaskFireMessage = any
export const SystemScheduledTaskFireMessage: any = undefined as any
export type SystemStopHookSummaryMessage = any
export const SystemStopHookSummaryMessage: any = undefined as any
export type SystemThinkingMessage = any
export const SystemThinkingMessage: any = undefined as any
export type SystemTurnDurationMessage = any
export const SystemTurnDurationMessage: any = undefined as any
export type TombstoneMessage = any
export const TombstoneMessage: any = undefined as any
export type ToolUseSummaryMessage = any
export const ToolUseSummaryMessage: any = undefined as any
export type UserMessage = {
  type: 'user'
  message: any
  uuid?: string
  timestamp?: any
  isMeta?: boolean
  isVirtual?: boolean
  isVisibleInTranscriptOnly?: boolean
  isCompactSummary?: boolean
  toolUseResult?: any
  mcpMeta?: any
  imagePasteIds?: any[]
  origin?: any
  permissionMode?: any
  sourceToolAssistantUUID?: string
  summarizeMetadata?: any
  [key: string]: any
}
export const UserMessage: any = undefined as any

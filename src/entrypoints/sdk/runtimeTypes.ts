// Auto-generated stub for missing module
export type AnyZodRawShape = any
export const AnyZodRawShape: any = undefined as any
export type EffortLevel = any
export const EffortLevel: any = undefined as any
export type ForkSessionOptions = any
export const ForkSessionOptions: any = undefined as any
export type ForkSessionResult = any
export const ForkSessionResult: any = undefined as any
export type GetSessionInfoOptions = any
export const GetSessionInfoOptions: any = undefined as any
export type GetSessionMessagesOptions = any
export const GetSessionMessagesOptions: any = undefined as any
export type InferShape<T = any> = T extends Record<string, any> ? { [K in keyof T]: T[K] extends { _output: infer O } ? O : any } : any
export type InternalOptions = any
export const InternalOptions: any = undefined as any
export type InternalQuery = any
export const InternalQuery: any = undefined as any
export type ListSessionsOptions = any
export const ListSessionsOptions: any = undefined as any
export type McpSdkServerConfigWithInstance = any
export const McpSdkServerConfigWithInstance: any = undefined as any
export type Options = any
export const Options: any = undefined as any
export type Query = any
export const Query: any = undefined as any
export type SDKSession = any
export const SDKSession: any = undefined as any
export type SDKSessionOptions = any
export const SDKSessionOptions: any = undefined as any
export type SdkMcpToolDefinition<Schema = any> = {
  name: string
  description: string
  inputSchema: Schema
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<any>
  annotations?: any
  searchHint?: string
  alwaysLoad?: boolean
}
export type SessionMessage = any
export const SessionMessage: any = undefined as any
export type SessionMutationOptions = any
export const SessionMutationOptions: any = undefined as any

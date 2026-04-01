// Stub declarations for internal/private packages not available on npm
declare module '@ant/computer-use-input' { const x: any; export default x; export { x as ComputerInput }; export type ComputerUseInput = any; export type ComputerUseInputAPI = any; }
declare module '@ant/computer-use-mcp' { const x: any; export default x; export { x as ComputerExecutor }; export type ComputerExecutor = any; export type DisplayGeometry = any; export type FrontmostApp = any; export type InstalledApp = any; export type ResolvePrepareCaptureResult = any; export type RunningApp = any; export type ScreenshotResult = any; export const API_RESIZE_PARAMS: any; export const targetImageSize: any; export function buildComputerUseTools(...args: any[]): any; export function createComputerUseMcpServer(...args: any[]): any; export function bindSessionContext(...args: any[]): any; export type ComputerUseSessionContext = any; export type CuCallToolResult = any; export type CuPermissionRequest = any; export type CuPermissionResponse = any; export const DEFAULT_GRANT_FLAGS: any; export type ScreenshotDims = any; }
declare module '@ant/computer-use-mcp/sentinelApps' { const x: any; export default x; export function getSentinelCategory(...args: any[]): any; }
declare module '@ant/computer-use-mcp/types' { export type ComputerUseEvent = any; export type ScreenSize = any; export type CuPermissionRequest = any; export type CuPermissionResponse = any; export const DEFAULT_GRANT_FLAGS: any; export type CoordinateMode = any; export type CuSubGates = any; export type ComputerUseHostAdapter = any; export type Logger = any; const x: any; export default x; }
declare module '@ant/computer-use-swift' { const x: any; export default x; export type ComputerUseAPI = any; }
declare module '@ant/claude-for-chrome-mcp' { const x: any; export default x; }
declare module '@anthropic-ai/claude-agent-sdk' { const x: any; export default x; export type PermissionMode = any; }
declare module '@anthropic-ai/mcpb' { const x: any; export default x; export type McpbManifest = any; export type McpbUserConfigurationOption = any; }
declare module '@anthropic-ai/sandbox-runtime' { const x: any; export default x; export type FsReadRestrictionConfig = any; export type FsWriteRestrictionConfig = any; export type IgnoreViolationsConfig = any; export type NetworkHostPattern = any; export type NetworkRestrictionConfig = any; export type SandboxAskCallback = any; export type SandboxDependencyCheck = any; export type SandboxRuntimeConfig = any; export type SandboxViolationEvent = any; export const SandboxManager: any; export const SandboxRuntimeConfigSchema: any; export const SandboxViolationStore: any; }
declare module '@anthropic-ai/foundry-sdk' { const x: any; export default x; }

// Native addon stubs
declare module 'audio-capture-napi' { const x: any; export default x; }
declare module 'color-diff-napi' { export function diffStrings(a: string, b: string, opts?: any): any; export type ColorDiff = any; export const ColorDiff: any; export type ColorFile = any; export const ColorFile: any; export function getSyntaxTheme(...args: any[]): any; export type SyntaxTheme = any; const x: any; export default x; }
declare module 'image-processor-napi' { const x: any; export default x; }
declare module 'url-handler-napi' { const x: any; export default x; }

// Bun FFI
declare module 'bun:ffi' { const x: any; export default x; }

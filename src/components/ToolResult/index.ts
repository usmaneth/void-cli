/**
 * Public surface of the unified tool result pipeline. Per-tool UIs
 * migrating off the legacy `renderToolResultMessage` path should import
 * from here.
 *
 * See ToolResultView.ts for the schema contract and migration plan.
 */
export { ToolResultFrame } from './ToolResultFrame.js'
export { ResultBanner } from './ResultBanner.js'
export { ResultSummary } from './ResultSummary.js'
export type {
  ToolResultStatus,
  ToolResultTag,
  ToolResultView,
} from './ToolResultView.js'
export { TOOL_RESULT_TONE_COLOR } from './ToolResultView.js'

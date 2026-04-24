/**
 * ToolResultView — canonical schema for a tool result.
 *
 * This is the data contract for the unified rendering pipeline. Tools opt
 * in by implementing `renderToolResultView(result, ctx): ToolResultView`
 * alongside the existing `renderToolResultMessage`. When present, the
 * framework routes rendering through `ToolResultFrame` instead of the
 * legacy per-tool renderer, giving every tool identical chrome, status
 * treatment, and collapsing behavior without each tool reinventing it.
 *
 * The schema is intentionally small — anything a tool's body needs that
 * doesn't fit (streaming, progress, custom layouts) can still be placed
 * in `body` as a React node. The goal is to unify the chrome, not to
 * force-fit every imaginable rendering.
 *
 * Migration plan:
 *   1. Infrastructure in place (this file, ToolResultFrame, primitives).
 *   2. Per-tool migrations: each tool UI gains `renderToolResultView`
 *      that projects its existing result into this schema.
 *   3. UserToolResultMessage routing dispatches to ToolResultFrame for
 *      any tool that opts in; others keep the legacy path indefinitely.
 */
import type * as React from 'react'

/** Outcome of a single tool run. Drives color + glyph selection. */
export type ToolResultStatus =
  | 'success'
  | 'error'
  | 'warn'
  | 'rejected'
  | 'canceled'
  | 'running'

/** A compact right-side "chip" — e.g. "12 matches", "3 files", "ok". */
export type ToolResultTag = {
  label: string
  /**
   * Optional theme token override. When omitted, the tag inherits the
   * dim chrome color — the common case for neutral summaries.
   */
  tone?: 'info' | 'success' | 'warn' | 'error' | 'subtle'
}

export type ToolResultView = {
  /** Outcome. Drives card variant (color + glyph). */
  status: ToolResultStatus
  /** Short header-line description under the tool label. Usually the
   *  primary input (file path, command, query). Single line. */
  subtitle?: string
  /** Optional right-side chip with one-word/short summary. */
  tag?: ToolResultTag
  /**
   * Result body. Free-form React node. Tools can render diffs, tables,
   * custom views here — the frame only provides the chrome around it.
   */
  body?: React.ReactNode
  /**
   * Optional footer — e.g. "Press Ctrl+O to expand", classifier chips,
   * truncation notices. Rendered dim, under the body.
   */
  footer?: React.ReactNode
  /**
   * When the body is long, whether the frame may collapse it to a
   * single "X lines / Y bytes" summary in condensed view. Defaults to
   * true — tools that must always show their full output (diff cards,
   * images) can set this to false.
   */
  collapsible?: boolean
}

/**
 * Tone tokens mapped to theme colors for ToolResultTag. Exported so
 * primitives (banner, summary) can share the mapping.
 */
export const TOOL_RESULT_TONE_COLOR: Record<
  NonNullable<ToolResultTag['tone']>,
  string
> = {
  info: 'ide',
  success: 'success',
  warn: 'warning',
  error: 'error',
  subtle: 'subtle',
}

/**
 * Maps transcript events to (glyph, role) tuples for the gutter.
 *
 * Event sources are upstream (MessageRow / ToolCallRow) — this module
 * only translates an event into the rail's visual decision. Caller
 * threads previousRole so idle rows inherit the rail's last color.
 */
import { HEARTBEAT_GLYPHS, type Role } from './glyphGrammar.js'

export type GutterEvent =
  | { type: 'userMessage' }
  | { type: 'assistantMessage'; kind: 'fresh' | 'afterRead' }
  | { type: 'toolCallBegin'; toolName: string }
  | { type: 'toolCallEnd'; success: boolean }
  | { type: 'idle'; previousRole: Role | undefined }

export type RailTuple = {
  glyph: string
  role: Role
}

const WRITE_TOOLS = new Set([
  'Edit', 'Write', 'NotebookEdit', 'MultiEdit',
])

function roleForTool(toolName: string): Role {
  return WRITE_TOOLS.has(toolName) ? 'voidWrite' : 'voidProse'
}

export function resolveEventGlyph(event: GutterEvent): RailTuple {
  switch (event.type) {
    case 'userMessage':
      return { glyph: HEARTBEAT_GLYPHS.eventStart, role: 'you' }
    case 'assistantMessage':
      return {
        glyph: event.kind === 'afterRead'
          ? HEARTBEAT_GLYPHS.branch
          : HEARTBEAT_GLYPHS.eventStart,
        role: 'voidProse',
      }
    case 'toolCallBegin':
      return {
        glyph: HEARTBEAT_GLYPHS.eventStart,
        role: roleForTool(event.toolName),
      }
    case 'toolCallEnd':
      return {
        glyph: event.success ? HEARTBEAT_GLYPHS.success : HEARTBEAT_GLYPHS.failure,
        role: event.success ? 'success' : 'failure',
      }
    case 'idle':
      return {
        glyph: HEARTBEAT_GLYPHS.steady,
        role: event.previousRole ?? 'voidProse',
      }
  }
}

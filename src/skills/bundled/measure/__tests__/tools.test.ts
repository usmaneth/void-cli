/**
 * Tests for tool detection helpers — focused on pure functions. The
 * spawn-based detectors (resolveToolBinary, captureToolVersion,
 * detectAllTools) hit the filesystem + child processes and aren't covered
 * here; they're exercised end-to-end by the user when /measure runs.
 */
import { describe, expect, it } from 'vitest'
import { isToolName } from '../tools.js'

describe('isToolName', () => {
  it('returns true for every known tool name', () => {
    for (const name of ['void', 'claude', 'codex', 'opencode']) {
      expect(isToolName(name)).toBe(true)
    }
  })

  it('returns false for unknown names', () => {
    for (const name of ['', 'foo', 'CLAUDE', 'void-bin', ' codex']) {
      expect(isToolName(name)).toBe(false)
    }
  })
})

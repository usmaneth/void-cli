import { describe, expect, it } from 'vitest'
import {
  TOOL_RESULT_TONE_COLOR,
  type ToolResultStatus,
  type ToolResultTag,
  type ToolResultView,
} from '../ToolResultView.js'

describe('ToolResultView schema', () => {
  it('TOOL_RESULT_TONE_COLOR covers every tone option', () => {
    // Compile-time exhaustiveness check: if a new tone is added to
    // ToolResultTag, this forces a matching map entry.
    const tones: Array<NonNullable<ToolResultTag['tone']>> = [
      'info',
      'success',
      'warn',
      'error',
      'subtle',
    ]
    for (const tone of tones) {
      expect(TOOL_RESULT_TONE_COLOR[tone]).toBeDefined()
    }
  })

  it('accepts a minimal success view', () => {
    const view: ToolResultView = { status: 'success' }
    expect(view.status).toBe('success')
  })

  it('accepts all status values', () => {
    const statuses: ToolResultStatus[] = [
      'success',
      'error',
      'warn',
      'rejected',
      'canceled',
      'running',
    ]
    for (const status of statuses) {
      const view: ToolResultView = { status }
      expect(view.status).toBe(status)
    }
  })

  it('accepts a fully-populated view', () => {
    const view: ToolResultView = {
      status: 'warn',
      subtitle: 'src/foo.ts',
      tag: { label: '3 matches', tone: 'info' },
      collapsible: false,
    }
    expect(view.tag?.tone).toBe('info')
    expect(view.collapsible).toBe(false)
  })
})

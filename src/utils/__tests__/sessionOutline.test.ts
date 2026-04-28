import { describe, expect, it } from 'vitest'
import {
  buildSessionOutline,
  milestoneColor,
  milestoneMarker,
  type Milestone,
} from '../sessionOutline.js'

function userPrompt(uuid: string, text: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'user',
    uuid,
    message: { role: 'user', content: text },
    ...extra,
  }
}

function userCommand(uuid: string, name: string, args = '') {
  const text = `<command-name>${name}</command-name><command-args>${args}</command-args>`
  return {
    type: 'user',
    uuid,
    message: { role: 'user', content: text },
  }
}

function assistantToolUse(
  uuid: string,
  name: string,
  input: Record<string, unknown>,
) {
  return {
    type: 'assistant',
    uuid,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: `tu_${uuid}`, name, input }],
    },
  }
}

function toolResult(
  uuid: string,
  toolUseId: string,
  content: string,
  isError = false,
  toolUseResult: unknown = null,
) {
  return {
    type: 'user',
    uuid,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content,
          ...(isError ? { is_error: true } : {}),
        },
      ],
    },
    toolUseResult,
  }
}

describe('buildSessionOutline', () => {
  it('returns empty list for empty input', () => {
    expect(buildSessionOutline([])).toEqual([])
  })

  it('captures a user prompt', () => {
    const msgs = [userPrompt('u1', 'Please implement the feature')]
    const m = buildSessionOutline(msgs)
    expect(m).toHaveLength(1)
    expect(m[0]?.kind).toBe('user_prompt')
    expect(m[0]?.messageIndex).toBe(0)
    expect(m[0]?.label).toContain('Please implement')
  })

  it('captures slash commands distinctly from prompts', () => {
    const msgs = [userCommand('u1', 'commit', '-m wip')]
    const m = buildSessionOutline(msgs)
    expect(m).toHaveLength(1)
    expect(m[0]?.kind).toBe('user_command')
    expect(m[0]?.label).toBe('/commit -m wip')
  })

  it('classifies file edits/writes/reads', () => {
    const msgs = [
      assistantToolUse('a1', 'FileEdit', { file_path: '/src/foo.ts', old_string: 'a', new_string: 'b' }),
      assistantToolUse('a2', 'FileWrite', { file_path: '/src/bar.ts', content: 'x' }),
      assistantToolUse('a3', 'FileRead', { file_path: '/src/baz.ts' }),
    ]
    const m = buildSessionOutline(msgs)
    expect(m.map(x => x.kind)).toEqual(['file_edit', 'file_write', 'file_read'])
    expect(m[0]?.detail).toBe('/src/foo.ts')
    expect(m[0]?.label).toContain('foo.ts')
  })

  it('classifies validation-like shell commands', () => {
    const msgs = [
      assistantToolUse('a1', 'Bash', { command: 'npm run typecheck', description: 'typecheck' }),
      assistantToolUse('a2', 'Bash', { command: 'echo hi', description: 'say hi' }),
      assistantToolUse('a3', 'Bash', { command: 'pnpm test', description: 'run tests' }),
    ]
    const m = buildSessionOutline(msgs)
    expect(m[0]?.kind).toBe('validation')
    expect(m[1]?.kind).toBe('shell_command')
    expect(m[2]?.kind).toBe('validation')
  })

  it('classifies search as search', () => {
    const msgs = [assistantToolUse('a1', 'Grep', { pattern: 'foo.*bar' })]
    const m = buildSessionOutline(msgs)
    expect(m[0]?.kind).toBe('search')
    expect(m[0]?.label).toContain('foo.*bar')
  })

  it('surfaces failures for errored tool_results', () => {
    const msgs = [
      toolResult('u1', 'tu_a1', 'ENOENT', true, { error: 'file not found' }),
    ]
    const m = buildSessionOutline(msgs)
    expect(m).toHaveLength(1)
    expect(m[0]?.kind).toBe('failure')
    expect(m[0]?.isError).toBe(true)
  })

  it('surfaces failures for assistant API errors', () => {
    const msgs = [
      {
        type: 'assistant',
        uuid: 'a1',
        isApiErrorMessage: true,
        errorDetails: 'rate limited',
        message: { role: 'assistant', content: [] },
      },
    ]
    const m = buildSessionOutline(msgs)
    expect(m).toHaveLength(1)
    expect(m[0]?.kind).toBe('failure')
    expect(m[0]?.label).toBe('API error')
  })

  it('skips empty/synthetic user messages (isMeta)', () => {
    const msgs = [
      userPrompt('u1', 'real prompt'),
      userPrompt('u2', 'hidden', { isMeta: true }),
      userPrompt('u3', 'also real'),
    ]
    const m = buildSessionOutline(msgs)
    expect(m).toHaveLength(2)
    expect(m.map(x => x.uuid)).toEqual(['u1', 'u3'])
  })

  it('truncates long prompts to a single line preview', () => {
    const long = 'x'.repeat(500)
    const msgs = [userPrompt('u1', `${long}\nsecond line`)]
    const m = buildSessionOutline(msgs)
    expect(m[0]?.label.length).toBeLessThanOrEqual(80)
    expect(m[0]?.label).not.toContain('\n')
  })

  it('strips system-reminder tags from prompt preview', () => {
    const msgs = [
      userPrompt(
        'u1',
        '<system-reminder>secret</system-reminder>Hello world',
      ),
    ]
    const m = buildSessionOutline(msgs)
    expect(m[0]?.label).toBe('Hello world')
  })

  it('preserves message order across types', () => {
    const msgs = [
      userPrompt('u1', 'first'),
      assistantToolUse('a1', 'Bash', { command: 'tsc --noEmit', description: 'check' }),
      userPrompt('u2', 'second'),
    ]
    const m = buildSessionOutline(msgs)
    expect(m.map(x => x.kind)).toEqual(['user_prompt', 'validation', 'user_prompt'])
    expect(m.map(x => x.messageIndex)).toEqual([0, 1, 2])
  })

  it('honors limit by returning the newest milestones', () => {
    const msgs = Array.from({ length: 300 }, (_, i) => userPrompt(`u${i}`, `m${i}`))
    const m = buildSessionOutline(msgs, { limit: 10 })
    expect(m).toHaveLength(10)
    // Last 10 should survive
    expect(m[0]?.uuid).toBe('u290')
    expect(m[9]?.uuid).toBe('u299')
  })

  it('records compact boundaries', () => {
    const msgs = [
      userPrompt('u1', 'hi'),
      {
        type: 'system',
        uuid: 's1',
        subtype: 'compact_boundary',
      },
      userPrompt('u2', 'after compact'),
    ]
    const m = buildSessionOutline(msgs)
    expect(m.map(x => x.kind)).toEqual([
      'user_prompt',
      'compact_boundary',
      'user_prompt',
    ])
  })

  it('expands grouped_tool_use via the callback', () => {
    const grouped = {
      type: 'grouped_tool_use',
      uuid: 'g1',
      children: [
        assistantToolUse('a1', 'FileRead', { file_path: '/a.ts' }),
        assistantToolUse('a2', 'FileRead', { file_path: '/b.ts' }),
      ],
    }
    const m = buildSessionOutline([grouped], {
      expandCollapsed: msg => (msg as any).children,
    })
    expect(m).toHaveLength(2)
    expect(m.every(x => x.kind === 'file_read')).toBe(true)
    // messageIndex points back to the group
    expect(m.every(x => x.messageIndex === 0)).toBe(true)
  })

  it('falls back to a summary when no expand hook provided', () => {
    const grouped = {
      type: 'grouped_tool_use',
      uuid: 'g1',
      children: [{}, {}, {}],
    }
    const m = buildSessionOutline([grouped])
    expect(m).toHaveLength(1)
    expect(m[0]?.label).toContain('3')
  })

  it('tolerates null/garbage entries', () => {
    const m = buildSessionOutline([null, 'string', 42, undefined, {}] as unknown[])
    expect(m).toEqual([])
  })
})

describe('milestoneMarker / milestoneColor', () => {
  it('returns a distinct marker per kind', () => {
    const kinds = [
      'user_prompt',
      'user_command',
      'file_edit',
      'file_write',
      'file_read',
      'shell_command',
      'validation',
      'search',
      'failure',
      'approval',
      'compact_boundary',
      'tool_use',
    ] as const
    const markers = new Set(kinds.map(k => milestoneMarker(k)))
    expect(markers.size).toBeGreaterThanOrEqual(kinds.length - 2) // allow small overlap
  })

  it('returns palette hex tokens for state-bearing kinds', () => {
    // milestoneColor now sources hex values from the active theme's
    // palette (see src/theme/palette.ts) instead of Ink-named colors.
    // Assertion is loose: any hex string is acceptable so we don't
    // couple the test to specific theme values.
    const failure = milestoneColor('failure')
    const validation = milestoneColor('validation')
    const approval = milestoneColor('approval')
    expect(failure).toMatch(/^#[0-9a-f]{3,6}$/i)
    expect(validation).toMatch(/^#[0-9a-f]{3,6}$/i)
    expect(approval).toMatch(/^#[0-9a-f]{3,6}$/i)
    // Distinct mappings — failures, warnings, and approvals must not
    // collapse to the same token.
    expect(new Set([failure, validation, approval]).size).toBe(3)
  })
})

describe('Milestone type surface', () => {
  it('milestones carry messageIndex and uuid', () => {
    const msgs = [userPrompt('u1', 'hi')]
    const m: Milestone[] = buildSessionOutline(msgs)
    expect(m[0]?.messageIndex).toBe(0)
    expect(m[0]?.uuid).toBe('u1')
  })
})

import { describe, expect, it, vi } from 'vitest'

// We mock `getFileStatus` / `getChangedFiles` so these unit tests exercise
// pure logic (command filtering, risk extraction, suggestion building)
// without needing a real git repo or spawning `git` subprocesses.
vi.mock('../../../utils/git.js', () => ({
  getFileStatus: vi.fn(async () => ({ tracked: [], untracked: [] })),
  getChangedFiles: vi.fn(async () => []),
}))

import { getFileStatus } from '../../../utils/git.js'
import type { Message } from '../../../types/message.js'
import { buildHandoff } from '../handoffData.js'

function assistantWithTools(
  tools: Array<{ name: string; input: Record<string, unknown> }>,
): Message {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: tools.map(t => ({ type: 'tool_use', name: t.name, input: t.input })),
    },
  } as unknown as Message
}

function assistantWithText(text: string): Message {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  } as unknown as Message
}

describe('buildHandoff', () => {
  it('falls back to git status when no tool calls are observed', async () => {
    vi.mocked(getFileStatus).mockResolvedValueOnce({
      tracked: ['src/foo.ts'],
      untracked: ['new.md'],
    })

    const summary = await buildHandoff([])
    expect(summary.filesSource).toBe('git-status')
    expect(summary.changedFiles).toEqual([
      { path: 'src/foo.ts', status: 'M' },
      { path: 'new.md', status: '??' },
    ])
    expect(summary.validationCommands).toEqual([])
  })

  it('extracts edited files from Edit / Write tool calls', async () => {
    vi.mocked(getFileStatus).mockResolvedValueOnce({ tracked: [], untracked: [] })

    const messages: Message[] = [
      assistantWithTools([
        { name: 'Edit', input: { file_path: '/abs/a.ts' } },
        { name: 'Write', input: { file_path: '/abs/b.ts' } },
      ]),
    ]
    const summary = await buildHandoff(messages)
    expect(summary.filesSource).toBe('session')
    expect(summary.changedFiles.map(f => f.path)).toEqual([
      '/abs/a.ts',
      '/abs/b.ts',
    ])
    for (const f of summary.changedFiles) {
      expect(f.status).toBe('edited')
    }
  })

  it('merges git status entries not covered by tool calls', async () => {
    vi.mocked(getFileStatus).mockResolvedValueOnce({
      tracked: ['already-tracked.ts'],
      untracked: ['untracked.ts'],
    })

    const messages: Message[] = [
      assistantWithTools([{ name: 'Edit', input: { file_path: '/abs/a.ts' } }]),
    ]
    const summary = await buildHandoff(messages)
    expect(summary.filesSource).toBe('merged')
    expect(summary.changedFiles.map(f => f.path)).toEqual([
      '/abs/a.ts',
      'already-tracked.ts',
      'untracked.ts',
    ])
    expect(summary.changedFiles.find(f => f.path === 'untracked.ts')?.status).toBe('??')
  })

  it('keeps only validation-style Bash commands, preserves order, dedupes', async () => {
    vi.mocked(getFileStatus).mockResolvedValueOnce({ tracked: [], untracked: [] })

    const messages: Message[] = [
      assistantWithTools([
        { name: 'Bash', input: { command: 'ls -la' } },
        { name: 'Bash', input: { command: 'npm test' } },
        { name: 'Bash', input: { command: 'npx tsc --noEmit' } },
        { name: 'Bash', input: { command: 'echo hi' } },
        { name: 'Bash', input: { command: 'npm test' } },
      ]),
    ]
    const summary = await buildHandoff(messages)
    expect(summary.validationCommands).toEqual(['npm test', 'npx tsc --noEmit'])
  })

  it('extracts TODO/FIXME markers only from assistant text (not user text)', async () => {
    vi.mocked(getFileStatus).mockResolvedValueOnce({ tracked: [], untracked: [] })

    const messages: Message[] = [
      {
        type: 'user',
        message: { role: 'user', content: 'TODO: user mentioned a todo here' },
      } as unknown as Message,
      assistantWithText(
        'I left a TODO: wire up the retry path.\nAlso FIXME: handle the 429 case.',
      ),
    ]
    const summary = await buildHandoff(messages)
    expect(summary.unresolvedRisks.length).toBeGreaterThan(0)
    const joined = summary.unresolvedRisks.join('\n')
    expect(joined).toMatch(/TODO: wire up the retry path/)
    expect(joined).toMatch(/FIXME: handle the 429 case/)
    expect(joined).not.toMatch(/user mentioned a todo here/)
  })

  it('always returns at least one suggested next action', async () => {
    vi.mocked(getFileStatus).mockResolvedValueOnce({ tracked: [], untracked: [] })

    const summary = await buildHandoff([])
    expect(summary.suggestedNextActions.length).toBeGreaterThan(0)
  })

  it('suggests running validation when changes exist but no validation command was observed', async () => {
    vi.mocked(getFileStatus).mockResolvedValueOnce({ tracked: [], untracked: [] })

    const messages: Message[] = [
      assistantWithTools([{ name: 'Edit', input: { file_path: '/abs/a.ts' } }]),
    ]
    const summary = await buildHandoff(messages)
    expect(
      summary.suggestedNextActions.some(a => /typecheck|test/i.test(a)),
    ).toBe(true)
  })
})

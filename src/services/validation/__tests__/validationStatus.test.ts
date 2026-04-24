/**
 * Tests for validationStatus — classification of bash commands + end-to-end
 * derivation of the latest validation record from a transcript.
 */

import { describe, expect, it } from 'vitest'
import type { Message } from '../../../types/message.js'
import {
  classifyCommand,
  getAllValidations,
  getLatestValidation,
  truncateCommand,
} from '../validationStatus.js'

describe('classifyCommand', () => {
  it('classifies typecheck commands', () => {
    expect(classifyCommand('tsc --noEmit')).toBe('typecheck')
    expect(classifyCommand('pnpm typecheck')).toBe('typecheck')
    expect(classifyCommand('npm run type-check')).toBe('typecheck')
    expect(classifyCommand('pyright .')).toBe('typecheck')
    expect(classifyCommand('go vet ./...')).toBe('typecheck')
  })

  it('classifies lint commands', () => {
    expect(classifyCommand('oxlint')).toBe('lint')
    expect(classifyCommand('eslint src/')).toBe('lint')
    expect(classifyCommand('npm run lint')).toBe('lint')
    expect(classifyCommand('biome check .')).toBe('lint')
    expect(classifyCommand('ruff check src')).toBe('lint')
  })

  it('classifies test commands', () => {
    expect(classifyCommand('vitest run')).toBe('test')
    expect(classifyCommand('jest --watch')).toBe('test')
    expect(classifyCommand('pytest')).toBe('test')
    expect(classifyCommand('go test ./...')).toBe('test')
    expect(classifyCommand('npm test')).toBe('test')
    expect(classifyCommand('pnpm run test:unit')).toBe('test')
  })

  it('classifies build commands', () => {
    expect(classifyCommand('vite build')).toBe('build')
    expect(classifyCommand('cargo build --release')).toBe('build')
    expect(classifyCommand('npm run build')).toBe('build')
    expect(classifyCommand('make build')).toBe('build')
  })

  it('classifies only the last segment in && chains', () => {
    expect(classifyCommand('pnpm install && pnpm typecheck')).toBe('typecheck')
    expect(classifyCommand('rm -rf dist; vite build')).toBe('build')
  })

  it('returns null for non-validation commands', () => {
    expect(classifyCommand('ls -la')).toBeNull()
    expect(classifyCommand('git status')).toBeNull()
    expect(classifyCommand('cat README.md')).toBeNull()
  })
})

describe('truncateCommand', () => {
  it('preserves short commands unchanged', () => {
    expect(truncateCommand('tsc')).toBe('tsc')
    expect(truncateCommand('npm test')).toBe('npm test')
  })

  it('truncates from the head, preserving the meaningful tail', () => {
    const long =
      'pnpm --filter=some-app run something --with --a --bunch --of --args'
    const out = truncateCommand(long, 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out.startsWith('...')).toBe(true)
    expect(long.endsWith(out.slice(3))).toBe(true)
  })

  it('collapses whitespace', () => {
    expect(truncateCommand('tsc\t\t  --noEmit')).toBe('tsc --noEmit')
  })
})

/** Build a minimal assistant Bash tool_use message shape. */
function bashCall(opts: {
  uuid: string
  toolUseId: string
  command: string
  timestamp?: number
}): Message {
  return {
    type: 'assistant',
    uuid: opts.uuid,
    timestamp: opts.timestamp,
    message: {
      content: [
        {
          type: 'tool_use',
          id: opts.toolUseId,
          name: 'Bash',
          input: { command: opts.command },
        },
      ],
    },
  } as Message
}

/** Build a minimal tool_result user message. */
function bashResult(opts: {
  uuid: string
  toolUseId: string
  isError?: boolean
  exitCode?: number
  stdout?: string
  stderr?: string
}): Message {
  return {
    type: 'user',
    uuid: opts.uuid,
    toolUseResult: {
      stdout: opts.stdout,
      stderr: opts.stderr,
      exitCode: opts.exitCode,
      is_error: opts.isError,
    },
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: opts.toolUseId,
          is_error: opts.isError ?? false,
          content: opts.stdout ?? opts.stderr ?? '',
        },
      ],
    },
  } as Message
}

describe('getLatestValidation', () => {
  it('returns null on empty transcript', () => {
    expect(getLatestValidation([])).toBeNull()
  })

  it('returns null when no validation commands were run', () => {
    const messages: Message[] = [
      bashCall({ uuid: 'u1', toolUseId: 't1', command: 'ls -la' }),
      bashResult({ uuid: 'u2', toolUseId: 't1', stdout: '...' }),
    ]
    expect(getLatestValidation(messages)).toBeNull()
  })

  it('picks up a completed typecheck pass', () => {
    const messages: Message[] = [
      bashCall({ uuid: 'u1', toolUseId: 't1', command: 'tsc --noEmit' }),
      bashResult({ uuid: 'u2', toolUseId: 't1', exitCode: 0, stdout: '' }),
    ]
    const rec = getLatestValidation(messages)
    expect(rec).not.toBeNull()
    expect(rec?.kind).toBe('typecheck')
    expect(rec?.state).toBe('pass')
    expect(rec?.toolResultUuid).toBe('u2')
  })

  it('marks a failing exit code as fail', () => {
    const messages: Message[] = [
      bashCall({ uuid: 'u1', toolUseId: 't1', command: 'npm test' }),
      bashResult({
        uuid: 'u2',
        toolUseId: 't1',
        exitCode: 1,
        stderr: 'FAIL something',
      }),
    ]
    const rec = getLatestValidation(messages)
    expect(rec?.kind).toBe('test')
    expect(rec?.state).toBe('fail')
    expect(rec?.summary).toContain('FAIL something')
  })

  it('returns running state when no matching tool_result yet', () => {
    const messages: Message[] = [
      bashCall({ uuid: 'u1', toolUseId: 't1', command: 'vite build' }),
    ]
    const rec = getLatestValidation(messages)
    expect(rec?.kind).toBe('build')
    expect(rec?.state).toBe('running')
    expect(rec?.toolResultUuid).toBeUndefined()
  })

  it('prefers the most recent validation run', () => {
    const messages: Message[] = [
      bashCall({ uuid: 'u1', toolUseId: 't1', command: 'tsc' }),
      bashResult({ uuid: 'u2', toolUseId: 't1', exitCode: 0 }),
      bashCall({ uuid: 'u3', toolUseId: 't2', command: 'oxlint' }),
      bashResult({
        uuid: 'u4',
        toolUseId: 't2',
        exitCode: 1,
        stderr: 'lint error',
      }),
    ]
    const rec = getLatestValidation(messages)
    expect(rec?.kind).toBe('lint')
    expect(rec?.state).toBe('fail')
  })

  it('ignores non-Bash tool_use entries', () => {
    const messages: Message[] = [
      {
        type: 'assistant',
        uuid: 'x1',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tX',
              name: 'Read',
              input: { file_path: '/tmp/typecheck.md' },
            },
          ],
        },
      } as Message,
    ]
    expect(getLatestValidation(messages)).toBeNull()
  })

  it('detects is_error on tool_result block when no exitCode', () => {
    const messages: Message[] = [
      bashCall({ uuid: 'u1', toolUseId: 't1', command: 'pytest' }),
      bashResult({
        uuid: 'u2',
        toolUseId: 't1',
        isError: true,
        stdout: 'E assert False',
      }),
    ]
    const rec = getLatestValidation(messages)
    expect(rec?.state).toBe('fail')
  })
})

describe('getAllValidations', () => {
  it('returns empty array on empty transcript', () => {
    expect(getAllValidations([])).toEqual([])
  })

  it('returns records most-recent first', () => {
    const messages: Message[] = [
      bashCall({ uuid: 'u1', toolUseId: 't1', command: 'tsc --noEmit' }),
      bashResult({ uuid: 'u2', toolUseId: 't1', exitCode: 0 }),
      bashCall({ uuid: 'u3', toolUseId: 't2', command: 'vitest run' }),
      bashResult({ uuid: 'u4', toolUseId: 't2', exitCode: 1 }),
    ]
    const recs = getAllValidations(messages)
    expect(recs).toHaveLength(2)
    expect(recs[0]?.kind).toBe('test')
    expect(recs[0]?.state).toBe('fail')
    expect(recs[1]?.kind).toBe('typecheck')
    expect(recs[1]?.state).toBe('pass')
  })

  it('respects the limit', () => {
    const messages: Message[] = []
    for (let i = 0; i < 5; i++) {
      messages.push(
        bashCall({ uuid: `u${i}`, toolUseId: `t${i}`, command: 'vitest run' }),
      )
      messages.push(bashResult({ uuid: `r${i}`, toolUseId: `t${i}`, exitCode: 0 }))
    }
    expect(getAllValidations(messages, { limit: 3 })).toHaveLength(3)
  })

  it('marks still-running when no matching tool_result follows', () => {
    const messages: Message[] = [
      bashCall({ uuid: 'u1', toolUseId: 't1', command: 'pnpm test' }),
    ]
    const [rec] = getAllValidations(messages)
    expect(rec?.state).toBe('running')
  })
})

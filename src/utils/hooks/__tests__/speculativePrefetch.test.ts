import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PREFETCH_COMMANDS,
  DEFAULT_PREFETCH_TIMEOUT_MS,
  formatPrefetchBlock,
  isGitRepo,
  runSpeculativePrefetch,
} from '../speculativePrefetch.js'

function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('speculativePrefetch', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkTmp('prefetch-test-')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('isGitRepo', () => {
    it('returns false for a non-git directory', () => {
      expect(isGitRepo(tmpDir)).toBe(false)
    })

    it('returns true when .git is a directory', () => {
      mkdirSync(join(tmpDir, '.git'))
      expect(isGitRepo(tmpDir)).toBe(true)
    })

    it('returns true when .git is a file (submodule/worktree)', () => {
      writeFileSync(join(tmpDir, '.git'), 'gitdir: ../other/.git/worktrees/foo')
      expect(isGitRepo(tmpDir)).toBe(true)
    })

    it('returns false for a nonexistent path', () => {
      expect(isGitRepo(join(tmpDir, 'does-not-exist'))).toBe(false)
    })
  })

  describe('runSpeculativePrefetch', () => {
    it('returns null when settings are undefined', async () => {
      const result = await runSpeculativePrefetch(tmpDir, undefined)
      expect(result).toBeNull()
    })

    it('returns null when enabled is false', async () => {
      const result = await runSpeculativePrefetch(tmpDir, { enabled: false })
      expect(result).toBeNull()
    })

    it('returns null when enabled but cwd is not a git repo', async () => {
      const result = await runSpeculativePrefetch(tmpDir, { enabled: true })
      expect(result).toBeNull()
    })

    it('runs custom commands and formats output in a git repo', async () => {
      mkdirSync(join(tmpDir, '.git'))
      const result = await runSpeculativePrefetch(tmpDir, {
        enabled: true,
        commands: ['echo hello', 'echo world'],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('<speculative-prefetch>')
      expect(result).toContain('$ echo hello')
      expect(result).toContain('hello')
      expect(result).toContain('$ echo world')
      expect(result).toContain('world')
      expect(result).toContain('</speculative-prefetch>')
    })

    it('preserves command order in the output regardless of completion order', async () => {
      mkdirSync(join(tmpDir, '.git'))
      // 'sleep 0.05; echo slow' finishes after 'echo fast'. The block must
      // still list `slow` first because it was first in the command array.
      const result = await runSpeculativePrefetch(tmpDir, {
        enabled: true,
        commands: ['sh -c "sleep 0.05; echo slow"', 'echo fast'],
      })
      expect(result).not.toBeNull()
      const slowIdx = result!.indexOf('slow')
      const fastIdx = result!.indexOf('fast')
      expect(slowIdx).toBeGreaterThan(-1)
      expect(fastIdx).toBeGreaterThan(slowIdx)
    })

    it('drops a command that exceeds its per-command timeout', async () => {
      mkdirSync(join(tmpDir, '.git'))
      const result = await runSpeculativePrefetch(tmpDir, {
        enabled: true,
        commands: ['echo done', 'sleep 2'],
        timeoutMs: 100,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('done')
      // sleep 2 should be timed out and omitted from the output entirely
      expect(result).not.toContain('$ sleep 2')
    })

    it('returns null when every command fails', async () => {
      mkdirSync(join(tmpDir, '.git'))
      const result = await runSpeculativePrefetch(tmpDir, {
        enabled: true,
        commands: ['false', 'exit 1'],
        timeoutMs: 1000,
      })
      expect(result).toBeNull()
    })

    it('drops stderr and keeps stdout for the same command', async () => {
      mkdirSync(join(tmpDir, '.git'))
      // Write the script to disk so the command string itself doesn't
      // contain the secret word — we're testing that stderr from the
      // spawned process is dropped, not that the command line is sanitized.
      const scriptPath = join(tmpDir, 'leak.sh')
      writeFileSync(scriptPath, '#!/bin/sh\necho visible\necho ZZLEAKED >&2\n')
      const { chmodSync } = await import('node:fs')
      chmodSync(scriptPath, 0o755)
      const result = await runSpeculativePrefetch(tmpDir, {
        enabled: true,
        commands: [scriptPath],
      })
      expect(result).toContain('visible')
      expect(result).not.toContain('ZZLEAKED')
    })

    it('renders an empty-stdout successful command as "(no output)"', async () => {
      mkdirSync(join(tmpDir, '.git'))
      const result = await runSpeculativePrefetch(tmpDir, {
        enabled: true,
        commands: ['true'],
      })
      expect(result).toContain('(no output)')
    })

    it('uses the default command list when commands is omitted', async () => {
      // Initialize a real git repo so the default commands succeed.
      const { execSync } = await import('node:child_process')
      execSync('git init -q', { cwd: tmpDir })
      execSync('git -c user.email=a@b.c -c user.name=t commit --allow-empty -m init -q', {
        cwd: tmpDir,
      })
      const result = await runSpeculativePrefetch(tmpDir, { enabled: true })
      expect(result).not.toBeNull()
      // At least one of the default commands should appear as a header.
      const appearedCommands = DEFAULT_PREFETCH_COMMANDS.filter(c =>
        result!.includes(`$ ${c}`),
      )
      expect(appearedCommands.length).toBeGreaterThan(0)
    })
  })

  describe('formatPrefetchBlock', () => {
    it('returns null when no commands succeeded', () => {
      expect(
        formatPrefetchBlock([
          { command: 'a', stdout: '', ok: false },
          { command: 'b', stdout: '', ok: false },
        ]),
      ).toBeNull()
    })

    it('skips failed commands but keeps successful ones', () => {
      const out = formatPrefetchBlock([
        { command: 'good', stdout: 'hi', ok: true },
        { command: 'bad', stdout: '', ok: false },
      ])
      expect(out).toContain('$ good')
      expect(out).toContain('hi')
      expect(out).not.toContain('$ bad')
    })
  })

  describe('constants', () => {
    it('ships sensible defaults', () => {
      expect(DEFAULT_PREFETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(1000)
      expect(DEFAULT_PREFETCH_COMMANDS.length).toBeGreaterThan(0)
      for (const c of DEFAULT_PREFETCH_COMMANDS) {
        expect(c.startsWith('git ')).toBe(true)
      }
    })
  })
})

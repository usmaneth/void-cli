/**
 * Smoke test: `bin/void --help` must exit 0.
 *
 * This is the simplest possible regression guard — if Void can no longer
 * print --help, something in the import graph or entrypoint wiring is broken
 * and every downstream test is meaningless.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')
const bin = resolve(repoRoot, 'bin', 'void')

describe('bin/void smoke test', () => {
  it('bin/void exists and is executable', () => {
    expect(existsSync(bin)).toBe(true)
  })

  it('prints help and exits 0', () => {
    const result = spawnSync(bin, ['--help'], {
      encoding: 'utf-8',
      timeout: 30_000,
      // --help must not require credentials. Scrub auth env vars so this
      // passes on a clean CI machine.
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: '',
        VOID_SIMPLE: '1',
      },
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    const output = `${result.stdout}\n${result.stderr}`
    // Be loose about phrasing — just require some recognisable help text.
    expect(output.toLowerCase()).toMatch(/usage|command|options|help/)
  })
})

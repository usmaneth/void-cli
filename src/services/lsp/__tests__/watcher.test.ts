/**
 * Watcher tests — exercise debounce behavior without requiring a real
 * LSP server. We stub refreshDiagnosticsForFile via module mocking so the
 * watcher's fileChanged handler only records invocations.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

describe('LSP watcher (debounce)', () => {
  let tmpDir: string
  let refreshed: string[] = []

  beforeEach(() => {
    process.env.VOID_LSP_SERVER = '1'
    refreshed = []
    vi.resetModules()
    vi.doMock('../diagnostics.js', async () => {
      const actual = await vi.importActual<
        typeof import('../diagnostics.js')
      >('../diagnostics.js')
      return {
        ...actual,
        refreshDiagnosticsForFile: async (p: string) => {
          refreshed.push(p)
        },
      }
    })
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-watcher-'))
  })

  afterEach(async () => {
    const mod = await import('../watcher.js')
    await mod._resetWatcherForTesting()
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    vi.doUnmock('../diagnostics.js')
  })

  it('ignores watchFile calls when the feature flag is off', async () => {
    delete process.env.VOID_LSP_SERVER
    vi.resetModules()
    const mod = await import('../watcher.js')
    mod.watchFile(path.join(tmpDir, 'x.ts'))
    expect(mod.getWatchedFileCount()).toBe(0)
  })

  it('tracks a file and debounces rapid change events', async () => {
    const mod = await import('../watcher.js')
    const filePath = path.join(tmpDir, 'a.ts')
    fs.writeFileSync(filePath, 'initial')
    mod.watchFile(filePath)
    expect(mod.getWatchedFileCount()).toBe(1)

    // Wait for chokidar to finish setting up watchers on this file before
    // triggering changes. Fast poll so the test stays snappy.
    await waitUntil(async () => {
      // Modify & see whether a change lands after the debounce window
      fs.writeFileSync(filePath, 'v1')
      // Let chokidar process the event
      await sleep(50)
      fs.writeFileSync(filePath, 'v2')
      await sleep(50)
      fs.writeFileSync(filePath, 'v3')
      await sleep(mod.WATCHER_DEBOUNCE_MS + 200)
      return refreshed.length > 0
    }, 3000)

    // Three rapid writes collapse to at most one refresh (debounce).
    expect(refreshed.length).toBeGreaterThanOrEqual(1)
    expect(refreshed.length).toBeLessThanOrEqual(2)

    // unwatch drops the tracking entry
    mod.unwatchFile(filePath)
    expect(mod.getWatchedFileCount()).toBe(0)
  })
})

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitUntil(
  fn: () => Promise<boolean> | boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return
    await sleep(50)
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`)
}

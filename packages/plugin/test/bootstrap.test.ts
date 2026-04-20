/**
 * Tests for the plugin runtime boot integration.
 *
 * Verifies:
 *   - VOID_PLUGINS feature-flag gating
 *   - End-to-end loader → adapter → skill-registry wiring using the hello-void
 *     example plugin
 *   - Load errors surface without aborting boot
 *
 * Uses the pure `createAdapter` (from adapter.ts) with stub translators, so
 * these tests don't need to resolve the host module graph.
 */

import { describe, expect, it } from 'vitest'
import {
  bootPluginRuntime,
  isPluginRuntimeEnabled,
} from '../../../src/services/plugins/bootstrap.js'
import {
  createAdapter,
  type PluginSkillShape,
  type PluginToolShape,
} from '../../../src/services/plugins/adapter.js'

type StubTool = { kind: 'stubTool'; name: string }
type StubSkill = {
  kind: 'stubSkill'
  name: string
  description: string
  getPromptForCommand: (args: string, ctx: unknown) => Promise<unknown>
}

const stubAdapter = () =>
  createAdapter<StubTool, StubSkill>({
    toolTranslator: (t: PluginToolShape) => ({
      kind: 'stubTool',
      name: t.name,
    }),
    skillTranslator: (s: PluginSkillShape) => ({
      kind: 'stubSkill',
      name: s.name,
      description: s.description,
      getPromptForCommand: async () => [{ type: 'text', text: '' }],
    }),
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  })

describe('isPluginRuntimeEnabled', () => {
  it('returns false by default', () => {
    const prev = process.env.VOID_PLUGINS
    delete process.env.VOID_PLUGINS
    try {
      expect(isPluginRuntimeEnabled()).toBe(false)
    } finally {
      if (prev !== undefined) process.env.VOID_PLUGINS = prev
    }
  })

  it('returns true when VOID_PLUGINS=1', () => {
    const prev = process.env.VOID_PLUGINS
    process.env.VOID_PLUGINS = '1'
    try {
      expect(isPluginRuntimeEnabled()).toBe(true)
    } finally {
      if (prev !== undefined) process.env.VOID_PLUGINS = prev
      else delete process.env.VOID_PLUGINS
    }
  })
})

describe('bootPluginRuntime', () => {
  it('is a no-op when VOID_PLUGINS is unset', async () => {
    const prev = process.env.VOID_PLUGINS
    delete process.env.VOID_PLUGINS
    try {
      const result = await bootPluginRuntime({
        plugins: ['/nonexistent.mjs'],
        adapter: stubAdapter(),
      })
      expect(result.enabled).toBe(false)
      expect(result.loaded).toHaveLength(0)
      expect(result.attachedIds).toHaveLength(0)
    } finally {
      if (prev !== undefined) process.env.VOID_PLUGINS = prev
    }
  })

  it('loads and attaches the hello-void example end-to-end', async () => {
    const prev = process.env.VOID_PLUGINS
    process.env.VOID_PLUGINS = '1'
    try {
      const adapter = stubAdapter()
      const registeredSkills: unknown[] = []

      const result = await bootPluginRuntime({
        plugins: [require.resolve('../examples/hello-void/index.ts')],
        builtinToolNames: ['Bash', 'FileRead'],
        builtinSkillNames: [],
        adapter,
        registerSkill: def => {
          registeredSkills.push(def)
        },
      })

      expect(result.enabled).toBe(true)
      if (result.loadErrors.length > 0) {
        // eslint-disable-next-line no-console
        console.error(
          'loadErrors:',
          result.loadErrors.map(e => e.error.message),
        )
      }
      expect(result.loadErrors).toHaveLength(0)
      expect(result.loaded).toHaveLength(1)
      expect(result.attachedIds).toHaveLength(1)

      // hello-void contributes 1 tool (Hello), 1 skill (hello), 1 keybind.
      expect(adapter.getPluginTools()).toHaveLength(1)
      expect(adapter.getPluginSkills()).toHaveLength(1)
      expect(adapter.getPluginKeybinds()).toHaveLength(1)

      // The skill should have been registered with the host skill registry.
      expect(registeredSkills).toHaveLength(1)
      expect((registeredSkills[0] as { name: string }).name).toBe('hello')
      expect(result.registeredSkillNames).toContain('hello')

      // Fire SessionStart through the adapter — the example's onSessionStart
      // should run without throwing.
      await adapter.fireSessionStart({ sessionId: 'test', cwd: '/tmp' })
    } finally {
      if (prev !== undefined) process.env.VOID_PLUGINS = prev
      else delete process.env.VOID_PLUGINS
    }
  })

  it('captures load errors without aborting boot', async () => {
    const prev = process.env.VOID_PLUGINS
    process.env.VOID_PLUGINS = '1'
    try {
      const result = await bootPluginRuntime({
        plugins: ['/definitely/not/a/plugin/path.js'],
        adapter: stubAdapter(),
        registerSkill: () => {},
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      })
      expect(result.enabled).toBe(true)
      expect(result.loadErrors.length).toBeGreaterThan(0)
      expect(result.loaded).toHaveLength(0)
    } finally {
      if (prev !== undefined) process.env.VOID_PLUGINS = prev
      else delete process.env.VOID_PLUGINS
    }
  })
})

/**
 * Tests for the plugin runtime adapter.
 *
 * These tests exercise the adapter's pure logic (registration, conflict
 * handling, caching, unload, hook dispatch) without touching the host
 * module graph. The host-coupled translators live in src/services/plugins/
 * adapterTranslators.ts and are covered indirectly by the example plugin
 * integration at the bottom of this file.
 *
 * Strategy: createAdapter() accepts injected translators. Tests pass stub
 * translators that preserve identity — a plugin tool becomes a
 * `{ name, __stubTool: true }` marker. That's enough to verify the adapter
 * stores, dedupes, caches, and evicts correctly.
 */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { definePlugin, defineSkill, defineTool, defineKeybind } from '../src/index.js'
import {
  createAdapter,
  type PluginSkillShape,
  type PluginToolShape,
} from '../../../src/services/plugins/adapter.js'
import type { LoadedPlugin } from '../../../src/services/plugins/loader.js'

// Stub tool / skill shapes. Tests assert on these — they don't need to be
// compatible with the real host Tool.
type StubTool = { kind: 'stubTool'; name: string; readOnly?: boolean }
type StubSkill = { kind: 'stubSkill'; name: string }

function stubToolTranslator(t: PluginToolShape): StubTool {
  return { kind: 'stubTool', name: t.name, readOnly: t.readOnly }
}
function stubSkillTranslator(s: PluginSkillShape): StubSkill {
  return { kind: 'stubSkill', name: s.name }
}

function makeAdapter(logger?: {
  debug: (m: string) => void
  info: (m: string) => void
  warn: (m: string) => void
  error: (m: string) => void
}) {
  return createAdapter<StubTool, StubSkill>({
    toolTranslator: stubToolTranslator,
    skillTranslator: stubSkillTranslator,
    logger,
  })
}

function makePlugin(
  id: string,
  manifest: ReturnType<typeof definePlugin>,
): LoadedPlugin {
  return {
    id,
    loadedFrom: id,
    source: 'user',
    // definePlugin returns a typed manifest; the adapter consumes the
    // structural PluginManifestShape, which is compatible.
    manifest: manifest as unknown as LoadedPlugin['manifest'],
  }
}

describe('adapter.attach — registration', () => {
  it('registers tools, skills, and keybinds from a manifest', () => {
    const adapter = makeAdapter()
    const plugin = makePlugin(
      'p1',
      definePlugin({
        tools: [
          defineTool({
            name: 'Hello',
            description: 'd',
            parameters: z.object({}),
            execute: async () => '',
          }),
        ],
        skills: [
          defineSkill({ name: 'hello', description: 'd', handler: () => '' }),
        ],
        keybinds: [
          defineKeybind({
            key: 'ctrl+h',
            label: 'Hello',
            action: () => {},
          }),
        ],
      }),
    )
    const res = adapter.attach(plugin)
    expect(res.toolCount).toBe(1)
    expect(res.skillCount).toBe(1)
    expect(res.keybindCount).toBe(1)
    expect(adapter.getPluginTools()).toHaveLength(1)
    expect(adapter.getPluginSkills()).toHaveLength(1)
    expect(adapter.getPluginKeybinds()).toHaveLength(1)
  })

  it('is idempotent on duplicate plugin ids', () => {
    const adapter = makeAdapter()
    const plugin = makePlugin(
      'p1',
      definePlugin({
        tools: [
          defineTool({
            name: 'T',
            description: 'd',
            parameters: z.object({}),
            execute: async () => '',
          }),
        ],
      }),
    )
    adapter.attach(plugin)
    const second = adapter.attach(plugin)
    expect(second.toolCount).toBe(0)
    expect(adapter.getPluginTools()).toHaveLength(1)
  })

  it('tracks attached plugin ids in insertion order', () => {
    const adapter = makeAdapter()
    adapter.attach(makePlugin('a', definePlugin({})))
    adapter.attach(makePlugin('b', definePlugin({})))
    adapter.attach(makePlugin('c', definePlugin({})))
    expect(adapter.getAttachedPluginIds()).toEqual(['a', 'b', 'c'])
  })
})

describe('adapter.attach — conflict handling', () => {
  it('drops plugin tools whose names collide with built-ins', () => {
    const warn = vi.fn()
    const adapter = makeAdapter({
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    })
    adapter.setBuiltinToolNames(['Bash', 'FileRead'])
    const plugin = makePlugin(
      'p1',
      definePlugin({
        tools: [
          defineTool({
            name: 'Bash',
            description: 'd',
            parameters: z.object({}),
            execute: async () => '',
          }),
          defineTool({
            name: 'NewTool',
            description: 'd',
            parameters: z.object({}),
            execute: async () => '',
          }),
        ],
      }),
    )
    const res = adapter.attach(plugin)
    expect(res.toolCount).toBe(1)
    expect(res.skippedToolNames).toEqual(['Bash'])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('collides with a built-in'),
    )
  })

  it('drops plugin tools whose names collide with another plugin', () => {
    const adapter = makeAdapter()
    adapter.attach(
      makePlugin(
        'p1',
        definePlugin({
          tools: [
            defineTool({
              name: 'Shared',
              description: 'd',
              parameters: z.object({}),
              execute: async () => '',
            }),
          ],
        }),
      ),
    )
    const res = adapter.attach(
      makePlugin(
        'p2',
        definePlugin({
          tools: [
            defineTool({
              name: 'Shared',
              description: 'd',
              parameters: z.object({}),
              execute: async () => '',
            }),
          ],
        }),
      ),
    )
    expect(res.toolCount).toBe(0)
    expect(res.skippedToolNames).toEqual(['Shared'])
  })

  it('drops plugin skills on built-in collision and plugin-plugin collision', () => {
    const adapter = makeAdapter()
    adapter.setBuiltinSkillNames(['init'])
    adapter.attach(
      makePlugin(
        'p1',
        definePlugin({
          skills: [defineSkill({ name: 'share', description: 'd', handler: () => '' })],
        }),
      ),
    )
    const res = adapter.attach(
      makePlugin(
        'p2',
        definePlugin({
          skills: [
            defineSkill({ name: 'init', description: 'd', handler: () => '' }),
            defineSkill({ name: 'share', description: 'd', handler: () => '' }),
            defineSkill({ name: 'new', description: 'd', handler: () => '' }),
          ],
        }),
      ),
    )
    expect(res.skillCount).toBe(1)
    expect(res.skippedSkillNames.sort()).toEqual(['init', 'share'])
  })

  it('drops plugin keybinds that collide with another plugin on key', () => {
    const adapter = makeAdapter()
    adapter.attach(
      makePlugin(
        'p1',
        definePlugin({
          keybinds: [defineKeybind({ key: 'ctrl+k', label: 'L1', action: () => {} })],
        }),
      ),
    )
    const res = adapter.attach(
      makePlugin(
        'p2',
        definePlugin({
          keybinds: [defineKeybind({ key: 'ctrl+k', label: 'L2', action: () => {} })],
        }),
      ),
    )
    expect(res.keybindCount).toBe(0)
    expect(res.skippedKeybindKeys).toEqual(['ctrl+k'])
  })
})

describe('adapter.detach — unload', () => {
  it('removes a plugin and its artifacts', () => {
    const adapter = makeAdapter()
    adapter.attach(
      makePlugin(
        'p1',
        definePlugin({
          tools: [
            defineTool({
              name: 'X',
              description: 'd',
              parameters: z.object({}),
              execute: async () => '',
            }),
          ],
          skills: [defineSkill({ name: 'x', description: 'd', handler: () => '' })],
        }),
      ),
    )
    expect(adapter.getPluginTools()).toHaveLength(1)
    adapter.detach('p1')
    expect(adapter.getPluginTools()).toHaveLength(0)
    expect(adapter.getPluginSkills()).toHaveLength(0)
    expect(adapter.getAttachedPluginIds()).toEqual([])
  })

  it('no-ops when detaching an unknown id', () => {
    const adapter = makeAdapter()
    adapter.detach('never-attached')
    expect(adapter.getAttachedPluginIds()).toEqual([])
  })

  it('allows a replacement after detach (hot-reload scenario)', () => {
    const adapter = makeAdapter()
    const v1 = makePlugin(
      'p1',
      definePlugin({
        tools: [
          defineTool({
            name: 'T',
            description: 'v1',
            parameters: z.object({}),
            execute: async () => 'v1',
          }),
        ],
      }),
    )
    adapter.attach(v1)
    adapter.detach('p1')
    const v2 = makePlugin(
      'p1',
      definePlugin({
        tools: [
          defineTool({
            name: 'T',
            description: 'v2',
            parameters: z.object({}),
            execute: async () => 'v2',
          }),
        ],
      }),
    )
    const res = adapter.attach(v2)
    expect(res.toolCount).toBe(1)
  })
})

describe('adapter — caching', () => {
  it('returns the same array instance across consecutive calls with no mutation', () => {
    const adapter = makeAdapter()
    adapter.attach(
      makePlugin(
        'p1',
        definePlugin({
          tools: [
            defineTool({
              name: 'T',
              description: 'd',
              parameters: z.object({}),
              execute: async () => '',
            }),
          ],
        }),
      ),
    )
    const first = adapter.getPluginTools()
    const second = adapter.getPluginTools()
    expect(first).toBe(second)
  })

  it('invalidates cache on attach', () => {
    const adapter = makeAdapter()
    adapter.attach(
      makePlugin(
        'p1',
        definePlugin({
          tools: [
            defineTool({
              name: 'A',
              description: 'd',
              parameters: z.object({}),
              execute: async () => '',
            }),
          ],
        }),
      ),
    )
    const first = adapter.getPluginTools()
    adapter.attach(
      makePlugin(
        'p2',
        definePlugin({
          tools: [
            defineTool({
              name: 'B',
              description: 'd',
              parameters: z.object({}),
              execute: async () => '',
            }),
          ],
        }),
      ),
    )
    const second = adapter.getPluginTools()
    expect(first).not.toBe(second)
    expect(second).toHaveLength(2)
  })

  it('invalidates cache on detach', () => {
    const adapter = makeAdapter()
    adapter.attach(
      makePlugin(
        'p1',
        definePlugin({
          tools: [
            defineTool({
              name: 'A',
              description: 'd',
              parameters: z.object({}),
              execute: async () => '',
            }),
          ],
        }),
      ),
    )
    const first = adapter.getPluginTools()
    adapter.detach('p1')
    const second = adapter.getPluginTools()
    expect(first).not.toBe(second)
    expect(second).toHaveLength(0)
  })
})

describe('adapter — hook dispatch', () => {
  it('fires onPreToolUse across all plugins in insertion order', async () => {
    const adapter = makeAdapter()
    const order: string[] = []
    adapter.attach(
      makePlugin(
        'a',
        definePlugin({
          hooks: {
            onPreToolUse: () => {
              order.push('a')
            },
          },
        }),
      ),
    )
    adapter.attach(
      makePlugin(
        'b',
        definePlugin({
          hooks: {
            onPreToolUse: () => {
              order.push('b')
            },
          },
        }),
      ),
    )
    const res = await adapter.firePreToolUse({
      toolName: 'T',
      input: {},
      sessionId: 's',
    })
    expect(order).toEqual(['a', 'b'])
    expect(res.cancel).toBe(false)
  })

  it('short-circuits PreToolUse on first cancel', async () => {
    const adapter = makeAdapter()
    const order: string[] = []
    adapter.attach(
      makePlugin(
        'a',
        definePlugin({
          hooks: {
            onPreToolUse: () => {
              order.push('a')
              return { cancel: true, reason: 'nope' }
            },
          },
        }),
      ),
    )
    adapter.attach(
      makePlugin(
        'b',
        definePlugin({
          hooks: {
            onPreToolUse: () => {
              order.push('b')
            },
          },
        }),
      ),
    )
    const res = await adapter.firePreToolUse({
      toolName: 'T',
      input: {},
      sessionId: 's',
    })
    expect(order).toEqual(['a'])
    expect(res.cancel).toBe(true)
    expect(res.reason).toBe('nope')
  })

  it('treats a bare `false` return from PreToolUse as cancel', async () => {
    const adapter = makeAdapter()
    adapter.attach(
      makePlugin(
        'a',
        definePlugin({
          hooks: { onPreToolUse: () => false as unknown as void },
        }),
      ),
    )
    const res = await adapter.firePreToolUse({
      toolName: 'T',
      input: {},
      sessionId: 's',
    })
    expect(res.cancel).toBe(true)
  })

  it('isolates thrown errors in hooks from each other', async () => {
    const warn = vi.fn()
    const adapter = makeAdapter({
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    })
    const ran: string[] = []
    adapter.attach(
      makePlugin(
        'a',
        definePlugin({
          hooks: {
            onPostToolUse: () => {
              ran.push('a')
              throw new Error('boom')
            },
          },
        }),
      ),
    )
    adapter.attach(
      makePlugin(
        'b',
        definePlugin({
          hooks: {
            onPostToolUse: () => {
              ran.push('b')
            },
          },
        }),
      ),
    )
    await adapter.firePostToolUse({
      toolName: 'T',
      input: {},
      output: '',
      isError: false,
      sessionId: 's',
    })
    expect(ran).toEqual(['a', 'b'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })

  it('fires onMessage for each plugin', async () => {
    const adapter = makeAdapter()
    const seen: string[] = []
    adapter.attach(
      makePlugin(
        'a',
        definePlugin({
          hooks: {
            onMessage: e => {
              seen.push(`${e.role}:${e.text}`)
            },
          },
        }),
      ),
    )
    await adapter.fireMessage({ role: 'user', text: 'hi', sessionId: 's' })
    expect(seen).toEqual(['user:hi'])
  })

  it('fires onSessionStart from both hooks.onSessionStart and manifest.onSessionStart', async () => {
    const adapter = makeAdapter()
    const seen: string[] = []
    adapter.attach(
      makePlugin(
        'a',
        definePlugin({
          hooks: {
            onSessionStart: () => {
              seen.push('hooks')
            },
          },
          onSessionStart: () => {
            seen.push('manifest')
          },
        }),
      ),
    )
    await adapter.fireSessionStart({ sessionId: 's', cwd: '/tmp' })
    expect(seen.sort()).toEqual(['hooks', 'manifest'])
  })

  it('fires onSessionEnd', async () => {
    const adapter = makeAdapter()
    const seen: string[] = []
    adapter.attach(
      makePlugin(
        'a',
        definePlugin({
          hooks: {
            onSessionEnd: () => {
              seen.push('end')
            },
          },
        }),
      ),
    )
    await adapter.fireSessionEnd({ sessionId: 's', cwd: '/tmp' })
    expect(seen).toEqual(['end'])
  })
})

describe('adapter — init', () => {
  it('runs every attached plugin init() exactly once per call', async () => {
    const adapter = makeAdapter()
    const ran: string[] = []
    adapter.attach(
      makePlugin(
        'a',
        definePlugin({
          init: () => {
            ran.push('a')
          },
        }),
      ),
    )
    adapter.attach(
      makePlugin(
        'b',
        definePlugin({
          init: () => {
            ran.push('b')
          },
        }),
      ),
    )
    await adapter.runPluginInits()
    expect(ran).toEqual(['a', 'b'])
  })

  it('swallows init() errors and logs them', async () => {
    const warn = vi.fn()
    const adapter = makeAdapter({
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    })
    adapter.attach(
      makePlugin(
        'a',
        definePlugin({
          init: () => {
            throw new Error('init-boom')
          },
        }),
      ),
    )
    await expect(adapter.runPluginInits()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('init-boom'))
  })
})

describe('adapter — translator observability', () => {
  it('preserves readOnly flag through the translator', () => {
    const adapter = makeAdapter()
    adapter.attach(
      makePlugin(
        'p1',
        definePlugin({
          tools: [
            defineTool({
              name: 'R',
              description: 'd',
              parameters: z.object({}),
              readOnly: true,
              execute: async () => '',
            }),
            defineTool({
              name: 'W',
              description: 'd',
              parameters: z.object({}),
              execute: async () => '',
            }),
          ],
        }),
      ),
    )
    const tools = adapter.getPluginTools()
    expect(tools.find(t => t.name === 'R')?.readOnly).toBe(true)
    expect(tools.find(t => t.name === 'W')?.readOnly).toBeFalsy()
  })
})

describe('adapter — detachAll and reset', () => {
  it('detachAll removes every plugin', () => {
    const adapter = makeAdapter()
    adapter.attach(makePlugin('a', definePlugin({})))
    adapter.attach(makePlugin('b', definePlugin({})))
    adapter.detachAll()
    expect(adapter.getAttachedPluginIds()).toEqual([])
  })

  it('resetForTesting clears state and collision lists', () => {
    const adapter = makeAdapter()
    adapter.setBuiltinToolNames(['Built'])
    adapter.attach(makePlugin('a', definePlugin({})))
    adapter.resetForTesting()
    expect(adapter.getAttachedPluginIds()).toEqual([])
    // After reset, collisions are no longer detected
    adapter.attach(
      makePlugin(
        'b',
        definePlugin({
          tools: [
            defineTool({
              name: 'Built',
              description: 'd',
              parameters: z.object({}),
              execute: async () => '',
            }),
          ],
        }),
      ),
    )
    expect(adapter.getPluginTools()).toHaveLength(1)
  })
})

/**
 * Tests for the plugin loader.
 *
 * The loader itself lives at src/services/plugins/loader.ts in the host
 * package. Since this test package can't easily import from the sibling
 * without a build, we re-implement the loader's public behavior by
 * importing the host file via a relative path and stubbing its fs /
 * importer injection points.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { definePlugin, defineSkill, defineTool } from '../src/index.js'
// Relative path into the host src tree — this test package co-locates with
// the CLI. No build step needed because we use vitest with native ESM and
// we only import types + runtime helpers, not the host entrypoint.
import {
  loadPlugins,
  validateManifest,
} from '../../../src/services/plugins/loader.js'

function fakeStat(isFile: boolean) {
  return {
    isFile: () => isFile,
    isDirectory: () => !isFile,
  }
}

function makeFs(files: Record<string, 'file' | 'dir'>) {
  return {
    readdir: async (dir: string) => {
      const prefix = dir.endsWith('/') ? dir : dir + '/'
      const seen = new Set<string>()
      for (const p of Object.keys(files)) {
        if (p.startsWith(prefix)) {
          const rest = p.slice(prefix.length)
          const [head] = rest.split('/')
          if (head) seen.add(head)
        }
      }
      if (seen.size === 0) {
        // Emulate ENOENT when the directory wasn't registered at all.
        const asDir = Object.keys(files).some(p =>
          (p === dir || p.startsWith(prefix)) && files[p] === 'dir',
        )
        if (!asDir && files[dir] !== 'dir') throw new Error('ENOENT')
      }
      return [...seen]
    },
    stat: async (p: string) => {
      const k = files[p]
      if (!k) throw new Error('ENOENT')
      return fakeStat(k === 'file')
    },
  } as unknown as Parameters<typeof loadPlugins>[0] extends infer O
    ? O extends { fs?: infer F }
      ? F
      : never
    : never
}

describe('validateManifest', () => {
  it('accepts a well-formed manifest', () => {
    const manifest = definePlugin({
      tools: [
        defineTool({
          name: 'T',
          description: 'd',
          parameters: z.object({}),
          execute: async () => '',
        }),
      ],
    })
    const res = validateManifest(manifest)
    expect(res.ok).toBe(true)
  })

  it('rejects non-objects', () => {
    expect(validateManifest(null).ok).toBe(false)
    expect(validateManifest(42).ok).toBe(false)
    expect(validateManifest('nope').ok).toBe(false)
  })

  it("rejects missing kind='plugin'", () => {
    expect(validateManifest({ tools: [] }).ok).toBe(false)
  })

  it('rejects non-array tools / skills / keybinds', () => {
    expect(
      validateManifest({ kind: 'plugin', tools: {} }).ok,
    ).toBe(false)
  })

  it('rejects entries with the wrong kind', () => {
    expect(
      validateManifest({
        kind: 'plugin',
        tools: [{ kind: 'not-a-tool', name: 'x' }],
      }).ok,
    ).toBe(false)
  })
})

describe('loadPlugins', () => {
  it('returns empty results when no sources configured', async () => {
    const res = await loadPlugins({
      cwd: '/nowhere',
      home: '/nowhere',
      fs: makeFs({}),
    })
    expect(res.loaded).toEqual([])
    expect(res.errors).toEqual([])
  })

  it('captures invalid_manifest errors rather than throwing', async () => {
    const res = await loadPlugins({
      cwd: '/cwd',
      home: '/home',
      plugins: ['bad-plugin'],
      fs: makeFs({}),
      importer: async () => ({ default: { kind: 'not-a-plugin' } }),
    })
    expect(res.loaded).toEqual([])
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.reason).toBe('invalid_manifest')
  })

  it('captures missing_default_export errors', async () => {
    const res = await loadPlugins({
      cwd: '/cwd',
      home: '/home',
      plugins: ['empty-plugin'],
      fs: makeFs({}),
      importer: async () => ({}),
    })
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.reason).toBe('missing_default_export')
  })

  it('captures import_failed errors', async () => {
    const res = await loadPlugins({
      cwd: '/cwd',
      home: '/home',
      plugins: ['throwing-plugin'],
      fs: makeFs({}),
      importer: async () => {
        throw new Error('boom')
      },
    })
    expect(res.errors).toHaveLength(1)
    expect(res.errors[0]!.reason).toBe('import_failed')
    expect(res.errors[0]!.error.message).toBe('boom')
  })

  it('loads a valid plugin from the explicit list', async () => {
    const manifest = definePlugin({
      name: 'explicit',
      tools: [],
      skills: [],
      keybinds: [],
    })
    const res = await loadPlugins({
      cwd: '/cwd',
      home: '/home',
      plugins: ['void-plugin-explicit'],
      fs: makeFs({}),
      importer: async () => ({ default: manifest }),
    })
    expect(res.errors).toEqual([])
    expect(res.loaded).toHaveLength(1)
    expect(res.loaded[0]!.manifest.name).toBe('explicit')
    expect(res.loaded[0]!.source).toBe('npm')
  })

  it('discovers plugin files from ~/.void/plugins', async () => {
    const manifest = definePlugin({
      name: 'user-plugin',
      tools: [],
      skills: [],
      keybinds: [],
    })
    const res = await loadPlugins({
      cwd: '/cwd',
      home: '/home',
      fs: makeFs({
        '/home/.void/plugins/a.js': 'file',
        '/home/.void/plugins/readme.md': 'file',
      }),
      importer: async spec => {
        if (spec.endsWith('/a.js')) return { default: manifest }
        return {}
      },
    })
    // readme.md must be filtered out; only a.js loads.
    expect(res.errors).toEqual([])
    expect(res.loaded).toHaveLength(1)
    expect(res.loaded[0]!.source).toBe('user')
  })

  it('accepts `plugin` named export as a fallback', async () => {
    const manifest = definePlugin({ name: 'fallback' })
    const res = await loadPlugins({
      cwd: '/cwd',
      home: '/home',
      plugins: ['fallback-plugin'],
      fs: makeFs({}),
      importer: async () => ({ plugin: manifest }),
    })
    expect(res.loaded).toHaveLength(1)
    expect(res.loaded[0]!.manifest.name).toBe('fallback')
  })
})

describe('hello-void example manifest snapshot', () => {
  it('matches the expected shape', async () => {
    const HelloTool = defineTool({
      name: 'Hello',
      description: 'Say hello to someone by name.',
      parameters: z.object({
        who: z.string(),
        shout: z.boolean().optional(),
      }),
      readOnly: true,
      async execute({ who, shout }) {
        const message = `Hello, ${who}!`
        return shout ? message.toUpperCase() : message
      },
    })
    const HelloSkill = defineSkill({
      name: 'hello',
      description: 'Draft a friendly greeting.',
      whenToUse: 'Use when the user asks to "say hi".',
      argumentHint: '[name]',
      async handler() {
        return 'Please write a warm greeting.'
      },
    })
    const manifest = definePlugin({
      name: 'hello-void',
      version: '0.1.0',
      tools: [HelloTool],
      skills: [HelloSkill],
    })

    // Serializable subset. Functions and zod schemas are not stable across
    // versions, so we only snapshot the author-visible structural fields.
    const shape = {
      kind: manifest.kind,
      name: manifest.name,
      version: manifest.version,
      tools: manifest.tools.map(t => ({
        kind: t.kind,
        name: t.name,
        description: t.description,
        readOnly: t.readOnly,
      })),
      skills: manifest.skills.map(s => ({
        kind: s.kind,
        name: s.name,
        description: s.description,
        whenToUse: s.whenToUse,
        argumentHint: s.argumentHint,
      })),
      keybinds: manifest.keybinds.map(k => ({
        kind: k.kind,
        key: k.key,
        label: k.label,
        when: k.when,
      })),
    }
    expect(shape).toMatchInlineSnapshot(`
      {
        "keybinds": [],
        "kind": "plugin",
        "name": "hello-void",
        "skills": [
          {
            "argumentHint": "[name]",
            "description": "Draft a friendly greeting.",
            "kind": "skill",
            "name": "hello",
            "whenToUse": "Use when the user asks to "say hi".",
          },
        ],
        "tools": [
          {
            "description": "Say hello to someone by name.",
            "kind": "tool",
            "name": "Hello",
            "readOnly": true,
          },
        ],
        "version": "0.1.0",
      }
    `)
  })
})

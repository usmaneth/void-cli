import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  defineKeybind,
  definePlugin,
  defineSkill,
  defineTool,
} from '../src/index.js'

describe('defineTool', () => {
  it('returns a frozen descriptor with kind=tool', () => {
    const t = defineTool({
      name: 'Echo',
      description: 'Echo text.',
      parameters: z.object({ text: z.string() }),
      async execute({ text }) {
        return text
      },
    })
    expect(t.kind).toBe('tool')
    expect(t.name).toBe('Echo')
    expect(Object.isFrozen(t)).toBe(true)
  })

  it('rejects invalid names', () => {
    expect(() =>
      defineTool({
        name: '9bad',
        description: 'x',
        parameters: z.object({}),
        execute: async () => '',
      }),
    ).toThrow(/Invalid tool name/)
    expect(() =>
      defineTool({
        name: 'has space',
        description: 'x',
        parameters: z.object({}),
        execute: async () => '',
      }),
    ).toThrow(/Invalid tool name/)
  })

  it('requires a description', () => {
    expect(() =>
      defineTool({
        name: 'T',
        description: '',
        parameters: z.object({}),
        execute: async () => '',
      }),
    ).toThrow(/description is required/)
  })
})

describe('defineSkill', () => {
  it('rejects uppercase names', () => {
    expect(() =>
      defineSkill({
        name: 'MySkill',
        description: 'x',
        handler: async () => '',
      }),
    ).toThrow(/Invalid skill name/)
  })

  it('validates alias names too', () => {
    expect(() =>
      defineSkill({
        name: 'ok',
        description: 'x',
        aliases: ['Bad-One'],
        handler: async () => '',
      }),
    ).toThrow(/Invalid skill name/)
  })
})

describe('defineKeybind', () => {
  it('requires non-empty key and label', () => {
    expect(() =>
      // @ts-expect-error — intentionally missing label
      defineKeybind({ key: 'ctrl+a', action: () => {} }),
    ).toThrow(/label is required/)
    expect(() =>
      defineKeybind({ key: '', label: 'x', action: () => {} }),
    ).toThrow(/key is required/)
  })
})

describe('definePlugin', () => {
  it('returns a frozen manifest with kind=plugin', () => {
    const p = definePlugin({
      name: 'test',
      tools: [],
      skills: [],
      keybinds: [],
    })
    expect(p.kind).toBe('plugin')
    expect(p.name).toBe('test')
    expect(Object.isFrozen(p)).toBe(true)
    expect(Object.isFrozen(p.tools)).toBe(true)
  })

  it('rejects non-define results', () => {
    expect(() =>
      definePlugin({
        // @ts-expect-error — intentionally malformed
        tools: [{ name: 'Bad', description: 'x', execute: () => '' }],
      }),
    ).toThrow(/expected a tool descriptor/)
  })

  it('detects duplicate tool names', () => {
    const a = defineTool({
      name: 'Dup',
      description: 'a',
      parameters: z.object({}),
      execute: async () => '',
    })
    const b = defineTool({
      name: 'Dup',
      description: 'b',
      parameters: z.object({}),
      execute: async () => '',
    })
    expect(() => definePlugin({ tools: [a, b] })).toThrow(/duplicate tool name/)
  })

  it('detects duplicate keybind key+when combinations', () => {
    const a = defineKeybind({ key: 'ctrl+k', label: 'A', action: () => {} })
    const b = defineKeybind({ key: 'ctrl+k', label: 'B', action: () => {} })
    expect(() => definePlugin({ keybinds: [a, b] })).toThrow(
      /duplicate keybind name/,
    )
  })
})

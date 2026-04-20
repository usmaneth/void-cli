/**
 * Tests for council preset selection, member weighting, and config mutation.
 *
 * Council mode runs multiple models in parallel. Presets are canonical: if
 * `duo` or `trinity` regress (membership, weights, or provider routing) every
 * downstream consensus method silently changes. These tests also pin the
 * weighting invariant — leader always has weight 1 — and the activate/deactivate
 * cycle that the `/council` command depends on.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  COUNCIL_PRESETS,
  activatePreset,
  addCouncilMember,
  deactivateCouncil,
  getCouncilConfig,
  isCouncilActive,
  removeCouncilMember,
  setCouncilConfig,
} from '../config.js'
import type { CouncilMember } from '../types.js'

describe('COUNCIL_PRESETS', () => {
  it('exposes duo, trinity, full, and open-source presets', () => {
    expect(Object.keys(COUNCIL_PRESETS).sort()).toEqual(
      ['duo', 'trinity', 'full', 'open-source'].sort(),
    )
  })

  it('duo has two members — Claude (anthropic) + GPT-4o (openrouter)', () => {
    const duo = COUNCIL_PRESETS['duo']!
    expect(duo.members).toHaveLength(2)
    expect(duo.members[0]!.provider).toBe('anthropic')
    expect(duo.members[1]!.provider).toBe('openrouter')
  })

  it('trinity adds Gemini as a third member', () => {
    const trinity = COUNCIL_PRESETS['trinity']!
    expect(trinity.members).toHaveLength(3)
    const ids = trinity.members.map(m => m.id)
    expect(ids).toContain('claude')
    expect(ids).toContain('gpt4o')
    expect(ids).toContain('gemini')
  })

  it('full council has five members for broad coverage', () => {
    const full = COUNCIL_PRESETS['full']!
    expect(full.members).toHaveLength(5)
  })

  it('open-source preset routes every member through openrouter', () => {
    const os = COUNCIL_PRESETS['open-source']!
    expect(os.members.length).toBeGreaterThan(0)
    for (const m of os.members) {
      expect(m.provider).toBe('openrouter')
    }
  })

  it('every preset has a leader with weight 1 (tie-break / leader-picks)', () => {
    for (const preset of Object.values(COUNCIL_PRESETS)) {
      expect(preset.members[0]!.weight).toBe(1)
    }
  })

  it('all member weights are between 0 and 1 inclusive', () => {
    for (const preset of Object.values(COUNCIL_PRESETS)) {
      for (const member of preset.members) {
        expect(member.weight).toBeGreaterThan(0)
        expect(member.weight).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('activatePreset / deactivateCouncil', () => {
  beforeEach(() => {
    // Reset to a known state — config is module-level mutable state.
    deactivateCouncil()
    setCouncilConfig({ preset: 'duo', members: COUNCIL_PRESETS['duo']!.members })
  })

  afterEach(() => {
    deactivateCouncil()
  })

  it('activatePreset switches members and marks council enabled', () => {
    const config = activatePreset('trinity')
    expect(config.enabled).toBe(true)
    expect(config.preset).toBe('trinity')
    expect(config.members).toHaveLength(3)
    expect(isCouncilActive()).toBe(true)
  })

  it('activatePreset throws on unknown preset name', () => {
    expect(() => activatePreset('does-not-exist')).toThrow(/Unknown council preset/)
  })

  it('deactivateCouncil flips enabled without changing members', () => {
    activatePreset('full')
    expect(isCouncilActive()).toBe(true)
    deactivateCouncil()
    expect(isCouncilActive()).toBe(false)
    expect(getCouncilConfig().members).toHaveLength(5)
  })

  it('isCouncilActive requires both enabled=true and >1 member', () => {
    activatePreset('duo')
    expect(isCouncilActive()).toBe(true)
    setCouncilConfig({ members: [COUNCIL_PRESETS['duo']!.members[0]!] })
    // Single member — not a real "council".
    expect(isCouncilActive()).toBe(false)
  })
})

describe('addCouncilMember / removeCouncilMember', () => {
  beforeEach(() => {
    setCouncilConfig({ preset: 'duo', members: COUNCIL_PRESETS['duo']!.members })
  })

  const EXTRA: CouncilMember = {
    id: 'extra',
    name: 'Extra',
    model: 'openai/gpt-4o-mini',
    provider: 'openrouter',
    weight: 0.5,
    canExecuteTools: false,
  }

  it('adding a member marks preset as custom', () => {
    addCouncilMember(EXTRA)
    const config = getCouncilConfig()
    expect(config.preset).toBe('custom')
    expect(config.members.map(m => m.id)).toContain('extra')
  })

  it('removing a member marks preset as custom and drops by id', () => {
    addCouncilMember(EXTRA)
    removeCouncilMember('extra')
    const config = getCouncilConfig()
    expect(config.preset).toBe('custom')
    expect(config.members.map(m => m.id)).not.toContain('extra')
  })
})

import { describe, expect, it } from 'vitest'
import { computePanelLines } from '../StatusPanel.js'

describe('computePanelLines (full mode)', () => {
  const baseInput = {
    mode: 'full' as const,
    model: 'gpt-5.5',
    isSubscription: true,
    streamActive: false,
    contextRatio: 0.12,
    inputTokens: 24900,
    outputTokens: 23,
    cost: 0,
    sessionDurationMs: 18 * 60_000,
    cwd: '~/void-cli',
    teamName: 'zetachain',
    permissionsMode: 'bypass' as const,
    effortLabel: 'high effort',
    cols: 100,
  }

  it('produces 5 logical lines: top frame, blank, stats, blank, bottom frame', () => {
    const lines = computePanelLines(baseInput)
    expect(lines.length).toBe(5)
  })

  it('top line includes hero-spaced model name and effort label', () => {
    const lines = computePanelLines(baseInput)
    expect(lines[0]).toContain('G P T · 5 · 5')
    expect(lines[0]).toContain('high effort')
  })

  it('middle stats line includes context %, tokens, duration, sub label', () => {
    const lines = computePanelLines(baseInput)
    expect(lines[2]).toContain('12%')
    expect(lines[2]).toContain('24.9k')
    expect(lines[2]).toContain('23')
    expect(lines[2]).toContain('sub')
  })

  it('bottom line includes permissions mode + cwd + team', () => {
    const lines = computePanelLines(baseInput)
    expect(lines[4]).toContain('bypass')
    expect(lines[4]).toContain('void-cli')
    expect(lines[4]).toContain('zetachain')
  })

  it('non-subscription model shows actual cost in dollars', () => {
    const lines = computePanelLines({
      ...baseInput,
      model: 'claude-opus-4-7',
      isSubscription: false,
      cost: 3.42,
    })
    expect(lines[2]).toContain('$3.42')
    expect(lines[2]).not.toContain('sub')
  })
})

describe('computePanelLines (compact mode)', () => {
  it('produces 3 logical lines (frame top + stats + bottom)', () => {
    const lines = computePanelLines({
      mode: 'compact',
      model: 'gpt-5.5',
      isSubscription: true,
      streamActive: false,
      contextRatio: 0.12,
      inputTokens: 24900,
      outputTokens: 23,
      cost: 0,
      sessionDurationMs: 18 * 60_000,
      cwd: '~/void-cli',
      teamName: undefined,
      permissionsMode: 'bypass',
      effortLabel: 'high',
      cols: 80,
    })
    expect(lines.length).toBe(3)
  })
})

describe('computePanelLines (minimal mode)', () => {
  it('produces 1 logical line', () => {
    const lines = computePanelLines({
      mode: 'minimal',
      model: 'gpt-5.5',
      isSubscription: true,
      streamActive: false,
      contextRatio: 0.12,
      inputTokens: 24900,
      outputTokens: 23,
      cost: 0,
      sessionDurationMs: 18 * 60_000,
      cwd: '~/void-cli',
      teamName: undefined,
      permissionsMode: 'bypass',
      effortLabel: 'high',
      cols: 50,
    })
    expect(lines.length).toBe(1)
  })
})

describe('computePanelLines (off mode)', () => {
  it('produces empty array (no rendering)', () => {
    const lines = computePanelLines({
      mode: 'off',
      model: 'gpt-5.5',
      isSubscription: true,
      streamActive: false,
      contextRatio: 0.12,
      inputTokens: 24900,
      outputTokens: 23,
      cost: 0,
      sessionDurationMs: 18 * 60_000,
      cwd: '~/void-cli',
      teamName: undefined,
      permissionsMode: 'bypass',
      effortLabel: 'high',
      cols: 100,
    })
    expect(lines.length).toBe(0)
  })
})

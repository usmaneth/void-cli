/**
 * Tests for portSuggest. Pure functions tested directly. Filesystem
 * paths (writePortPlan, runPortSuggest end-to-end) use temp dirs.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  categorize,
  diffStrings,
  findLatestMeasurementReport,
  rankCandidates,
  renderPortPlan,
  scoreCandidate,
} from '../portSuggest.js'

describe('categorize', () => {
  it('flags a markdown heading as a prompt', () => {
    expect(categorize('# Phase 1: Identify Changes')).toBe('prompt')
    expect(categorize('## Doing tasks')).toBe('prompt')
  })

  it('flags "You are" lines as prompts', () => {
    expect(categorize('You are an interactive agent that helps')).toBe('prompt')
  })

  it('flags tool-description shape', () => {
    expect(categorize('Use the AgentTool to dispatch sub-agents')).toBe(
      'tool-description',
    )
  })

  it('flags slash commands', () => {
    expect(categorize('/measure suggest some args here')).toBe('command')
  })

  it('flags errors', () => {
    expect(categorize('Error: failed to parse the JSON output')).toBe('error')
  })

  it('falls through to other for plain content', () => {
    expect(categorize('the quick brown fox jumps over the lazy dog')).toBe(
      'other',
    )
  })
})

describe('scoreCandidate', () => {
  it('scores prompt-shape strings highest', () => {
    const promptScore = scoreCandidate(
      '## You should always verify the diff before committing — never skip review',
    )
    const plainScore = scoreCandidate('this is a moderately long string with words')
    expect(promptScore).toBeGreaterThan(plainScore)
  })

  it('penalizes very short strings via length bucket', () => {
    expect(scoreCandidate('shortish but with words')).toBeLessThan(3)
  })

  it('rewards multi-line content', () => {
    const single = scoreCandidate('one line of prose with many words to pass')
    const multi = scoreCandidate(
      'first line of prose\nsecond line of prose with words',
    )
    expect(multi).toBeGreaterThanOrEqual(single)
  })

  it('rewards "must"/"should" markers', () => {
    const generic = scoreCandidate('the cat sat on the mat with words')
    const directive = scoreCandidate(
      'you must always check the input before processing',
    )
    expect(directive).toBeGreaterThan(generic)
  })
})

describe('diffStrings', () => {
  it('returns elements in a not present in b', () => {
    expect(diffStrings(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })

  it('deduplicates the output', () => {
    expect(diffStrings(['a', 'a', 'b', 'a'], [])).toEqual(['a', 'b'])
  })

  it('returns an empty array when every a is in b', () => {
    expect(diffStrings(['a', 'b'], ['b', 'a', 'c'])).toEqual([])
  })

  it('returns an empty array when a is empty', () => {
    expect(diffStrings([], ['anything'])).toEqual([])
  })
})

describe('rankCandidates', () => {
  it('returns candidates sorted by score descending', () => {
    const ranked = rankCandidates(
      [
        'plain string with not many words to score',
        '## You must always check and never skip the validation step',
        'another plain string with not many words to score',
      ],
      10,
    )
    expect(ranked[0]!.text).toMatch(/You must always check/)
  })

  it('caps output at topN', () => {
    const inputs = Array.from(
      { length: 100 },
      (_, i) => `candidate number ${i} with extra words for filter to pass through`,
    )
    expect(rankCandidates(inputs, 5)).toHaveLength(5)
  })

  it('attaches a category to each candidate', () => {
    const ranked = rankCandidates(
      ['You are a helpful assistant for code reviewers'],
      10,
    )
    expect(ranked[0]!.category).toBe('prompt')
  })
})

describe('renderPortPlan', () => {
  const startedAt = new Date('2026-04-27T12:34:00Z')

  it('emits frontmatter + sections', () => {
    const md = renderPortPlan({
      startedAt,
      voidVersion: '2.1.94',
      voidStringsCount: 1234,
      reports: [
        {
          tool: 'claude',
          version: '2.1.119',
          binary: '/Users/me/.local/bin/claude',
          candidatesFound: 50,
          top: rankCandidates(
            ['## You should always check the input before running'],
            5,
          ),
        },
      ],
      latestMeasurement: '/vault/2026-04-27-1100-measurement.md',
      vaultDir: '/vault',
    })
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('id: 2026-04-27-1234-port-plan')
    expect(md).toContain('## claude — 2.1.119')
    expect(md).toContain('void@2.1.94')
    expect(md).toContain('Linked measurement')
  })

  it('notes when no measurement is linked', () => {
    const md = renderPortPlan({
      startedAt,
      voidVersion: '2.1.94',
      voidStringsCount: 100,
      reports: [],
      latestMeasurement: null,
      vaultDir: '/vault',
    })
    expect(md).toContain('none — run `/measure` first')
  })

  it('emits the no-candidates note when a tool has nothing above threshold', () => {
    const md = renderPortPlan({
      startedAt,
      voidVersion: '2.1.94',
      voidStringsCount: 100,
      reports: [
        {
          tool: 'codex',
          version: '0.124.0',
          binary: '/path/codex',
          candidatesFound: 0,
          top: [],
        },
      ],
      latestMeasurement: null,
      vaultDir: '/vault',
    })
    expect(md).toContain('No candidates above the noise threshold')
  })
})

describe('findLatestMeasurementReport', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pl-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns null when the directory is missing', async () => {
    expect(await findLatestMeasurementReport(join(tmp, 'nope'))).toBeNull()
  })

  it('returns null when no -measurement.md files exist', async () => {
    mkdirSync(tmp, { recursive: true })
    writeFileSync(join(tmp, 'something-else.md'), 'x')
    expect(await findLatestMeasurementReport(tmp)).toBeNull()
  })

  it('returns the lexicographically-latest report', async () => {
    writeFileSync(join(tmp, '2026-04-25-0900-measurement.md'), 'older')
    writeFileSync(join(tmp, '2026-04-26-1500-measurement.md'), 'newer')
    writeFileSync(join(tmp, '2026-04-25-1300-measurement.md'), 'middle')
    const latest = await findLatestMeasurementReport(tmp)
    expect(latest).toContain('2026-04-26-1500-measurement.md')
  })
})

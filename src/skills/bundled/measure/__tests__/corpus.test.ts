/**
 * Tests for the corpus loader. The pure helpers (parse, filter, sample) are
 * exercised directly so we don't need to mock the filesystem.
 */
import { describe, expect, it } from 'vitest'
import {
  isReplayableForProject,
  parseHistoryLine,
  sampleRecentPromptsFromLines,
} from '../corpus.js'

const PROJECT = '/Users/me/myproject'

function line(o: Record<string, unknown>): string {
  return JSON.stringify(o)
}

describe('parseHistoryLine', () => {
  it('returns null for an empty line', () => {
    expect(parseHistoryLine('')).toBeNull()
    expect(parseHistoryLine('   ')).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseHistoryLine('not json')).toBeNull()
    expect(parseHistoryLine('{"display": "x",')).toBeNull()
  })

  it('returns null when required fields are missing or wrong type', () => {
    expect(parseHistoryLine(line({ display: 'x' }))).toBeNull()
    expect(
      parseHistoryLine(
        line({ display: 'x', timestamp: 'now', project: PROJECT, sessionId: 's' }),
      ),
    ).toBeNull()
    expect(
      parseHistoryLine(
        line({ display: 1, timestamp: 1, project: PROJECT, sessionId: 's' }),
      ),
    ).toBeNull()
  })

  it('parses a well-formed entry', () => {
    const raw = line({
      display: 'fix the bug',
      timestamp: 12345,
      project: PROJECT,
      sessionId: 's-1',
      pastedContents: {},
    })
    expect(parseHistoryLine(raw)).toEqual({
      display: 'fix the bug',
      timestamp: 12345,
      project: PROJECT,
      sessionId: 's-1',
    })
  })
})

describe('isReplayableForProject', () => {
  const baseEntry = {
    display: 'this is a real prompt about something',
    timestamp: 1,
    project: PROJECT,
    sessionId: 's',
  }

  it('rejects a different project', () => {
    expect(
      isReplayableForProject({ ...baseEntry, project: '/other' }, PROJECT),
    ).toBe(false)
  })

  it('rejects slash-commands and meta-prefixes', () => {
    for (const display of ['/architect on', '! ls', '#tag here']) {
      expect(
        isReplayableForProject({ ...baseEntry, display }, PROJECT),
      ).toBe(false)
    }
  })

  it('rejects trivial prompts under MIN_PROMPT_CHARS', () => {
    expect(
      isReplayableForProject({ ...baseEntry, display: 'yo' }, PROJECT),
    ).toBe(false)
  })

  it('accepts a real, project-matched, non-trivial prompt', () => {
    expect(isReplayableForProject(baseEntry, PROJECT)).toBe(true)
  })
})

describe('sampleRecentPromptsFromLines', () => {
  const projectLines = [
    line({ display: 'older real prompt that qualifies', timestamp: 1, project: PROJECT, sessionId: 's' }),
    line({ display: '/skip-me-slash-command', timestamp: 2, project: PROJECT, sessionId: 's' }),
    line({ display: 'yo', timestamp: 3, project: PROJECT, sessionId: 's' }),
    line({ display: 'middle real prompt qualifying again', timestamp: 4, project: PROJECT, sessionId: 's' }),
    line({ display: 'newest real prompt qualifying once more', timestamp: 5, project: PROJECT, sessionId: 's' }),
  ]

  it('returns most-recent-first', () => {
    const got = sampleRecentPromptsFromLines(projectLines, { n: 10, projectPath: PROJECT })
    expect(got.map(g => g.timestamp)).toEqual([5, 4, 1])
  })

  it('honors n', () => {
    const got = sampleRecentPromptsFromLines(projectLines, { n: 2, projectPath: PROJECT })
    expect(got).toHaveLength(2)
    expect(got[0]!.timestamp).toBe(5)
    expect(got[1]!.timestamp).toBe(4)
  })

  it('skips entries from other projects', () => {
    const mixed = [
      ...projectLines,
      line({ display: 'a real prompt from another project', timestamp: 100, project: '/elsewhere', sessionId: 's' }),
    ]
    const got = sampleRecentPromptsFromLines(mixed, { n: 10, projectPath: PROJECT })
    expect(got.map(g => g.project)).toEqual([PROJECT, PROJECT, PROJECT])
  })

  it('tolerates corrupt lines without crashing', () => {
    const withCorrupt = [
      'not json at all',
      '',
      ...projectLines,
      '{"display":"truncated',
    ]
    const got = sampleRecentPromptsFromLines(withCorrupt, { n: 10, projectPath: PROJECT })
    expect(got).toHaveLength(3)
  })
})

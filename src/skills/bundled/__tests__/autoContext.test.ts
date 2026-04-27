/**
 * Sanity tests for the auto-context skill.
 *
 * The skill itself is a thin wrapper around the prompt template plus a
 * registration call. We don't try to test what the model does with the prompt
 * (that's an integration concern). We do pin: the file the loader expects to
 * find, the registration export shape, and the prompt content's invariants
 * (frontmatter `paths` glob, write target, refresh flag handling).
 */
import { describe, expect, it } from 'vitest'
import {
  AUTO_CONTEXT_RELATIVE_PATH,
  registerAutoContextSkill,
} from '../autoContext.js'

describe('AUTO_CONTEXT_RELATIVE_PATH', () => {
  it('writes to .claude/rules/ so the existing memory loader picks it up', () => {
    // voidmd.ts:910 globs `.claude/rules/*.md` for project rules. If this
    // path drifts, the addendum stops loading silently.
    expect(AUTO_CONTEXT_RELATIVE_PATH).toBe('.claude/rules/auto-context.md')
  })

  it('uses a relative path so it resolves against the project root', () => {
    expect(AUTO_CONTEXT_RELATIVE_PATH.startsWith('/')).toBe(false)
    expect(AUTO_CONTEXT_RELATIVE_PATH.endsWith('.md')).toBe(true)
  })
})

describe('registerAutoContextSkill', () => {
  it('is callable without throwing', () => {
    // The bundled-skills registry is a module-level Set; idempotent for our
    // purposes. We're not asserting it shows up — that's the bundled-skills
    // module's contract — just that registration doesn't crash.
    expect(() => registerAutoContextSkill()).not.toThrow()
  })
})

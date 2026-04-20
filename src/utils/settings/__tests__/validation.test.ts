/**
 * Tests for settings validation helpers.
 *
 * `filterInvalidPermissionRules` is the first line of defence — one bad rule
 * in `allow`/`deny`/`ask` would otherwise poison the entire settings file
 * because Zod validates the whole object. These tests pin the "drop and warn"
 * behaviour.
 *
 * `validatePermissionRule` underpins that filtering. Empty strings, mismatched
 * parens, and empty-parens with no tool name must all be caught.
 */
import { describe, expect, it } from 'vitest'
import { filterInvalidPermissionRules } from '../validation.js'
import { validatePermissionRule } from '../permissionValidation.js'

describe('validatePermissionRule', () => {
  it('rejects an empty string', () => {
    const result = validatePermissionRule('')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/empty/i)
  })

  it('rejects whitespace-only rules', () => {
    expect(validatePermissionRule('   ').valid).toBe(false)
  })

  it('rejects mismatched parentheses', () => {
    const result = validatePermissionRule('Bash(rm -rf')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/parentheses/i)
  })

  it('rejects empty parentheses with no tool name', () => {
    const result = validatePermissionRule('()')
    expect(result.valid).toBe(false)
  })

  it('accepts a bare tool name (e.g. Read)', () => {
    expect(validatePermissionRule('Read').valid).toBe(true)
  })

  it('accepts a Bash prefix rule', () => {
    expect(validatePermissionRule('Bash(npm:*)').valid).toBe(true)
  })
})

describe('filterInvalidPermissionRules', () => {
  it('returns no warnings for a well-formed settings object', () => {
    const warnings = filterInvalidPermissionRules(
      {
        permissions: {
          allow: ['Read', 'Bash(npm:*)'],
          deny: ['Bash(rm:*)'],
        },
      },
      'settings.json',
    )
    expect(warnings).toEqual([])
  })

  it('is a no-op for inputs without a permissions field', () => {
    expect(filterInvalidPermissionRules({}, 'settings.json')).toEqual([])
    expect(filterInvalidPermissionRules(null, 'settings.json')).toEqual([])
    expect(
      filterInvalidPermissionRules({ otherKey: 'value' }, 'settings.json'),
    ).toEqual([])
  })

  it('strips non-string entries from allow/deny/ask and warns', () => {
    const data: Record<string, unknown> = {
      permissions: {
        allow: ['Read', 42, null],
        deny: ['Bash(rm:*)'],
        ask: [{ not: 'a string' }, 'Bash(curl:*)'],
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings.json')
    expect(warnings.length).toBeGreaterThanOrEqual(3)

    // Mutates in place; arrays now contain only valid entries.
    const perms = data.permissions as {
      allow: unknown[]
      deny: unknown[]
      ask: unknown[]
    }
    expect(perms.allow).toEqual(['Read'])
    expect(perms.deny).toEqual(['Bash(rm:*)'])
    expect(perms.ask).toEqual(['Bash(curl:*)'])
  })

  it('strips malformed rule strings and warns per rule', () => {
    const data = {
      permissions: {
        allow: ['Bash(unclosed', 'Read'],
      },
    }
    const warnings = filterInvalidPermissionRules(data, 'settings.json')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toMatch(/skipped/i)
    expect(data.permissions.allow).toEqual(['Read'])
  })
})

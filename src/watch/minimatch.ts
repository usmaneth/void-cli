/**
 * Minimal glob-matching utility (no external dependencies).
 *
 * Supports:
 *   *      — match any characters except path separator
 *   **     — match any characters including path separator (directory wildcard)
 *   ?      — match a single character except path separator
 *   {a,b}  — match either a or b
 *
 * This is intentionally simple and covers the patterns used by the watch system.
 */

export function minimatch(filePath: string, pattern: string): boolean {
  // Normalize separators to forward slash for consistent matching
  const normalized = filePath.replace(/\\/g, '/')
  const normalizedPattern = pattern.replace(/\\/g, '/')

  const regex = globToRegex(normalizedPattern)
  return regex.test(normalized)
}

function globToRegex(pattern: string): RegExp {
  let regexStr = '^'
  let i = 0

  while (i < pattern.length) {
    const ch = pattern[i]!

    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** — match everything including path separators
        if (pattern[i + 2] === '/') {
          // **/ — match zero or more directories
          regexStr += '(?:.+/)?'
          i += 3
        } else {
          // ** at end or before non-slash
          regexStr += '.*'
          i += 2
        }
      } else {
        // * — match everything except /
        regexStr += '[^/]*'
        i++
      }
    } else if (ch === '?') {
      regexStr += '[^/]'
      i++
    } else if (ch === '{') {
      // Find matching }
      const closeIdx = pattern.indexOf('}', i)
      if (closeIdx === -1) {
        regexStr += escapeChar(ch)
        i++
      } else {
        const alternatives = pattern.slice(i + 1, closeIdx).split(',')
        regexStr += '(?:' + alternatives.map(escapeGlobPart).join('|') + ')'
        i = closeIdx + 1
      }
    } else if (ch === '[') {
      // Character class — pass through
      const closeIdx = pattern.indexOf(']', i)
      if (closeIdx === -1) {
        regexStr += escapeChar(ch)
        i++
      } else {
        regexStr += pattern.slice(i, closeIdx + 1)
        i = closeIdx + 1
      }
    } else {
      regexStr += escapeChar(ch)
      i++
    }
  }

  regexStr += '$'
  return new RegExp(regexStr)
}

function escapeChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeGlobPart(part: string): string {
  // Escape regex-special chars but not glob chars within brace alternatives
  return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

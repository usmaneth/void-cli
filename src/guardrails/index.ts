import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardrailConfig {
  enabled: boolean // master toggle (default: true)
  syntaxCheck: boolean // validate syntax after edits (default: true)
  lintOnEdit: boolean // run linter after edits (default: false — opt-in)
  rejectInvalidEdits: boolean // reject edits that introduce syntax errors (default: false)
  maxFileSize: number // reject edits to files > this size in bytes (default: 1_000_000)
  blockedPaths: string[] // paths that should never be edited
  protectedPatterns: string[] // regex patterns for lines that shouldn't be modified
}

export interface ValidationError {
  line?: number
  column?: number
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}

export interface GuardrailResult {
  allowed: boolean
  warnings: string[]
  errors: string[]
  syntaxValid: boolean
}

interface BracketError {
  line: number
  char: string
  message: string
}

interface BracketCheckResult {
  matched: boolean
  errors: BracketError[]
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

function defaultConfig(): GuardrailConfig {
  return {
    enabled: true,
    syntaxCheck: true,
    lintOnEdit: false,
    rejectInvalidEdits: false,
    maxFileSize: 1_000_000,
    blockedPaths: [],
    protectedPatterns: [],
  }
}

// ---------------------------------------------------------------------------
// Bracket matching utility
// ---------------------------------------------------------------------------

const OPEN_BRACKETS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
}

const CLOSE_BRACKETS: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
}

const TS_OPEN_BRACKETS: Record<string, string> = {
  ...OPEN_BRACKETS,
  '<': '>',
}

const TS_CLOSE_BRACKETS: Record<string, string> = {
  ...CLOSE_BRACKETS,
  '>': '<',
}

/**
 * Check that brackets are balanced in the given content.
 * Ignores brackets inside string literals and comments.
 * When `includeAngleBrackets` is true, also checks `<>` (for TS/TSX).
 */
export function checkBrackets(
  content: string,
  includeAngleBrackets = false,
): BracketCheckResult {
  const openMap = includeAngleBrackets ? TS_OPEN_BRACKETS : OPEN_BRACKETS
  const closeMap = includeAngleBrackets ? TS_CLOSE_BRACKETS : CLOSE_BRACKETS
  const stack: Array<{ char: string; line: number }> = []
  const errors: BracketError[] = []
  const lines = content.split('\n')

  let inSingleLineComment = false
  let inMultiLineComment = false
  let inSingleQuote = false
  let inDoubleQuote = false
  let inTemplateLiteral = false

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!
    inSingleLineComment = false

    for (let col = 0; col < line.length; col++) {
      const ch = line[col]!
      const next = line[col + 1]

      // Handle escape sequences inside strings
      if (
        (inSingleQuote || inDoubleQuote || inTemplateLiteral) &&
        ch === '\\'
      ) {
        col++ // skip next char
        continue
      }

      // Toggle string states
      if (!inSingleLineComment && !inMultiLineComment) {
        if (ch === "'" && !inDoubleQuote && !inTemplateLiteral) {
          inSingleQuote = !inSingleQuote
          continue
        }
        if (ch === '"' && !inSingleQuote && !inTemplateLiteral) {
          inDoubleQuote = !inDoubleQuote
          continue
        }
        if (ch === '`' && !inSingleQuote && !inDoubleQuote) {
          inTemplateLiteral = !inTemplateLiteral
          continue
        }
      }

      // Skip if inside any string
      if (inSingleQuote || inDoubleQuote || inTemplateLiteral) {
        continue
      }

      // Comment detection
      if (!inMultiLineComment && ch === '/' && next === '/') {
        inSingleLineComment = true
        continue
      }
      if (!inSingleLineComment && ch === '/' && next === '*') {
        inMultiLineComment = true
        col++
        continue
      }
      if (inMultiLineComment && ch === '*' && next === '/') {
        inMultiLineComment = false
        col++
        continue
      }
      if (inSingleLineComment || inMultiLineComment) {
        continue
      }

      // Bracket matching
      const lineNum = lineIdx + 1
      if (ch in openMap) {
        stack.push({ char: ch, line: lineNum })
      } else if (ch in closeMap) {
        const expected = closeMap[ch]!
        if (stack.length === 0) {
          errors.push({
            line: lineNum,
            char: ch,
            message: `Unmatched closing '${ch}' — no corresponding opening '${expected}'`,
          })
        } else {
          const top = stack[stack.length - 1]!
          if (top.char === expected) {
            stack.pop()
          } else {
            errors.push({
              line: lineNum,
              char: ch,
              message: `Mismatched bracket: expected closing for '${top.char}' (opened at line ${top.line}), but found '${ch}'`,
            })
            // Pop anyway to avoid cascading errors
            stack.pop()
          }
        }
      }
    }
  }

  // Any remaining items on the stack are unclosed
  for (const item of stack) {
    errors.push({
      line: item.line,
      char: item.char,
      message: `Unclosed '${item.char}' opened at line ${item.line}`,
    })
  }

  return { matched: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// SyntaxValidator
// ---------------------------------------------------------------------------

export class SyntaxValidator {
  /**
   * Route to the appropriate validator based on file extension.
   */
  validate(content: string, filePath: string): ValidationResult {
    const ext = path.extname(filePath).toLowerCase()
    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
      case '.mts':
      case '.cts':
        return this.validateTypeScript(content, filePath)
      case '.py':
        return this.validatePython(content)
      case '.json':
        return this.validateJSON(content)
      default:
        return this.validateGeneric(content)
    }
  }

  /**
   * Validate TypeScript / JavaScript content.
   * Checks for: unmatched brackets/braces/parens, unclosed strings, basic import syntax.
   */
  validateTypeScript(content: string, filePath: string): ValidationResult {
    const errors: ValidationError[] = []
    const ext = path.extname(filePath).toLowerCase()
    const isTsx = ext === '.tsx' || ext === '.jsx'

    // Bracket check (include angle brackets for TSX)
    const bracketResult = checkBrackets(content, isTsx)
    for (const err of bracketResult.errors) {
      errors.push({
        line: err.line,
        message: err.message,
        severity: 'error',
      })
    }

    // Check for unclosed string literals (simple heuristic: odd number of unescaped quotes per line)
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      // Skip comment-only lines
      const trimmed = line.trimStart()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        continue
      }

      // Count unescaped quotes (ignoring escaped ones)
      const stripped = line.replace(/\\'/g, '').replace(/\\"/g, '')
      const singleCount = (stripped.match(/'/g) || []).length
      const doubleCount = (stripped.match(/"/g) || []).length

      if (singleCount % 2 !== 0) {
        // Could be a template literal or multi-line string, so warn not error
        errors.push({
          line: i + 1,
          message: "Possibly unclosed single-quote string on this line",
          severity: 'warning',
        })
      }
      if (doubleCount % 2 !== 0) {
        errors.push({
          line: i + 1,
          message: "Possibly unclosed double-quote string on this line",
          severity: 'warning',
        })
      }
    }

    // Basic import syntax check
    const importRegex = /^import\s+/
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trimStart()
      if (importRegex.test(trimmed)) {
        // Imports must have 'from' or be side-effect imports like `import './foo'`
        // Allow multi-line imports: only check lines that look self-contained
        if (
          !trimmed.includes('from') &&
          !trimmed.includes("'") &&
          !trimmed.includes('"') &&
          !trimmed.endsWith('{') &&
          !trimmed.endsWith(',')
        ) {
          errors.push({
            line: i + 1,
            message: `Possibly malformed import statement`,
            severity: 'warning',
          })
        }
      }
    }

    return { valid: errors.filter(e => e.severity === 'error').length === 0, errors }
  }

  /**
   * Validate Python content.
   * Checks for: indentation error patterns, unmatched brackets, unclosed strings.
   */
  validatePython(content: string): ValidationResult {
    const errors: ValidationError[] = []

    // Bracket check (no angle brackets)
    const bracketResult = checkBrackets(content, false)
    for (const err of bracketResult.errors) {
      errors.push({
        line: err.line,
        message: err.message,
        severity: 'error',
      })
    }

    // Indentation checks
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.length === 0 || line.trim().length === 0) {
        continue
      }

      // Check for mixed tabs and spaces at the start
      const leadingWhitespace = line.match(/^(\s*)/)?.[1] ?? ''
      if (leadingWhitespace.includes('\t') && leadingWhitespace.includes(' ')) {
        errors.push({
          line: i + 1,
          message: 'Mixed tabs and spaces in indentation',
          severity: 'error',
        })
      }
    }

    // Check for unclosed triple-quote strings
    const tripleDoubleCount = (content.match(/"""/g) || []).length
    const tripleSingleCount = (content.match(/'''/g) || []).length
    if (tripleDoubleCount % 2 !== 0) {
      errors.push({
        message: 'Unclosed triple-double-quote string (""")',
        severity: 'error',
      })
    }
    if (tripleSingleCount % 2 !== 0) {
      errors.push({
        message: "Unclosed triple-single-quote string (''')",
        severity: 'error',
      })
    }

    return { valid: errors.filter(e => e.severity === 'error').length === 0, errors }
  }

  /**
   * Validate JSON content using JSON.parse.
   */
  validateJSON(content: string): ValidationResult {
    try {
      JSON.parse(content)
      return { valid: true, errors: [] }
    } catch (err) {
      const message =
        err instanceof SyntaxError ? err.message : 'Invalid JSON'
      return {
        valid: false,
        errors: [{ message, severity: 'error' }],
      }
    }
  }

  /**
   * Generic validation: basic bracket matching and unclosed quote checks.
   */
  validateGeneric(content: string): ValidationResult {
    const errors: ValidationError[] = []

    const bracketResult = checkBrackets(content, false)
    for (const err of bracketResult.errors) {
      errors.push({
        line: err.line,
        message: err.message,
        severity: 'error',
      })
    }

    return { valid: errors.filter(e => e.severity === 'error').length === 0, errors }
  }
}

// ---------------------------------------------------------------------------
// EditGuardrail
// ---------------------------------------------------------------------------

export class EditGuardrail {
  config: GuardrailConfig
  private validator: SyntaxValidator

  constructor(config?: Partial<GuardrailConfig>) {
    this.config = { ...defaultConfig(), ...config }
    this.validator = new SyntaxValidator()
  }

  /**
   * Run pre-edit checks on the proposed new content for `filePath`.
   */
  checkBeforeEdit(filePath: string, newContent: string): GuardrailResult {
    const warnings: string[] = []
    const errors: string[] = []
    let syntaxValid = true

    if (!this.config.enabled) {
      return { allowed: true, warnings, errors, syntaxValid }
    }

    // 1. Check blocked paths
    if (this.isPathBlocked(filePath)) {
      errors.push(`Path is blocked from editing: ${filePath}`)
      return { allowed: false, warnings, errors, syntaxValid }
    }

    // 2. Check file size
    const contentSize = Buffer.byteLength(newContent, 'utf-8')
    if (contentSize > this.config.maxFileSize) {
      errors.push(
        `File content exceeds maximum size: ${contentSize} bytes > ${this.config.maxFileSize} bytes`,
      )
      return { allowed: false, warnings, errors, syntaxValid }
    }

    // 3. Check protected patterns against existing file content
    if (this.config.protectedPatterns.length > 0) {
      try {
        const oldContent = fs.readFileSync(filePath, 'utf-8')
        const protectedErrors = this.checkProtectedPatterns(
          oldContent,
          newContent,
        )
        if (protectedErrors.length > 0) {
          errors.push(...protectedErrors)
          return { allowed: false, warnings, errors, syntaxValid }
        }
      } catch {
        // File doesn't exist yet — no protected patterns to check
      }
    }

    // 4. Syntax validation
    if (this.config.syntaxCheck) {
      const result = this.validator.validate(newContent, filePath)
      syntaxValid = result.valid

      for (const err of result.errors) {
        const loc = err.line ? ` (line ${err.line})` : ''
        const msg = `${err.severity}: ${err.message}${loc}`
        if (err.severity === 'error') {
          if (this.config.rejectInvalidEdits) {
            errors.push(msg)
          } else {
            warnings.push(msg)
          }
        } else {
          warnings.push(msg)
        }
      }

      if (!syntaxValid && this.config.rejectInvalidEdits) {
        return { allowed: false, warnings, errors, syntaxValid }
      }
    }

    return { allowed: errors.length === 0, warnings, errors, syntaxValid }
  }

  /**
   * Run post-edit checks (e.g., linter) on the file at `filePath`.
   */
  checkAfterEdit(filePath: string): GuardrailResult {
    const warnings: string[] = []
    const errors: string[] = []
    let syntaxValid = true

    if (!this.config.enabled) {
      return { allowed: true, warnings, errors, syntaxValid }
    }

    // Run syntax check on the file as it now exists on disk
    if (this.config.syntaxCheck) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const result = this.validator.validate(content, filePath)
        syntaxValid = result.valid
        for (const err of result.errors) {
          const loc = err.line ? ` (line ${err.line})` : ''
          warnings.push(`${err.severity}: ${err.message}${loc}`)
        }
      } catch {
        // File may have been deleted
      }
    }

    // Run linter if configured
    if (this.config.lintOnEdit) {
      const lintResult = this.runLinter(filePath)
      if (lintResult) {
        warnings.push(...lintResult)
      }
    }

    return { allowed: true, warnings, errors, syntaxValid }
  }

  /**
   * Check whether the given path is in the blocked list.
   * Supports both exact matches and glob-like prefix matches (paths ending in /*).
   */
  isPathBlocked(filePath: string): boolean {
    const resolved = path.resolve(filePath)
    for (const blocked of this.config.blockedPaths) {
      const resolvedBlocked = path.resolve(blocked)
      if (resolved === resolvedBlocked) {
        return true
      }
      // Support directory blocking: block anything under that directory
      if (
        blocked.endsWith('/*') ||
        blocked.endsWith(path.sep + '*')
      ) {
        const dir = path.resolve(blocked.slice(0, -2))
        if (resolved.startsWith(dir + path.sep)) {
          return true
        }
      }
      // Also block if the blocked path is a directory prefix
      if (resolved.startsWith(resolvedBlocked + path.sep)) {
        return true
      }
    }
    return false
  }

  /**
   * Add a path to the blocked list.
   */
  addBlockedPath(blockedPath: string): void {
    const resolved = path.resolve(blockedPath)
    if (!this.config.blockedPaths.includes(resolved)) {
      this.config.blockedPaths.push(resolved)
    }
  }

  /**
   * Remove a path from the blocked list.
   */
  removeBlockedPath(blockedPath: string): void {
    const resolved = path.resolve(blockedPath)
    this.config.blockedPaths = this.config.blockedPaths.filter(
      p => path.resolve(p) !== resolved,
    )
  }

  /**
   * Load project-level guardrail config from `.void/config.json` in the given directory.
   * Merges with existing config (project config takes precedence).
   */
  loadProjectConfig(cwd: string): void {
    const configPath = path.join(cwd, '.void', 'config.json')
    try {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const guardrails = parsed.guardrails as
        | Partial<GuardrailConfig>
        | undefined
      if (guardrails && typeof guardrails === 'object') {
        if (typeof guardrails.enabled === 'boolean') {
          this.config.enabled = guardrails.enabled
        }
        if (typeof guardrails.syntaxCheck === 'boolean') {
          this.config.syntaxCheck = guardrails.syntaxCheck
        }
        if (typeof guardrails.lintOnEdit === 'boolean') {
          this.config.lintOnEdit = guardrails.lintOnEdit
        }
        if (typeof guardrails.rejectInvalidEdits === 'boolean') {
          this.config.rejectInvalidEdits = guardrails.rejectInvalidEdits
        }
        if (typeof guardrails.maxFileSize === 'number') {
          this.config.maxFileSize = guardrails.maxFileSize
        }
        if (Array.isArray(guardrails.blockedPaths)) {
          const projectBlocked = guardrails.blockedPaths
            .filter((p): p is string => typeof p === 'string')
            .map(p => path.resolve(cwd, p))
          this.config.blockedPaths = [
            ...this.config.blockedPaths,
            ...projectBlocked,
          ]
        }
        if (Array.isArray(guardrails.protectedPatterns)) {
          const patterns = guardrails.protectedPatterns.filter(
            (p): p is string => typeof p === 'string',
          )
          this.config.protectedPatterns = [
            ...this.config.protectedPatterns,
            ...patterns,
          ]
        }
      }
    } catch {
      // Config file doesn't exist or is invalid — use defaults
    }
  }

  // ---- Private helpers ----

  /**
   * Check that lines matching protected patterns in the old content
   * are not modified or removed in the new content.
   */
  private checkProtectedPatterns(
    oldContent: string,
    newContent: string,
  ): string[] {
    const errors: string[] = []
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')

    for (const pattern of this.config.protectedPatterns) {
      let regex: RegExp
      try {
        regex = new RegExp(pattern)
      } catch {
        continue // Skip invalid patterns
      }

      for (let i = 0; i < oldLines.length; i++) {
        const oldLine = oldLines[i]!
        if (regex.test(oldLine)) {
          // This line is protected — it must appear unchanged in new content
          const newLine = newLines[i]
          if (newLine === undefined || newLine !== oldLine) {
            errors.push(
              `Protected line modified or removed (line ${i + 1}, pattern: ${pattern}): ${oldLine.trim()}`,
            )
          }
        }
      }
    }

    return errors
  }

  /**
   * Attempt to run a linter on the given file.
   * Tries common linter commands and returns any output as warnings.
   */
  private runLinter(filePath: string): string[] | null {
    const ext = path.extname(filePath).toLowerCase()
    let command: string | null = null

    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        // Try npx eslint first, fall back to biome
        command = `npx --no-install eslint --no-eslintrc --no-ignore --format compact "${filePath}" 2>/dev/null || npx --no-install biome check "${filePath}" 2>/dev/null`
        break
      case '.py':
        command = `python3 -m py_compile "${filePath}" 2>&1`
        break
      default:
        return null
    }

    try {
      execSync(command, {
        timeout: 10_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return null // Linter passed
    } catch (err) {
      const output =
        err && typeof err === 'object' && 'stdout' in err
          ? String((err as { stdout: unknown }).stdout)
          : ''
      if (output.trim()) {
        return output
          .trim()
          .split('\n')
          .map(line => `lint: ${line}`)
      }
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: EditGuardrail | null = null

/**
 * Get or create the singleton EditGuardrail instance.
 */
export function getEditGuardrail(): EditGuardrail {
  if (!_instance) {
    _instance = new EditGuardrail()
  }
  return _instance
}

/**
 * Reset the singleton (useful for testing).
 */
export function resetEditGuardrail(): void {
  _instance = null
}

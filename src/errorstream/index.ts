/**
 * Real-Time Error Streaming — monitors command output and detects errors as
 * they occur. Maintains a history of detected errors and provides statistics,
 * formatting, and basic fix suggestions.
 *
 * Only uses Node.js built-ins; no external dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorSeverity = 'error' | 'warning' | 'info'

export interface ErrorPattern {
  pattern: RegExp
  severity: ErrorSeverity
  language?: string
  framework?: string
}

export interface DetectedError {
  line: string
  lineNumber: number
  pattern: ErrorPattern
  file?: string
  message: string
  timestamp: string
}

export interface ErrorStats {
  total: number
  bySeverity: Record<ErrorSeverity, number>
  byLanguage: Record<string, number>
}

// ---------------------------------------------------------------------------
// ANSI helpers (no dependencies)
// ---------------------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgCyan: '\x1b[46m',
} as const

function colorForSeverity(severity: ErrorSeverity): string {
  switch (severity) {
    case 'error':
      return ANSI.red
    case 'warning':
      return ANSI.yellow
    case 'info':
      return ANSI.cyan
  }
}

function bgForSeverity(severity: ErrorSeverity): string {
  switch (severity) {
    case 'error':
      return ANSI.bgRed
    case 'warning':
      return ANSI.bgYellow
    case 'info':
      return ANSI.bgCyan
  }
}

// ---------------------------------------------------------------------------
// File path extraction helper
// ---------------------------------------------------------------------------

/**
 * Attempt to extract a file path from an error line.  Looks for common
 * patterns such as `path/to/file.ext:line:col` or `File "path"`.
 */
function extractFilePath(line: string): string | undefined {
  // Match patterns like /path/to/file.ts:10:5 or ./file.js:3:1
  const colonMatch = line.match(
    /(?:^|\s)((?:\/|\.\/|\.\.\/)?[\w./@-]+\.[\w]+):\d+/,
  )
  if (colonMatch?.[1]) {
    return colonMatch[1]
  }

  // Python-style: File "path/to/file.py", line N
  const pyMatch = line.match(/File\s+"([^"]+)"/)
  if (pyMatch?.[1]) {
    return pyMatch[1]
  }

  // Rust-style: --> src/main.rs:5:10
  const rustMatch = line.match(/--> ([\w./@-]+\.[\w]+):\d+/)
  if (rustMatch?.[1]) {
    return rustMatch[1]
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Built-in error patterns
// ---------------------------------------------------------------------------

function createBuiltinPatterns(): ErrorPattern[] {
  return [
    // ---- TypeScript ----
    {
      pattern: /TS\d+:/,
      severity: 'error',
      language: 'typescript',
      framework: 'tsc',
    },
    {
      pattern: /error TS\d+/,
      severity: 'error',
      language: 'typescript',
      framework: 'tsc',
    },
    {
      pattern: /Type '.*' is not assignable to type/,
      severity: 'error',
      language: 'typescript',
      framework: 'tsc',
    },
    {
      pattern: /Property '.*' does not exist on type/,
      severity: 'error',
      language: 'typescript',
      framework: 'tsc',
    },
    {
      pattern: /Cannot find module '.*'/,
      severity: 'error',
      language: 'typescript',
      framework: 'tsc',
    },

    // ---- ESLint ----
    {
      pattern: /\d+:\d+\s+error\s/,
      severity: 'error',
      language: 'javascript',
      framework: 'eslint',
    },
    {
      pattern: /\d+:\d+\s+warning\s/,
      severity: 'warning',
      language: 'javascript',
      framework: 'eslint',
    },

    // ---- Node.js ----
    {
      pattern: /SyntaxError:/,
      severity: 'error',
      language: 'javascript',
      framework: 'node',
    },
    {
      pattern: /ReferenceError:/,
      severity: 'error',
      language: 'javascript',
      framework: 'node',
    },
    {
      pattern: /TypeError:/,
      severity: 'error',
      language: 'javascript',
      framework: 'node',
    },
    {
      pattern: /(?:^|\s)Error:/,
      severity: 'error',
      language: 'javascript',
      framework: 'node',
    },
    {
      pattern: /ENOENT/,
      severity: 'error',
      language: 'javascript',
      framework: 'node',
    },
    {
      pattern: /EACCES/,
      severity: 'error',
      language: 'javascript',
      framework: 'node',
    },

    // ---- Python ----
    {
      pattern: /Traceback \(most recent call last\)/,
      severity: 'error',
      language: 'python',
    },
    {
      pattern: /SyntaxError:\s/,
      severity: 'error',
      language: 'python',
    },
    {
      pattern: /ImportError:\s/,
      severity: 'error',
      language: 'python',
    },
    {
      pattern: /ModuleNotFoundError:\s/,
      severity: 'error',
      language: 'python',
    },
    {
      pattern: /IndentationError:\s/,
      severity: 'error',
      language: 'python',
    },

    // ---- Go ----
    {
      pattern: /cannot find package/,
      severity: 'error',
      language: 'go',
    },
    {
      pattern: /undefined:/,
      severity: 'error',
      language: 'go',
    },
    {
      pattern: /syntax error:/,
      severity: 'error',
      language: 'go',
    },

    // ---- Rust ----
    {
      pattern: /error\[E\d+\]/,
      severity: 'error',
      language: 'rust',
      framework: 'rustc',
    },
    {
      pattern: /panicked at/,
      severity: 'error',
      language: 'rust',
      framework: 'rustc',
    },

    // ---- Jest / Vitest ----
    {
      pattern: /FAIL\s/,
      severity: 'error',
      language: 'javascript',
      framework: 'jest',
    },
    {
      pattern: /Expected:/,
      severity: 'info',
      language: 'javascript',
      framework: 'jest',
    },
    {
      pattern: /Received:/,
      severity: 'info',
      language: 'javascript',
      framework: 'jest',
    },

    // ---- General ----
    {
      pattern: /FATAL/,
      severity: 'error',
    },
    {
      pattern: /CRITICAL/,
      severity: 'error',
    },
    {
      pattern: /Segmentation fault/,
      severity: 'error',
    },
    {
      pattern: /\bkilled\b/i,
      severity: 'error',
    },
    {
      pattern: /OOM|Out of memory/i,
      severity: 'error',
    },
  ]
}

// ---------------------------------------------------------------------------
// Suggestions map
// ---------------------------------------------------------------------------

interface SuggestionRule {
  test: RegExp
  suggestion: string
}

const SUGGESTION_RULES: SuggestionRule[] = [
  {
    test: /Cannot find module '(.*)'/,
    suggestion: 'Run `npm install` or check that the module name is spelled correctly.',
  },
  {
    test: /ENOENT.*no such file or directory/i,
    suggestion: 'The file or directory does not exist. Verify the path is correct.',
  },
  {
    test: /EACCES/,
    suggestion: 'Permission denied. Check file permissions or run with elevated privileges.',
  },
  {
    test: /Type '(.*)' is not assignable to type '(.*)'/,
    suggestion: 'Check the types — you may need a type assertion, a type guard, or to update the type definition.',
  },
  {
    test: /Property '(.*)' does not exist on type/,
    suggestion: 'The property may be misspelled, or you need to extend the type definition.',
  },
  {
    test: /ImportError: No module named '(.*)'/,
    suggestion: 'Install the missing Python module with `pip install` or check your virtual environment.',
  },
  {
    test: /ModuleNotFoundError/,
    suggestion: 'The Python module was not found. Ensure it is installed and accessible.',
  },
  {
    test: /IndentationError/,
    suggestion: 'Fix the indentation — Python is sensitive to whitespace. Use consistent spaces or tabs.',
  },
  {
    test: /SyntaxError/,
    suggestion: 'There is a syntax error. Check for missing brackets, quotes, or semicolons.',
  },
  {
    test: /ReferenceError: (.*) is not defined/,
    suggestion: 'The variable or function is not defined in scope. Check for typos or missing imports.',
  },
  {
    test: /TypeError: (.*) is not a function/,
    suggestion: 'The value is not callable. Verify the import and check that the API has not changed.',
  },
  {
    test: /cannot find package/,
    suggestion: 'Run `go get` to fetch the missing package, or check your module path.',
  },
  {
    test: /error\[E\d+\]/,
    suggestion: 'See the Rust compiler error index at https://doc.rust-lang.org/error_codes/ for details.',
  },
  {
    test: /panicked at/,
    suggestion: 'A Rust panic occurred. Check for unwrap() on None/Err values or array out-of-bounds access.',
  },
  {
    test: /Segmentation fault/,
    suggestion: 'Segfault detected — likely a memory access violation. Check for null pointers or buffer overflows.',
  },
  {
    test: /OOM|Out of memory/i,
    suggestion: 'The process ran out of memory. Reduce memory usage or increase the available memory limit.',
  },
  {
    test: /FAIL\s/,
    suggestion: 'One or more tests failed. Review the Expected/Received output for details.',
  },
]

// ---------------------------------------------------------------------------
// ErrorStreamManager
// ---------------------------------------------------------------------------

const MAX_HISTORY = 100

export class ErrorStreamManager {
  private patterns: ErrorPattern[]
  private errors: DetectedError[] = []

  constructor() {
    this.patterns = createBuiltinPatterns()
  }

  // ----- Pattern management -----

  addPattern(pattern: ErrorPattern): void {
    this.patterns.push(pattern)
  }

  removePattern(index: number): boolean {
    if (index < 0 || index >= this.patterns.length) {
      return false
    }
    this.patterns.splice(index, 1)
    return true
  }

  getPatterns(): ReadonlyArray<ErrorPattern> {
    return this.patterns
  }

  // ----- Line processing -----

  processLine(line: string, lineNumber: number): DetectedError | null {
    for (const pattern of this.patterns) {
      if (pattern.pattern.test(line)) {
        const detected: DetectedError = {
          line,
          lineNumber,
          pattern,
          file: extractFilePath(line),
          message: line.trim(),
          timestamp: new Date().toISOString(),
        }
        this.pushError(detected)
        return detected
      }
    }
    return null
  }

  // ----- Multi-line processing -----

  processOutput(output: string): DetectedError[] {
    const lines = output.split('\n')
    const results: DetectedError[] = []
    for (let i = 0; i < lines.length; i++) {
      const detected = this.processLine(lines[i]!, i + 1)
      if (detected) {
        results.push(detected)
      }
    }
    return results
  }

  // ----- Error history -----

  getRecentErrors(limit: number = 20): ReadonlyArray<DetectedError> {
    const start = Math.max(0, this.errors.length - limit)
    return this.errors.slice(start)
  }

  clearErrors(): void {
    this.errors = []
  }

  // ----- Statistics -----

  getErrorStats(): ErrorStats {
    const bySeverity: Record<ErrorSeverity, number> = {
      error: 0,
      warning: 0,
      info: 0,
    }
    const byLanguage: Record<string, number> = {}

    for (const err of this.errors) {
      bySeverity[err.pattern.severity]++
      const lang = err.pattern.language ?? 'unknown'
      byLanguage[lang] = (byLanguage[lang] ?? 0) + 1
    }

    return {
      total: this.errors.length,
      bySeverity,
      byLanguage,
    }
  }

  // ----- Formatting -----

  formatError(error: DetectedError): string {
    const sev = error.pattern.severity.toUpperCase()
    const sevColor = colorForSeverity(error.pattern.severity)
    const sevBg = bgForSeverity(error.pattern.severity)
    const ts = error.timestamp.slice(11, 19) // HH:MM:SS

    const parts: string[] = []

    // Timestamp
    parts.push(`${ANSI.dim}${ts}${ANSI.reset}`)

    // Severity badge
    parts.push(
      `${sevBg}${ANSI.bold} ${sev} ${ANSI.reset}`,
    )

    // File location (if available)
    if (error.file) {
      parts.push(`${ANSI.white}${error.file}${ANSI.reset}`)
    }

    // Line number
    parts.push(`${ANSI.dim}L${error.lineNumber}${ANSI.reset}`)

    // Language / framework tag
    const tags: string[] = []
    if (error.pattern.language) {
      tags.push(error.pattern.language)
    }
    if (error.pattern.framework) {
      tags.push(error.pattern.framework)
    }
    if (tags.length > 0) {
      parts.push(`${ANSI.gray}[${tags.join('/')}]${ANSI.reset}`)
    }

    const header = parts.join(' ')
    const body = `  ${sevColor}${error.message}${ANSI.reset}`

    return `${header}\n${body}`
  }

  // ----- Suggestions -----

  getSuggestion(error: DetectedError): string | null {
    for (const rule of SUGGESTION_RULES) {
      if (rule.test.test(error.line)) {
        return rule.suggestion
      }
    }
    return null
  }

  // ----- Internal -----

  private pushError(error: DetectedError): void {
    this.errors.push(error)
    if (this.errors.length > MAX_HISTORY) {
      this.errors = this.errors.slice(this.errors.length - MAX_HISTORY)
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ErrorStreamManager | null = null

export function getErrorStreamManager(): ErrorStreamManager {
  if (!instance) {
    instance = new ErrorStreamManager()
  }
  return instance
}

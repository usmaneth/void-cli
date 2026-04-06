/**
 * AutoLintTestManager — automatic linting and testing after AI edits.
 *
 * Runs configurable lint and test commands after file edits, parses output
 * for errors using regex patterns, and feeds errors back as structured results.
 *
 * Config persisted at ~/.void/autolint.json. Uses only Node.js built-ins.
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutoLintConfig = {
  enabled: boolean
  lintCmd: string
  testCmd: string
  autoFix: boolean
  maxRetries: number
}

export type LintError = {
  file: string
  line: number
  col: number
  message: string
  severity: 'error' | 'warning'
}

export type LintResult = {
  success: boolean
  errors: LintError[]
  rawOutput: string
}

export type TestResult = {
  success: boolean
  passed: number
  failed: number
  errors: string[]
  rawOutput: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONFIG_DIR = path.join(os.homedir(), '.void')
const CONFIG_PATH = path.join(CONFIG_DIR, 'autolint.json')

const DEFAULT_CONFIG: AutoLintConfig = {
  enabled: false,
  lintCmd: '',
  testCmd: '',
  autoFix: false,
  maxRetries: 3,
}

// ---------------------------------------------------------------------------
// Error-parsing patterns
// ---------------------------------------------------------------------------

// TypeScript: src/foo.ts(12,5): error TS2304: Cannot find name 'x'.
const TS_ERROR_RE =
  /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.+)$/

// ESLint default formatter:  /path/file.ts
//   12:5  error  Some message  rule-name
const ESLINT_LINE_RE = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}\S+$/

// Generic "file:line:col: severity: message" (gcc, rustc, many others)
const GENERIC_RE = /^(.+?):(\d+):(\d+):\s*(error|warning)[:\s]+(.+)$/

// ---------------------------------------------------------------------------
// Test-output parsing helpers
// ---------------------------------------------------------------------------

// Jest: Tests: 2 failed, 8 passed, 10 total
const JEST_SUMMARY_RE =
  /Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed,\s+\d+\s+total/

// Generic "X passing", "Y failing" (Mocha-style)
const MOCHA_PASS_RE = /(\d+)\s+passing/
const MOCHA_FAIL_RE = /(\d+)\s+failing/

// ---------------------------------------------------------------------------
// AutoLintTestManager
// ---------------------------------------------------------------------------

export class AutoLintTestManager {
  private config: AutoLintConfig
  private stats = { lintRuns: 0, testRuns: 0, autoFixCount: 0 }

  constructor() {
    this.config = this.loadConfig()
  }

  // ---- Config persistence -------------------------------------------------

  private loadConfig(): AutoLintConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<AutoLintConfig>
        return { ...DEFAULT_CONFIG, ...parsed }
      }
    } catch {
      // Corrupt file — fall back to defaults
    }
    return { ...DEFAULT_CONFIG }
  }

  private saveConfig(): void {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true })
      }
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8')
    } catch {
      // Best-effort persistence
    }
  }

  // ---- Public API ---------------------------------------------------------

  configure(opts: Partial<AutoLintConfig>): void {
    this.config = { ...this.config, ...opts }
    this.saveConfig()
  }

  getConfig(): AutoLintConfig {
    return { ...this.config }
  }

  enable(): void {
    this.configure({ enabled: true })
  }

  disable(): void {
    this.configure({ enabled: false })
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  getStats(): { lintRuns: number; testRuns: number; autoFixCount: number } {
    return { ...this.stats }
  }

  // ---- Lint ---------------------------------------------------------------

  runLint(files?: string[]): LintResult {
    this.stats.lintRuns++
    const cmd = this.resolveLintCmd(files)
    if (!cmd) {
      return { success: true, errors: [], rawOutput: '(no lint command configured or detected)' }
    }

    const rawOutput = this.exec(cmd)
    const errors = this.parseLintOutput(rawOutput)
    const success = errors.filter((e) => e.severity === 'error').length === 0

    return { success, errors, rawOutput }
  }

  // ---- Tests --------------------------------------------------------------

  runTests(): TestResult {
    this.stats.testRuns++
    const cmd = this.resolveTestCmd()
    if (!cmd) {
      return { success: true, passed: 0, failed: 0, errors: [], rawOutput: '(no test command configured or detected)' }
    }

    const rawOutput = this.exec(cmd)
    return this.parseTestOutput(rawOutput)
  }

  // ---- Run all ------------------------------------------------------------

  runAll(files?: string[]): { lint: LintResult; test: TestResult } {
    const lint = this.runLint(files)
    const test = this.runTests()

    if (this.config.autoFix && (!lint.success || !test.success)) {
      this.stats.autoFixCount++
    }

    return { lint, test }
  }

  // ---- Command resolution -------------------------------------------------

  private resolveLintCmd(files?: string[]): string {
    let cmd = this.config.lintCmd

    if (!cmd) {
      cmd = this.detectLintCmd()
    }

    if (cmd && files && files.length > 0) {
      cmd = `${cmd} ${files.map((f) => `"${f}"`).join(' ')}`
    }

    return cmd
  }

  private resolveTestCmd(): string {
    if (this.config.testCmd) {
      return this.config.testCmd
    }
    return this.detectTestCmd()
  }

  /**
   * Auto-detect lint command by inspecting the project.
   * Prefers tsconfig.json presence for TypeScript projects.
   */
  private detectLintCmd(): string {
    try {
      if (fs.existsSync(path.join(process.cwd(), 'tsconfig.json'))) {
        return 'npx tsc --noEmit'
      }
    } catch {
      // ignore
    }
    return ''
  }

  /**
   * Auto-detect test command from package.json scripts.test.
   */
  private detectTestCmd(): string {
    try {
      const pkgPath = path.join(process.cwd(), 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        if (pkg?.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
          return `npm test`
        }
      }
    } catch {
      // ignore
    }
    return ''
  }

  // ---- Execution ----------------------------------------------------------

  private exec(cmd: string): string {
    try {
      const output = execSync(cmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120_000,
      })
      return output
    } catch (err: unknown) {
      // execSync throws on non-zero exit — we still want the output
      if (err && typeof err === 'object' && 'stdout' in err && 'stderr' in err) {
        const e = err as { stdout: string; stderr: string }
        return (e.stdout || '') + (e.stderr || '')
      }
      if (err instanceof Error) {
        return err.message
      }
      return String(err)
    }
  }

  // ---- Lint output parsing ------------------------------------------------

  private parseLintOutput(raw: string): LintError[] {
    const errors: LintError[] = []
    const lines = raw.split('\n')
    let currentFile = ''

    for (const line of lines) {
      // TypeScript errors
      const tsMatch = TS_ERROR_RE.exec(line)
      if (tsMatch) {
        errors.push({
          file: tsMatch[1]!,
          line: parseInt(tsMatch[2]!, 10),
          col: parseInt(tsMatch[3]!, 10),
          message: tsMatch[5]!,
          severity: tsMatch[4] as 'error' | 'warning',
        })
        continue
      }

      // ESLint: track current file header (non-indented absolute or relative path)
      if (/^[/.]?\S+\.\w+$/.test(line.trim()) && !line.startsWith(' ')) {
        currentFile = line.trim()
        continue
      }

      // ESLint line errors
      const eslintMatch = ESLINT_LINE_RE.exec(line)
      if (eslintMatch && currentFile) {
        errors.push({
          file: currentFile,
          line: parseInt(eslintMatch[1]!, 10),
          col: parseInt(eslintMatch[2]!, 10),
          message: eslintMatch[4]!,
          severity: eslintMatch[3] as 'error' | 'warning',
        })
        continue
      }

      // Generic file:line:col pattern
      const genericMatch = GENERIC_RE.exec(line)
      if (genericMatch) {
        errors.push({
          file: genericMatch[1]!,
          line: parseInt(genericMatch[2]!, 10),
          col: parseInt(genericMatch[3]!, 10),
          message: genericMatch[5]!,
          severity: genericMatch[4] as 'error' | 'warning',
        })
        continue
      }
    }

    return errors
  }

  // ---- Test output parsing ------------------------------------------------

  private parseTestOutput(raw: string): TestResult {
    let passed = 0
    let failed = 0
    const errors: string[] = []

    // Try Jest summary
    const jestMatch = JEST_SUMMARY_RE.exec(raw)
    if (jestMatch) {
      failed = jestMatch[1] ? parseInt(jestMatch[1], 10) : 0
      passed = parseInt(jestMatch[2]!, 10)
    } else {
      // Try Mocha-style
      const passMatch = MOCHA_PASS_RE.exec(raw)
      const failMatch = MOCHA_FAIL_RE.exec(raw)
      if (passMatch) passed = parseInt(passMatch[1]!, 10)
      if (failMatch) failed = parseInt(failMatch[1]!, 10)
    }

    // Collect failure lines — lines that start with common failure markers
    const lines = raw.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (
        trimmed.startsWith('FAIL ') ||
        trimmed.startsWith('● ') ||
        trimmed.startsWith('AssertionError') ||
        trimmed.startsWith('Error:') ||
        trimmed.match(/^\d+\)\s+/)
      ) {
        errors.push(trimmed)
      }
    }

    const success = failed === 0 && !raw.includes('FAIL')
    return { success, passed, failed, errors, rawOutput: raw }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: AutoLintTestManager | null = null

export function getAutoLintTestManager(): AutoLintTestManager {
  if (!instance) {
    instance = new AutoLintTestManager()
  }
  return instance
}

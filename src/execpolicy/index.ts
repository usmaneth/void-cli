import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Decision = 'allow' | 'prompt' | 'forbidden'

export interface PolicyRule {
  pattern: string[]
  decision: Decision
  justification?: string
}

export interface CheckResult {
  decision: Decision
  rule?: PolicyRule
  justification?: string
}

interface PolicyFile {
  rules: PolicyRule[]
}

// ---------------------------------------------------------------------------
// Pattern matching utilities
// ---------------------------------------------------------------------------

/**
 * Match a single segment against a glob-style pattern token.
 * Supports `*` as a wildcard that matches any sequence of characters within
 * a single segment.
 */
function segmentMatches(segment: string, pattern: string): boolean {
  // Fast paths
  if (pattern === '*') {
    return true
  }
  if (!pattern.includes('*')) {
    return segment === pattern
  }

  // Convert glob pattern to regex
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$'
  return new RegExp(regexStr).test(segment)
}

/**
 * Tokenise a command string into segments, respecting basic quoting.
 * We split on whitespace but preserve quoted substrings as single tokens.
 */
function tokenise(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current.length > 0) {
    tokens.push(current)
  }
  return tokens
}

/**
 * Check whether a tokenised command matches a pattern (array of glob tokens).
 *
 * The pattern may be shorter than the command — it only needs to match a
 * prefix of the command tokens. A trailing `*` in the pattern matches any
 * remaining tokens.
 */
function commandMatchesPattern(
  commandTokens: string[],
  pattern: string[],
): boolean {
  if (pattern.length === 0) {
    return false
  }

  for (let i = 0; i < pattern.length; i++) {
    const pat = pattern[i]!

    // A standalone `*` as the last pattern token matches everything remaining.
    if (pat === '*' && i === pattern.length - 1) {
      return true
    }

    // If the command has fewer tokens than the pattern requires, no match.
    if (i >= commandTokens.length) {
      return false
    }

    if (!segmentMatches(commandTokens[i]!, pat)) {
      return false
    }
  }

  // Pattern fully consumed — match even if extra command tokens remain
  // (prefix matching). If the pattern is exactly the command, that's
  // also a match.
  return true
}

// ---------------------------------------------------------------------------
// Decision priority helpers
// ---------------------------------------------------------------------------

const DECISION_PRIORITY: Record<Decision, number> = {
  forbidden: 3,
  prompt: 2,
  allow: 1,
}

// ---------------------------------------------------------------------------
// Default rules
// ---------------------------------------------------------------------------

function getDefaultRules(): PolicyRule[] {
  return [
    // Allow rules
    { pattern: ['ls'], decision: 'allow', justification: 'Safe read-only listing' },
    { pattern: ['ls', '*'], decision: 'allow', justification: 'Safe read-only listing' },
    { pattern: ['cat', '*'], decision: 'allow', justification: 'Safe read-only file viewing' },
    { pattern: ['head', '*'], decision: 'allow', justification: 'Safe read-only file viewing' },
    { pattern: ['tail', '*'], decision: 'allow', justification: 'Safe read-only file viewing' },
    { pattern: ['echo', '*'], decision: 'allow', justification: 'Safe output command' },
    { pattern: ['pwd'], decision: 'allow', justification: 'Safe read-only command' },
    { pattern: ['git', 'status'], decision: 'allow', justification: 'Safe read-only git command' },
    { pattern: ['git', 'status', '*'], decision: 'allow', justification: 'Safe read-only git command' },
    { pattern: ['git', 'log'], decision: 'allow', justification: 'Safe read-only git command' },
    { pattern: ['git', 'log', '*'], decision: 'allow', justification: 'Safe read-only git command' },
    { pattern: ['git', 'diff'], decision: 'allow', justification: 'Safe read-only git command' },
    { pattern: ['git', 'diff', '*'], decision: 'allow', justification: 'Safe read-only git command' },
    { pattern: ['npm', 'test'], decision: 'allow', justification: 'Safe test runner' },
    { pattern: ['npm', 'test', '*'], decision: 'allow', justification: 'Safe test runner' },
    { pattern: ['npm', 'run'], decision: 'allow', justification: 'Safe script runner' },
    { pattern: ['npm', 'run', '*'], decision: 'allow', justification: 'Safe script runner' },

    // Prompt rules
    { pattern: ['git', 'push'], decision: 'prompt', justification: 'Pushes code to remote' },
    { pattern: ['git', 'push', '*'], decision: 'prompt', justification: 'Pushes code to remote' },
    { pattern: ['git', 'commit'], decision: 'prompt', justification: 'Creates a commit' },
    { pattern: ['git', 'commit', '*'], decision: 'prompt', justification: 'Creates a commit' },
    { pattern: ['npm', 'install'], decision: 'prompt', justification: 'Modifies node_modules' },
    { pattern: ['npm', 'install', '*'], decision: 'prompt', justification: 'Modifies node_modules' },
    { pattern: ['rm', '*'], decision: 'prompt', justification: 'Deletes files' },
    { pattern: ['mv', '*'], decision: 'prompt', justification: 'Moves/renames files' },
    { pattern: ['cp', '*'], decision: 'prompt', justification: 'Copies files' },
    { pattern: ['chmod', '*'], decision: 'prompt', justification: 'Changes file permissions' },

    // Forbidden rules
    { pattern: ['rm', '-rf', '/'], decision: 'forbidden', justification: 'Destroys entire filesystem' },
    { pattern: ['sudo', 'rm', '*'], decision: 'forbidden', justification: 'Privileged file deletion' },
    { pattern: ['mkfs', '*'], decision: 'forbidden', justification: 'Formats filesystem' },
    { pattern: ['mkfs'], decision: 'forbidden', justification: 'Formats filesystem' },
    { pattern: ['dd', 'if=*'], decision: 'forbidden', justification: 'Raw disk write — destructive' },
    { pattern: [':(){ :|:& };:'], decision: 'forbidden', justification: 'Fork bomb' },
  ]
}

// ---------------------------------------------------------------------------
// Policy file I/O
// ---------------------------------------------------------------------------

function globalPolicyPath(): string {
  return join(homedir(), '.void', 'policies.json')
}

function projectPolicyPath(): string {
  return join(process.cwd(), '.void', 'policies.json')
}

function readPolicyFile(filePath: string): PolicyRule[] {
  if (!existsSync(filePath)) {
    return []
  }
  const raw = readFileSync(filePath, 'utf-8')
  const parsed: PolicyFile = JSON.parse(raw)
  if (!Array.isArray(parsed.rules)) {
    throw new Error(`Invalid policy file at ${filePath}: missing "rules" array`)
  }
  return parsed.rules.map(validateRule)
}

function writePolicyFile(filePath: string, rules: PolicyRule[]): void {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const data: PolicyFile = { rules }
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

function validateRule(rule: unknown): PolicyRule {
  if (typeof rule !== 'object' || rule === null) {
    throw new Error('Policy rule must be an object')
  }
  const r = rule as Record<string, unknown>

  if (!Array.isArray(r.pattern) || r.pattern.length === 0) {
    throw new Error('Policy rule must have a non-empty "pattern" array of strings')
  }
  for (const seg of r.pattern) {
    if (typeof seg !== 'string') {
      throw new Error('Each element of "pattern" must be a string')
    }
  }

  if (r.decision !== 'allow' && r.decision !== 'prompt' && r.decision !== 'forbidden') {
    throw new Error(`Invalid decision "${String(r.decision)}" — must be allow, prompt, or forbidden`)
  }

  const out: PolicyRule = {
    pattern: r.pattern as string[],
    decision: r.decision as Decision,
  }
  if (typeof r.justification === 'string' && r.justification.length > 0) {
    out.justification = r.justification
  }
  return out
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

interface PolicyConflict {
  ruleA: { index: number; rule: PolicyRule }
  ruleB: { index: number; rule: PolicyRule }
  reason: string
}

/**
 * Two patterns conflict if one is a prefix/superset of the other and they
 * have different decisions at the same priority tier.
 */
function patternsOverlap(a: string[], b: string[]): boolean {
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a

  for (let i = 0; i < shorter.length; i++) {
    const sPat = shorter[i]!
    const lPat = longer[i]!

    // If either side is a wildcard at the end, they overlap.
    if ((sPat === '*' && i === shorter.length - 1) || (lPat === '*' && i === longer.length - 1)) {
      return true
    }

    // Check if the segments could match the same strings.
    if (sPat === lPat) {
      continue
    }
    if (sPat === '*' || lPat === '*') {
      continue
    }
    // Both are literal and differ — no overlap.
    if (!sPat.includes('*') && !lPat.includes('*') && sPat !== lPat) {
      return false
    }
    // At least one has a partial wildcard — conservatively say they overlap.
  }
  return true
}

// ---------------------------------------------------------------------------
// ExecPolicy class
// ---------------------------------------------------------------------------

export class ExecPolicy {
  private rules: PolicyRule[] = []

  /**
   * Load rules from a specific JSON file path.
   */
  loadFromFile(filePath: string): void {
    const loaded = readPolicyFile(filePath)
    this.rules = loaded
  }

  /**
   * Load rules from the project-level `.void/policies.json`.
   */
  loadFromProject(): void {
    const loaded = readPolicyFile(projectPolicyPath())
    if (loaded.length > 0) {
      this.rules = loaded
    }
  }

  /**
   * Load the built-in default rules.
   */
  loadDefaults(): void {
    this.rules = getDefaultRules()
  }

  /**
   * Initialise the policy engine by merging defaults, global, and project
   * rules. Project rules take precedence over global, which take precedence
   * over defaults.
   */
  loadAll(): void {
    const defaults = getDefaultRules()
    const global = readPolicyFile(globalPolicyPath())
    const project = readPolicyFile(projectPolicyPath())

    // Later entries win during matching — place most-specific last.
    this.rules = [...defaults, ...global, ...project]
  }

  /**
   * Check a command string against the loaded rules.
   *
   * Returns the highest-priority matching decision. Among rules of the same
   * priority tier, the last-loaded rule wins (so project overrides global,
   * global overrides defaults).
   */
  checkCommand(command: string): CheckResult {
    const tokens = tokenise(command.trim())
    if (tokens.length === 0) {
      return { decision: 'allow' }
    }

    // Also try matching the raw command (for fork-bomb etc.)
    const rawTokens = [command.trim()]

    let bestDecision: Decision = 'allow'
    let bestPriority = 0
    let bestRule: PolicyRule | undefined
    let bestSpecificity = -1

    for (const rule of this.rules) {
      const matchesTokenised = commandMatchesPattern(tokens, rule.pattern)
      const matchesRaw = commandMatchesPattern(rawTokens, rule.pattern)

      if (!matchesTokenised && !matchesRaw) {
        continue
      }

      const priority = DECISION_PRIORITY[rule.decision]
      const specificity = rule.pattern.length

      // Higher priority wins; within same priority, prefer more specific
      // (longer pattern); within same specificity, last-loaded wins.
      if (
        priority > bestPriority ||
        (priority === bestPriority && specificity >= bestSpecificity)
      ) {
        bestDecision = rule.decision
        bestPriority = priority
        bestRule = rule
        bestSpecificity = specificity
      }
    }

    const result: CheckResult = { decision: bestDecision }
    if (bestRule) {
      result.rule = bestRule
      if (bestRule.justification) {
        result.justification = bestRule.justification
      }
    }
    return result
  }

  /**
   * Add a rule to the policy. It is appended at the end (highest precedence
   * within its priority tier).
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(validateRule(rule))
  }

  /**
   * Remove a rule by its index.
   */
  removeRule(index: number): PolicyRule | undefined {
    if (index < 0 || index >= this.rules.length) {
      return undefined
    }
    return this.rules.splice(index, 1)[0]
  }

  /**
   * Return a copy of all loaded rules.
   */
  listRules(): PolicyRule[] {
    return [...this.rules]
  }

  /**
   * Return the number of rules.
   */
  get ruleCount(): number {
    return this.rules.length
  }

  /**
   * Validate the current rule set and return any detected conflicts.
   * A conflict exists when two rules with overlapping patterns have
   * different decisions (after precedence is considered, the lower-priority
   * rule is effectively shadowed, which may be unintentional).
   */
  validate(): PolicyConflict[] {
    const conflicts: PolicyConflict[] = []
    for (let i = 0; i < this.rules.length; i++) {
      for (let j = i + 1; j < this.rules.length; j++) {
        const a = this.rules[i]!
        const b = this.rules[j]!
        if (a.decision === b.decision) {
          continue
        }
        if (patternsOverlap(a.pattern, b.pattern)) {
          conflicts.push({
            ruleA: { index: i, rule: a },
            ruleB: { index: j, rule: b },
            reason: `Overlapping patterns with different decisions: [${a.pattern.join(' ')}] (${a.decision}) vs [${b.pattern.join(' ')}] (${b.decision})`,
          })
        }
      }
    }
    return conflicts
  }

  /**
   * Persist the current rule set to the global policy file.
   */
  saveGlobal(): void {
    writePolicyFile(globalPolicyPath(), this.rules)
  }

  /**
   * Persist the current rule set to the project policy file.
   */
  saveProject(): void {
    writePolicyFile(projectPolicyPath(), this.rules)
  }

  /**
   * Create a project `.void/policies.json` seeded with the defaults.
   */
  initProject(): string {
    const path = projectPolicyPath()
    writePolicyFile(path, getDefaultRules())
    return path
  }

  /**
   * Reset the engine to the built-in defaults.
   */
  reset(): void {
    this.rules = getDefaultRules()
  }

  /**
   * Return a human-readable summary of the policy.
   */
  summary(): string {
    const counts = { allow: 0, prompt: 0, forbidden: 0 }
    for (const rule of this.rules) {
      counts[rule.decision]++
    }
    return [
      `ExecPolicy: ${this.rules.length} rules loaded`,
      `  allow:     ${counts.allow}`,
      `  prompt:    ${counts.prompt}`,
      `  forbidden: ${counts.forbidden}`,
    ].join('\n')
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ExecPolicy | undefined

/**
 * Returns the singleton ExecPolicy manager. On first call the engine is
 * initialised with defaults + global + project rules.
 */
export function getExecPolicyManager(): ExecPolicy {
  if (!instance) {
    instance = new ExecPolicy()
    instance.loadAll()
  }
  return instance
}

/**
 * Reset the singleton (primarily for testing).
 */
export function resetExecPolicyManager(): void {
  instance = undefined
}

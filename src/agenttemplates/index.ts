import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentTemplate = {
  slug: string
  name: string
  description: string
  systemPrompt: string
  enabledTools: string[]
  maxTurns: number
  personality?: string
  category: string
}

export type AgentInstance = {
  id: string
  template: string
  name: string
  config: AgentTemplate
  createdAt: string
  lastUsedAt?: string
}

type ActiveState = {
  slug: string
  activatedAt: string
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const BUILTIN_TEMPLATES: AgentTemplate[] = [
  {
    slug: 'code-reviewer',
    name: 'Senior Code Reviewer',
    description:
      'Focuses on code quality, best practices, and security during reviews',
    systemPrompt: [
      'You are a senior code reviewer. Your primary focus is on:',
      '- Code quality and readability',
      '- Adherence to best practices and established patterns',
      '- Security vulnerabilities and potential attack vectors',
      '- Performance implications of code changes',
      '- Proper error handling and edge cases',
      '- Consistency with the existing codebase style',
      '',
      'When reviewing code:',
      '1. Start with a high-level summary of the changes',
      '2. Identify critical issues (bugs, security, data loss) first',
      '3. Then note style and maintainability concerns',
      '4. Suggest concrete improvements with code examples',
      '5. Acknowledge what was done well',
      '',
      'Be thorough but constructive. Explain the "why" behind each suggestion.',
    ].join('\n'),
    enabledTools: ['Read', 'Grep', 'Glob', 'Bash'],
    maxTurns: 10,
    personality: 'thorough, constructive, detail-oriented',
    category: 'code-quality',
  },
  {
    slug: 'debugger',
    name: 'Debug Detective',
    description:
      'Systematic debugging, error analysis, and root cause identification',
    systemPrompt: [
      'You are a debugging expert. Your approach is systematic and methodical:',
      '',
      '1. UNDERSTAND: Gather information about the bug — error messages, logs, reproduction steps',
      '2. HYPOTHESIZE: Form theories about the root cause based on the evidence',
      '3. ISOLATE: Narrow down the problem by examining relevant code paths',
      '4. VERIFY: Confirm the root cause with evidence from the codebase',
      '5. FIX: Propose a targeted fix that addresses the root cause, not just symptoms',
      '6. PREVENT: Suggest tests or safeguards to prevent recurrence',
      '',
      'When debugging:',
      '- Read error messages and stack traces carefully',
      '- Trace data flow from input to the point of failure',
      '- Check for common pitfalls: null/undefined, race conditions, off-by-one, type coercion',
      '- Consider recent changes that may have introduced the regression',
      '- Look for similar patterns elsewhere that might have the same bug',
    ].join('\n'),
    enabledTools: ['Read', 'Grep', 'Glob', 'Bash'],
    maxTurns: 15,
    personality: 'methodical, curious, persistent',
    category: 'code-quality',
  },
  {
    slug: 'documentarian',
    name: 'Documentation Writer',
    description:
      'Writes and improves docstrings, READMEs, and API documentation',
    systemPrompt: [
      'You are a documentation specialist. Your goal is to make code understandable and accessible.',
      '',
      'Your documentation principles:',
      '- Write for the reader, not the writer',
      '- Start with the "what" and "why" before the "how"',
      '- Use concrete examples to illustrate abstract concepts',
      '- Keep documentation close to the code it describes',
      '- Maintain a consistent tone and format throughout',
      '',
      'Types of documentation you produce:',
      '- Inline comments for complex logic',
      '- JSDoc/TSDoc docstrings for functions, classes, and modules',
      '- README files with setup, usage, and architecture overviews',
      '- API reference documentation with parameter descriptions and examples',
      '- Architecture decision records for significant design choices',
      '',
      'Always check existing documentation style in the project and match it.',
    ].join('\n'),
    enabledTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write'],
    maxTurns: 10,
    personality: 'clear, organized, empathetic to readers',
    category: 'documentation',
  },
  {
    slug: 'refactorer',
    name: 'Refactoring Expert',
    description:
      'Clean code advocate — design patterns, DRY, and structural improvements',
    systemPrompt: [
      'You are a refactoring expert. You improve code structure without changing behavior.',
      '',
      'Core principles:',
      '- DRY (Don\'t Repeat Yourself) — extract common patterns',
      '- Single Responsibility — each function/class does one thing well',
      '- Open/Closed — open for extension, closed for modification',
      '- Favor composition over inheritance',
      '- Keep functions short and focused',
      '- Use meaningful names that reveal intent',
      '',
      'Refactoring approach:',
      '1. Understand the current behavior thoroughly before changing anything',
      '2. Ensure adequate test coverage exists (or suggest adding it first)',
      '3. Make small, incremental changes that can be verified independently',
      '4. Extract methods, rename variables, simplify conditionals',
      '5. Identify and apply appropriate design patterns',
      '6. Verify that all tests still pass after each change',
      '',
      'Common refactorings you apply:',
      '- Extract Method/Function for long functions',
      '- Replace conditional with polymorphism',
      '- Introduce Parameter Object for long parameter lists',
      '- Replace magic numbers/strings with named constants',
      '- Simplify nested conditionals with early returns',
    ].join('\n'),
    enabledTools: ['Read', 'Grep', 'Glob', 'Edit', 'Bash'],
    maxTurns: 15,
    personality: 'pragmatic, systematic, quality-focused',
    category: 'code-quality',
  },
  {
    slug: 'test-writer',
    name: 'Test Engineer',
    description:
      'Creates unit tests, integration tests, and improves test coverage',
    systemPrompt: [
      'You are a test engineering specialist. You write thorough, maintainable tests.',
      '',
      'Testing philosophy:',
      '- Tests document expected behavior',
      '- Test behavior, not implementation details',
      '- Each test should verify one logical concept',
      '- Tests should be fast, isolated, and repeatable',
      '- Prefer integration tests for critical paths, unit tests for logic',
      '',
      'When writing tests:',
      '1. Analyze the code under test for all code paths and edge cases',
      '2. Use the Arrange-Act-Assert (AAA) pattern',
      '3. Write descriptive test names that explain the scenario and expected outcome',
      '4. Cover happy paths, error cases, boundary conditions, and edge cases',
      '5. Use appropriate mocking — mock external dependencies, not internal logic',
      '6. Check the existing test framework and patterns in the project',
      '',
      'Test categories to consider:',
      '- Happy path: normal expected usage',
      '- Edge cases: empty inputs, null, boundary values',
      '- Error handling: invalid inputs, network failures, timeouts',
      '- Concurrency: race conditions, ordering',
      '- Security: injection, overflow, unauthorized access',
    ].join('\n'),
    enabledTools: ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash'],
    maxTurns: 15,
    personality: 'meticulous, coverage-driven, practical',
    category: 'testing',
  },
  {
    slug: 'security-auditor',
    name: 'Security Auditor',
    description:
      'OWASP-aware security analysis, CVE awareness, vulnerability scanning',
    systemPrompt: [
      'You are a security auditor. You identify vulnerabilities and recommend mitigations.',
      '',
      'Your security review covers:',
      '- OWASP Top 10 vulnerabilities (injection, broken auth, XSS, etc.)',
      '- Dependency vulnerabilities and known CVEs',
      '- Authentication and authorization flaws',
      '- Data exposure and privacy concerns',
      '- Cryptographic weaknesses',
      '- Input validation and sanitization gaps',
      '- Insecure configurations and defaults',
      '',
      'Methodology:',
      '1. Map the attack surface — entry points, data flows, trust boundaries',
      '2. Review authentication and session management',
      '3. Check input validation at all entry points',
      '4. Examine data storage and transmission security',
      '5. Analyze error handling for information leakage',
      '6. Review dependency versions for known vulnerabilities',
      '7. Check for hardcoded secrets, tokens, or credentials',
      '',
      'For each finding, report:',
      '- Severity (Critical / High / Medium / Low / Informational)',
      '- Description of the vulnerability',
      '- Potential impact if exploited',
      '- Concrete remediation steps with code examples',
    ].join('\n'),
    enabledTools: ['Read', 'Grep', 'Glob', 'Bash'],
    maxTurns: 12,
    personality: 'vigilant, precise, risk-aware',
    category: 'security',
  },
  {
    slug: 'architect',
    name: 'System Architect',
    description:
      'High-level system design, tradeoff analysis, and scalability planning',
    systemPrompt: [
      'You are a system architect. You think about the big picture — structure, scalability, and tradeoffs.',
      '',
      'Architectural concerns you address:',
      '- System decomposition and module boundaries',
      '- Data flow and state management',
      '- API design and contracts between components',
      '- Scalability and performance characteristics',
      '- Reliability, fault tolerance, and resilience',
      '- Technology selection and tradeoff analysis',
      '- Migration strategies and backward compatibility',
      '',
      'When analyzing architecture:',
      '1. Understand current system structure and constraints',
      '2. Identify the key quality attributes (performance, scalability, maintainability)',
      '3. Evaluate tradeoffs explicitly — every decision has costs and benefits',
      '4. Consider operational concerns: deployment, monitoring, debugging',
      '5. Plan for evolution — how will this change over time?',
      '6. Document decisions and their rationale',
      '',
      'Communication style:',
      '- Use diagrams and clear abstractions',
      '- Present options with pros/cons rather than single solutions',
      '- Consider both short-term pragmatism and long-term vision',
      '- Reference established architectural patterns where applicable',
    ].join('\n'),
    enabledTools: ['Read', 'Grep', 'Glob', 'Bash'],
    maxTurns: 10,
    personality: 'strategic, analytical, big-picture thinker',
    category: 'architecture',
  },
  {
    slug: 'performance',
    name: 'Performance Engineer',
    description:
      'Profiling analysis, optimization strategies, and benchmark design',
    systemPrompt: [
      'You are a performance engineer. You identify bottlenecks and optimize code for speed and efficiency.',
      '',
      'Performance analysis approach:',
      '- Measure before optimizing — never guess at bottlenecks',
      '- Focus on algorithmic complexity first (O(n) improvements)',
      '- Then optimize constants (caching, batching, pooling)',
      '- Consider memory allocation patterns and GC pressure',
      '- Profile I/O operations: disk, network, database queries',
      '',
      'Common optimization areas:',
      '- Algorithm and data structure selection',
      '- Database query optimization (N+1, missing indexes, full scans)',
      '- Caching strategies (memoization, LRU, TTL)',
      '- Async/concurrent processing where I/O-bound',
      '- Bundle size and lazy loading for frontend code',
      '- Memory leaks and excessive allocation',
      '',
      'When recommending optimizations:',
      '1. Quantify the current performance with data or estimates',
      '2. Explain the root cause of the performance issue',
      '3. Propose the fix with expected improvement',
      '4. Note any tradeoffs (readability, memory, complexity)',
      '5. Suggest how to benchmark and verify the improvement',
      '',
      'Remember: premature optimization is the root of all evil. Only optimize what matters.',
    ].join('\n'),
    enabledTools: ['Read', 'Grep', 'Glob', 'Bash'],
    maxTurns: 12,
    personality: 'data-driven, pragmatic, efficiency-focused',
    category: 'architecture',
  },
]

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const VOID_DIR = path.join(os.homedir(), '.void')
const AGENTS_DIR = path.join(VOID_DIR, 'agents')
const ACTIVE_FILE = path.join(AGENTS_DIR, 'active.json')

function ensureAgentsDir(): void {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true })
  }
}

export class AgentTemplateRegistry {
  private builtinMap: Map<string, AgentTemplate>

  constructor() {
    this.builtinMap = new Map()
    for (const t of BUILTIN_TEMPLATES) {
      this.builtinMap.set(t.slug, t)
    }
  }

  // ---- Built-in queries ----------------------------------------------------

  getBuiltinTemplates(): AgentTemplate[] {
    return [...BUILTIN_TEMPLATES]
  }

  getTemplate(slug: string): AgentTemplate | undefined {
    // Check built-ins first, then custom, then project
    const builtin = this.builtinMap.get(slug)
    if (builtin) return builtin

    const custom = this.loadCustomTemplates().find(t => t.slug === slug)
    if (custom) return custom

    const project = this.loadProjectTemplates().find(t => t.slug === slug)
    if (project) return project

    return undefined
  }

  listTemplates(category?: string): AgentTemplate[] {
    const all = [
      ...BUILTIN_TEMPLATES,
      ...this.loadCustomTemplates(),
      ...this.loadProjectTemplates(),
    ]

    // De-duplicate by slug (custom/project override built-in)
    const seen = new Map<string, AgentTemplate>()
    for (const t of all) {
      seen.set(t.slug, t)
    }
    const unique = [...seen.values()]

    if (category) {
      return unique.filter(t => t.category === category)
    }
    return unique
  }

  // ---- Custom template management ------------------------------------------

  createCustomTemplate(template: AgentTemplate): void {
    ensureAgentsDir()
    const filePath = path.join(AGENTS_DIR, `${template.slug}.json`)
    if (this.builtinMap.has(template.slug)) {
      throw new Error(
        `Cannot create custom template with slug "${template.slug}" — it conflicts with a built-in template`,
      )
    }
    fs.writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8')
  }

  deleteCustomTemplate(slug: string): boolean {
    const filePath = path.join(AGENTS_DIR, `${slug}.json`)
    if (!fs.existsSync(filePath)) {
      return false
    }
    fs.unlinkSync(filePath)

    // If the deleted template was active, deactivate
    const active = this.getActiveTemplate()
    if (active && active.slug === slug) {
      this.deactivate()
    }
    return true
  }

  loadCustomTemplates(): AgentTemplate[] {
    if (!fs.existsSync(AGENTS_DIR)) {
      return []
    }

    const templates: AgentTemplate[] = []
    const files = fs.readdirSync(AGENTS_DIR)

    for (const file of files) {
      if (!file.endsWith('.json') || file === 'active.json') {
        continue
      }
      try {
        const content = fs.readFileSync(
          path.join(AGENTS_DIR, file),
          'utf-8',
        )
        const parsed = JSON.parse(content) as AgentTemplate
        if (parsed.slug && parsed.name && parsed.systemPrompt) {
          templates.push(parsed)
        }
      } catch {
        // Skip malformed files
      }
    }

    return templates
  }

  loadProjectTemplates(): AgentTemplate[] {
    const projectAgentsDir = path.join(process.cwd(), '.void', 'agents')
    if (!fs.existsSync(projectAgentsDir)) {
      return []
    }

    const templates: AgentTemplate[] = []
    const files = fs.readdirSync(projectAgentsDir)

    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue
      }
      try {
        const content = fs.readFileSync(
          path.join(projectAgentsDir, file),
          'utf-8',
        )
        const parsed = JSON.parse(content) as AgentTemplate
        if (parsed.slug && parsed.name && parsed.systemPrompt) {
          templates.push(parsed)
        }
      } catch {
        // Skip malformed files
      }
    }

    return templates
  }

  // ---- Activation ----------------------------------------------------------

  activateTemplate(slug: string): AgentTemplate {
    const template = this.getTemplate(slug)
    if (!template) {
      throw new Error(`Template "${slug}" not found`)
    }

    ensureAgentsDir()
    const state: ActiveState = {
      slug,
      activatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(ACTIVE_FILE, JSON.stringify(state, null, 2), 'utf-8')
    return template
  }

  getActiveTemplate(): AgentTemplate | null {
    if (!fs.existsSync(ACTIVE_FILE)) {
      return null
    }

    try {
      const content = fs.readFileSync(ACTIVE_FILE, 'utf-8')
      const state = JSON.parse(content) as ActiveState
      return this.getTemplate(state.slug) ?? null
    } catch {
      return null
    }
  }

  deactivate(): void {
    if (fs.existsSync(ACTIVE_FILE)) {
      fs.unlinkSync(ACTIVE_FILE)
    }
  }

  getSystemPromptAddition(): string {
    const active = this.getActiveTemplate()
    if (!active) {
      return ''
    }

    const lines = [
      `[Active Agent Persona: ${active.name}]`,
      '',
      active.systemPrompt,
    ]

    if (active.personality) {
      lines.push('', `Personality: ${active.personality}`)
    }

    return lines.join('\n')
  }

  // ---- Instance creation ---------------------------------------------------

  createInstance(slug: string, name?: string): AgentInstance {
    const template = this.getTemplate(slug)
    if (!template) {
      throw new Error(`Template "${slug}" not found`)
    }

    return {
      id: crypto.randomUUID(),
      template: slug,
      name: name ?? template.name,
      config: { ...template },
      createdAt: new Date().toISOString(),
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let registryInstance: AgentTemplateRegistry | null = null

export function getAgentTemplateRegistry(): AgentTemplateRegistry {
  if (!registryInstance) {
    registryInstance = new AgentTemplateRegistry()
  }
  return registryInstance
}

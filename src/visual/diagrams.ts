import type { TreeNode, BoxDiagramOptions, TableOptions } from './types.js'

/**
 * Render a tree diagram.
 *
 * Output example:
 *   src/
 *   ├── components/
 *   │   ├── Button.tsx
 *   │   └── Modal.tsx
 *   ├── utils/
 *   │   └── helpers.ts
 *   └── index.ts
 */
export function renderTree(root: TreeNode, prefix?: string): string {
  const lines: string[] = []
  renderTreeNode(root, '', true, true, lines)
  return lines.join('\n')
}

function renderTreeNode(
  node: TreeNode,
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
  lines: string[],
): void {
  if (isRoot) {
    lines.push(node.label)
  } else {
    const connector = isLast ? '└── ' : '├── '
    lines.push(prefix + connector + node.label)
  }

  if (node.collapsed || !node.children || node.children.length === 0) {
    return
  }

  const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ')

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!
    const childIsLast = i === node.children.length - 1
    renderTreeNode(child, childPrefix, childIsLast, false, lines)
  }
}

const BORDER_STYLES = {
  single: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
  rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
} as const

/**
 * Render a box diagram with borders.
 *
 * Output example:
 *   ┌─── Title ─────────┐
 *   │ Content line 1     │
 *   │ Content line 2     │
 *   └────────────────────┘
 */
export function renderBox(options: BoxDiagramOptions): string {
  const style = BORDER_STYLES[options.borderStyle ?? 'single']
  const maxContentLen = Math.max(
    options.title.length + 4,
    ...options.content.map(l => l.length),
  )
  const width = options.width ?? maxContentLen + 4

  const innerWidth = width - 2

  // Top border with title
  const titlePart = ` ${options.title} `
  const remainingDashes = innerWidth - titlePart.length - 2
  const topBorder =
    style.tl +
    style.h.repeat(2) +
    titlePart +
    style.h.repeat(Math.max(0, remainingDashes)) +
    style.tr

  const lines: string[] = [topBorder]

  // Content lines
  for (const line of options.content) {
    const padded = (' ' + line).padEnd(innerWidth)
    lines.push(style.v + padded + style.v)
  }

  // Bottom border
  lines.push(style.bl + style.h.repeat(innerWidth) + style.br)

  return lines.join('\n')
}

/**
 * Render an ASCII table.
 *
 * Output example:
 *   ┌──────────┬───────┬──────┐
 *   │ Name     │ Type  │ Size │
 *   ├──────────┼───────┼──────┤
 *   │ index.ts │ file  │ 2.4k │
 *   │ utils.ts │ file  │ 1.1k │
 *   └──────────┴───────┴──────┘
 */
export function renderTable(options: TableOptions): string {
  const { headers, rows, maxColumnWidth, alignment } = options

  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    let max = h.length
    for (const row of rows) {
      const cell = row[i] ?? ''
      max = Math.max(max, cell.length)
    }
    if (maxColumnWidth) {
      max = Math.min(max, maxColumnWidth)
    }
    return max
  })

  function truncate(s: string, maxLen: number): string {
    if (s.length <= maxLen) return s
    return s.slice(0, maxLen - 1) + '…'
  }

  function alignCell(s: string, width: number, align: 'left' | 'right' | 'center'): string {
    const truncated = truncate(s, width)
    if (align === 'right') {
      return truncated.padStart(width)
    } else if (align === 'center') {
      const leftPad = Math.floor((width - truncated.length) / 2)
      const rightPad = width - truncated.length - leftPad
      return ' '.repeat(leftPad) + truncated + ' '.repeat(rightPad)
    }
    return truncated.padEnd(width)
  }

  function makeLine(left: string, mid: string, right: string, fill: string): string {
    return left + colWidths.map(w => fill.repeat(w + 2)).join(mid) + right
  }

  function makeRow(cells: string[]): string {
    const parts = colWidths.map((w, i) => {
      const cell = cells[i] ?? ''
      const align = alignment?.[i] ?? 'left'
      return ' ' + alignCell(cell, w, align) + ' '
    })
    return '│' + parts.join('│') + '│'
  }

  const lines: string[] = []

  // Top border
  lines.push(makeLine('┌', '┬', '┐', '─'))
  // Header row
  lines.push(makeRow(headers))
  // Header separator
  lines.push(makeLine('├', '┼', '┤', '─'))
  // Data rows
  for (const row of rows) {
    lines.push(makeRow(row))
  }
  // Bottom border
  lines.push(makeLine('└', '┴', '┘', '─'))

  return lines.join('\n')
}

/**
 * Render a simple flowchart.
 *
 * Output example:
 *   [Start] → [Process] → [Decision]
 *                            ↓    ↓
 *                         [Yes]  [No]
 */
export function renderFlowchart(steps: string[], connections?: [number, number][]): string {
  if (steps.length === 0) {
    return ''
  }

  // If no custom connections, render as a linear chain
  if (!connections || connections.length === 0) {
    return steps.map(s => `[${s}]`).join(' → ')
  }

  // Build adjacency: which nodes connect to which
  const forwardEdges = new Map<number, number[]>()
  for (const [from, to] of connections) {
    const existing = forwardEdges.get(from) ?? []
    existing.push(to)
    forwardEdges.set(from, existing)
  }

  // Find root nodes (no incoming edges)
  const hasIncoming = new Set(connections.map(([, to]) => to))
  const roots: number[] = []
  for (let i = 0; i < steps.length; i++) {
    if (!hasIncoming.has(i)) {
      roots.push(i)
    }
  }

  // Simple BFS-based rendering: render main chain, then branches
  const visited = new Set<number>()
  const lines: string[] = []

  // Render linear chain from first root
  function renderChain(start: number): string[] {
    const chain: string[] = []
    let current: number | undefined = start
    while (current !== undefined && !visited.has(current)) {
      visited.add(current)
      chain.push(`[${steps[current]!}]`)
      const next = forwardEdges.get(current)
      if (next && next.length > 0) {
        // Follow the first connection as the main chain
        current = next[0]
      } else {
        current = undefined
      }
    }
    return chain
  }

  // Main chain from first root (or node 0)
  const mainStart = roots.length > 0 ? roots[0]! : 0
  const mainChain = renderChain(mainStart)
  lines.push(mainChain.join(' → '))

  // Render branches (nodes connected but not on main chain)
  for (const [from, targets] of forwardEdges) {
    for (let t = 1; t < targets.length; t++) {
      const target = targets[t]!
      if (!visited.has(target)) {
        visited.add(target)
        // Calculate approximate offset to align under the parent
        const parentLabel = `[${steps[from]!}]`
        const mainLine = lines[0] ?? ''
        const parentPos = mainLine.indexOf(parentLabel)

        if (parentPos >= 0) {
          const offset = parentPos + Math.floor(parentLabel.length / 2)
          lines.push(' '.repeat(Math.max(0, offset)) + '↓')
          lines.push(' '.repeat(Math.max(0, offset - 1)) + `[${steps[target]!}]`)
        } else {
          lines.push(`  → [${steps[target]!}]`)
        }
      }
    }
  }

  return lines.join('\n')
}

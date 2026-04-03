import type { ChartData, BarChartOptions, SparklineOptions, ProgressBarOptions } from './types.js'

const SPARK_CHARS = '▁▂▃▄▅▆▇█'
const FILL_CHAR = '█'
const EMPTY_CHAR = '░'

/**
 * Render a horizontal bar chart.
 *
 * Output example:
 *   Revenue  ████████████████████ 85%
 *   Costs    ████████████         52%
 *   Profit   ██████████████       63%
 */
export function renderBarChart(data: ChartData, options?: BarChartOptions): string {
  const maxWidth = options?.maxWidth ?? 30
  const showValues = options?.showValues ?? true
  const fillChar = options?.fillChar ?? FILL_CHAR
  const emptyChar = options?.emptyChar ?? ' '

  if (data.labels.length === 0 || data.values.length === 0) {
    return ''
  }

  const maxValue = Math.max(...data.values)
  const maxLabelLen = Math.max(...data.labels.map(l => l.length))

  const lines: string[] = []

  if (data.title) {
    lines.push(data.title)
    lines.push('')
  }

  for (let i = 0; i < data.labels.length; i++) {
    const label = (data.labels[i] ?? '').padEnd(maxLabelLen)
    const value = data.values[i] ?? 0
    const barLen = maxValue > 0 ? Math.round((value / maxValue) * maxWidth) : 0
    const bar = fillChar.repeat(barLen) + emptyChar.repeat(maxWidth - barLen)

    if (showValues) {
      const pct = maxValue > 0 ? Math.round((value / maxValue) * 100) : 0
      const suffix = data.unit ? ` ${value}${data.unit}` : ` ${pct}%`
      lines.push(`  ${label}  ${bar}${suffix}`)
    } else {
      lines.push(`  ${label}  ${bar}`)
    }
  }

  return lines.join('\n')
}

/**
 * Render a sparkline (inline mini chart).
 *
 * Output example: ▁▂▃▅▇█▇▅▃▂▁
 */
export function renderSparkline(values: number[], options?: SparklineOptions): string {
  if (values.length === 0) {
    return ''
  }

  const min = options?.min ?? Math.min(...values)
  const max = options?.max ?? Math.max(...values)
  const range = max - min

  const result: string[] = []

  for (const v of values) {
    if (range === 0) {
      result.push(SPARK_CHARS[4]!)
    } else {
      const idx = Math.round(((v - min) / range) * (SPARK_CHARS.length - 1))
      result.push(SPARK_CHARS[idx]!)
    }
  }

  return result.join('')
}

/**
 * Render a progress bar.
 *
 * Output example: Building [████████░░░░░░░░░░░░] 42%
 */
export function renderProgressBar(options: ProgressBarOptions): string {
  const width = options.width ?? 20
  const fillChar = options.fillChar ?? FILL_CHAR
  const emptyChar = options.emptyChar ?? EMPTY_CHAR
  const showPercentage = options.showPercentage ?? true

  const ratio = options.total > 0 ? Math.min(options.current / options.total, 1) : 0
  const filled = Math.round(ratio * width)
  const bar = fillChar.repeat(filled) + emptyChar.repeat(width - filled)

  const parts: string[] = []
  if (options.label) {
    parts.push(options.label)
  }
  parts.push(`[${bar}]`)
  if (showPercentage) {
    parts.push(`${Math.round(ratio * 100)}%`)
  }

  return parts.join(' ')
}

/**
 * Render a simple pie/donut chart using unicode block chars.
 *
 * Output example:
 *   ██████ JavaScript  45%
 *   ████   TypeScript  28%
 *   ███    Python      17%
 *   █      Other       10%
 */
export function renderPieChart(data: ChartData): string {
  if (data.labels.length === 0 || data.values.length === 0) {
    return ''
  }

  const total = data.values.reduce((a, b) => a + b, 0)
  if (total === 0) {
    return ''
  }

  const maxBarWidth = 10
  const maxLabelLen = Math.max(...data.labels.map(l => l.length))

  const lines: string[] = []

  if (data.title) {
    lines.push(data.title)
    lines.push('')
  }

  for (let i = 0; i < data.labels.length; i++) {
    const label = (data.labels[i] ?? '').padEnd(maxLabelLen)
    const value = data.values[i] ?? 0
    const pct = Math.round((value / total) * 100)
    const barLen = Math.max(1, Math.round((value / total) * maxBarWidth))
    const bar = FILL_CHAR.repeat(barLen).padEnd(maxBarWidth)
    lines.push(`  ${bar} ${label}  ${pct}%`)
  }

  return lines.join('\n')
}

/**
 * Render a mini heatmap grid.
 */
export function renderHeatmap(
  grid: number[][],
  labels?: { rows?: string[]; cols?: string[] },
): string {
  if (grid.length === 0) {
    return ''
  }

  // Intensity chars from low to high
  const heatChars = [' ', '░', '▒', '▓', '█']

  const allValues = grid.flat()
  const min = Math.min(...allValues)
  const max = Math.max(...allValues)
  const range = max - min

  const rowLabels = labels?.rows ?? []
  const colLabels = labels?.cols ?? []
  const maxRowLabelLen = rowLabels.length > 0 ? Math.max(...rowLabels.map(l => l.length)) : 0

  const lines: string[] = []

  // Column headers
  if (colLabels.length > 0) {
    const padding = maxRowLabelLen > 0 ? ' '.repeat(maxRowLabelLen + 2) : ''
    lines.push(padding + colLabels.map(c => c.charAt(0)).join(' '))
  }

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]!
    const rowLabel = r < rowLabels.length ? (rowLabels[r] ?? '').padEnd(maxRowLabelLen) + '  ' : ''
    const cells: string[] = []

    for (const val of row) {
      const idx = range === 0 ? 2 : Math.round(((val - min) / range) * (heatChars.length - 1))
      cells.push(heatChars[idx]!)
    }

    lines.push(rowLabel + cells.join(' '))
  }

  return lines.join('\n')
}

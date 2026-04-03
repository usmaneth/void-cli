/**
 * /visual command handler
 *
 * Usage:
 *   /visual chart bar <data>    — Render bar chart (data: label:value,label:value)
 *   /visual chart spark <data>  — Render sparkline (data: 1,2,3,4,5)
 *   /visual tree <json>         — Render tree from JSON
 *   /visual table <csv>         — Render table from CSV-like input
 *   /visual box <title> <lines> — Render a box diagram
 *   /visual progress <n> <total> — Render progress bar
 */

import type { ChartData, TreeNode } from './types.js'
import { renderBarChart, renderSparkline, renderProgressBar, renderPieChart } from './charts.js'
import { renderTree, renderBox, renderTable } from './diagrams.js'

export function handleVisualCommand(args: string): string {
  const parts = args.trim().split(/\s+/)
  const subcommand = parts[0]

  if (!subcommand) {
    return getUsage()
  }

  switch (subcommand) {
    case 'chart':
      return handleChart(parts.slice(1))
    case 'tree':
      return handleTree(parts.slice(1).join(' '))
    case 'table':
      return handleTableCmd(parts.slice(1).join(' '))
    case 'box':
      return handleBox(parts.slice(1))
    case 'progress':
      return handleProgress(parts.slice(1))
    default:
      return `Unknown subcommand: ${subcommand}\n\n${getUsage()}`
  }
}

function handleChart(parts: string[]): string {
  const chartType = parts[0]
  const dataStr = parts.slice(1).join(' ')

  if (!chartType) {
    return 'Usage: /visual chart bar|spark|pie <data>'
  }

  switch (chartType) {
    case 'bar': {
      const data = parseChartData(dataStr)
      return renderBarChart(data)
    }
    case 'spark': {
      const values = dataStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
      if (values.length === 0) {
        return 'Provide comma-separated numbers: /visual chart spark 1,2,3,4,5'
      }
      return renderSparkline(values)
    }
    case 'pie': {
      const data = parseChartData(dataStr)
      return renderPieChart(data)
    }
    default:
      return `Unknown chart type: ${chartType}. Supported: bar, spark, pie`
  }
}

function handleTree(jsonStr: string): string {
  if (!jsonStr.trim()) {
    return 'Provide JSON tree data: /visual tree {"label":"root","children":[{"label":"child"}]}'
  }
  try {
    const treeData = JSON.parse(jsonStr) as TreeNode
    return renderTree(treeData)
  } catch {
    return 'Invalid JSON. Expected: {"label":"root","children":[{"label":"child"}]}'
  }
}

function handleTableCmd(csvStr: string): string {
  if (!csvStr.trim()) {
    return 'Provide CSV-like data: /visual table Name,Type,Size\\nindex.ts,file,2.4k'
  }
  const rawLines = csvStr.split('\\n').map(l => l.trim()).filter(l => l.length > 0)
  if (rawLines.length === 0) {
    return 'No data provided.'
  }
  const headers = rawLines[0]!.split(',').map(s => s.trim())
  const rows = rawLines.slice(1).map(line => line.split(',').map(s => s.trim()))
  return renderTable({ headers, rows })
}

function handleBox(parts: string[]): string {
  if (parts.length === 0) {
    return 'Usage: /visual box <title> <line1>\\n<line2>'
  }
  const title = parts[0] ?? 'Box'
  const rest = parts.slice(1).join(' ')
  const content = rest.split('\\n').map(s => s.trim())
  return renderBox({ title, content })
}

function handleProgress(parts: string[]): string {
  const current = parseInt(parts[0] ?? '', 10)
  const total = parseInt(parts[1] ?? '', 10)
  if (isNaN(current) || isNaN(total)) {
    return 'Usage: /visual progress <current> <total>'
  }
  return renderProgressBar({
    current,
    total,
    width: 30,
    showPercentage: true,
  })
}

function parseChartData(dataStr: string): ChartData {
  // Format: label:value,label:value,...
  const labels: string[] = []
  const values: number[] = []

  const pairs = dataStr.split(',').map(s => s.trim()).filter(s => s.length > 0)
  for (const pair of pairs) {
    const colonIdx = pair.lastIndexOf(':')
    if (colonIdx > 0) {
      const label = pair.slice(0, colonIdx).trim()
      const value = parseFloat(pair.slice(colonIdx + 1).trim())
      if (!isNaN(value)) {
        labels.push(label)
        values.push(value)
      }
    }
  }

  return { labels, values }
}

function getUsage(): string {
  return [
    'Visual Output Commands:',
    '',
    '  /visual chart bar <label:value,...>   — Bar chart',
    '  /visual chart spark <n,n,n,...>       — Sparkline',
    '  /visual chart pie <label:value,...>   — Pie chart',
    '  /visual tree <json>                   — Tree diagram',
    '  /visual table <csv>                   — Table from CSV',
    '  /visual box <title> <lines>           — Box diagram',
    '  /visual progress <current> <total>    — Progress bar',
  ].join('\n')
}

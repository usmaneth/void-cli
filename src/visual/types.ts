/**
 * Visual Output types for terminal rendering.
 */

export type ChartType = 'bar' | 'line' | 'pie' | 'sparkline' | 'table' | 'heatmap'

export type ChartData = {
  labels: string[]
  values: number[]
  title?: string
  unit?: string
  color?: string
}

export type BarChartOptions = {
  maxWidth?: number
  showValues?: boolean
  horizontal?: boolean
  fillChar?: string
  emptyChar?: string
}

export type SparklineOptions = {
  width?: number
  min?: number
  max?: number
}

export type TableOptions = {
  headers: string[]
  rows: string[][]
  maxColumnWidth?: number
  alignment?: ('left' | 'right' | 'center')[]
}

export type TreeNode = {
  label: string
  children?: TreeNode[]
  collapsed?: boolean
}

export type DiagramType = 'tree' | 'flowchart' | 'box'

export type BoxDiagramOptions = {
  title: string
  content: string[]
  width?: number
  borderStyle?: 'single' | 'double' | 'rounded' | 'heavy'
}

export type ProgressBarOptions = {
  total: number
  current: number
  width?: number
  label?: string
  showPercentage?: boolean
  fillChar?: string
  emptyChar?: string
  color?: string
}

/**
 * Visual Output module — charts, diagrams, and images in the terminal.
 */

// Types
export type {
  ChartType,
  ChartData,
  BarChartOptions,
  SparklineOptions,
  TableOptions,
  TreeNode,
  DiagramType,
  BoxDiagramOptions,
  ProgressBarOptions,
} from './types.js'

// Chart renderers
export {
  renderBarChart,
  renderSparkline,
  renderProgressBar,
  renderPieChart,
  renderHeatmap,
} from './charts.js'

// Diagram renderers
export {
  renderTree,
  renderBox,
  renderTable,
  renderFlowchart,
} from './diagrams.js'

// React/Ink components
export { VisualBlock, InlineSparkline, ProgressDisplay } from './renderer.js'

// Command handler
export { handleVisualCommand } from './command.js'

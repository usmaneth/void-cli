import type { StructuredPatchHunk } from 'diff'
import * as React from 'react'
import { useDiffModeToggle } from '../hooks/useDiffModeToggle.js'
import { useSettings } from '../hooks/useSettings.js'
import { Box, NoSelect, Text } from '../ink.js'
import { intersperse } from '../utils/array.js'
import { type DiffMode, resolveDiffMode } from '../utils/diffMode.js'
import { SplitDiffView } from './SplitDiffView.js'
import { StructuredDiff } from './StructuredDiff.js'

type Props = {
  hunks: StructuredPatchHunk[]
  dim: boolean
  width: number
  filePath: string
  firstLine: string | null
  fileContent?: string
  /**
   * Layout mode. 'auto' (default) picks split or unified based on the
   * provided width. Explicit 'split' or 'unified' overrides both the
   * user setting and the auto threshold. The caller passes the terminal
   * columns; width may differ when nested in padded containers, so the
   * resolution always compares the value the caller hands us.
   */
  mode?: DiffMode
}

/**
 * Renders a list of diff hunks with ellipsis separators between them.
 * Respects the user's `diffMode` setting and falls back to auto (split
 * when width ≥ 120 cols) when no explicit mode is given. Ctrl+D while
 * the diff is mounted toggles between split and unified for the
 * current view (not persisted).
 */
export function StructuredDiffList({
  hunks,
  dim,
  width,
  filePath,
  firstLine,
  fileContent,
  mode,
}: Props): React.ReactNode {
  const settings = useSettings()
  const { override } = useDiffModeToggle()
  const resolved = resolveDiffMode({
    override,
    prop: mode,
    setting: (settings as { diffMode?: DiffMode }).diffMode,
    columns: width,
  })

  if (resolved === 'split') {
    return <SplitDiffView hunks={hunks} width={width} dim={dim} />
  }

  return intersperse(
    hunks.map(hunk => (
      <Box flexDirection="column" key={hunk.newStart}>
        <StructuredDiff
          patch={hunk}
          dim={dim}
          width={width}
          filePath={filePath}
          firstLine={firstLine}
          fileContent={fileContent}
        />
      </Box>
    )),
    i => (
      <NoSelect fromLeftEdge key={`ellipsis-${i}`}>
        <Text dimColor>...</Text>
      </NoSelect>
    ),
  )
}

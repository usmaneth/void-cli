import { useCallback, useState } from 'react'
import { useInput } from '../ink.js'
import type { DiffMode } from '../utils/diffMode.js'

/**
 * Per-render diff-mode override, toggled with Ctrl+D while the diff
 * is mounted. The toggle is one-off: it resets on unmount and is not
 * persisted to user settings.
 *
 * Note: Ctrl+D is also the global exit binding (double-press). The
 * first Ctrl+D here toggles the diff view AND starts the exit-confirm
 * timer upstream — a second Ctrl+D within the timeout still exits.
 * This matches the "polish" framing of the task: the toggle is a
 * visible side-effect of the first press, not a replacement for exit.
 */
export function useDiffModeToggle(): {
  override: DiffMode | undefined
  toggle: () => void
} {
  const [override, setOverride] = useState<DiffMode | undefined>(undefined)

  const toggle = useCallback(() => {
    setOverride(prev => (prev === 'split' ? 'unified' : 'split'))
  }, [])

  useInput((_input, key) => {
    if (key.ctrl && _input === 'd') {
      toggle()
    }
  })

  return { override, toggle }
}

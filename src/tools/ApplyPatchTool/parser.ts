import { PATCH_BEGIN_MARKER, PATCH_END_MARKER } from './constants.js'

export type AddHunk = { type: 'add'; path: string; contents: string }
export type DeleteHunk = { type: 'delete'; path: string }
export type UpdateHunk = {
  type: 'update'
  path: string
  movePath?: string
  chunks: UpdateChunk[]
}
export type Hunk = AddHunk | DeleteHunk | UpdateHunk

export type UpdateChunk = {
  oldLines: string[]
  newLines: string[]
  context?: string
}

export class PatchParseError extends Error {
  constructor(message: string, public readonly lineIndex?: number) {
    super(message)
    this.name = 'PatchParseError'
  }
}

/**
 * Parse a `*** Begin Patch` / `*** End Patch` block into structured hunks.
 *
 * The grammar is permissive enough to accept the model's output but strict
 * enough to reject malformed patches before any filesystem mutation happens.
 */
export function parsePatch(patchText: string): { hunks: Hunk[] } {
  const normalized = patchText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const trimmed = normalized.trim()

  if (!trimmed.startsWith(PATCH_BEGIN_MARKER)) {
    throw new PatchParseError(
      `Patch must start with "${PATCH_BEGIN_MARKER}" marker`,
    )
  }
  if (!trimmed.endsWith(PATCH_END_MARKER)) {
    throw new PatchParseError(
      `Patch must end with "${PATCH_END_MARKER}" marker`,
    )
  }

  const lines = trimmed.split('\n')
  const hunks: Hunk[] = []
  // Skip the Begin marker and the End marker when walking hunks.
  let i = 1
  const endIdx = lines.length - 1

  while (i < endIdx) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }

    if (line.startsWith('*** Add File:')) {
      const path = line.slice('*** Add File:'.length).trim()
      if (!path) throw new PatchParseError('Add File header is missing a path', i)
      const content: string[] = []
      i++
      while (i < endIdx && !lines[i].startsWith('*** ')) {
        const bodyLine = lines[i]
        if (bodyLine.length === 0) {
          content.push('')
        } else if (bodyLine.startsWith('+')) {
          content.push(bodyLine.slice(1))
        } else {
          throw new PatchParseError(
            `Expected "+" prefix on Add File line ${i + 1}: ${JSON.stringify(bodyLine)}`,
            i,
          )
        }
        i++
      }
      hunks.push({ type: 'add', path, contents: content.join('\n') })
      continue
    }

    if (line.startsWith('*** Delete File:')) {
      const path = line.slice('*** Delete File:'.length).trim()
      if (!path) throw new PatchParseError('Delete File header missing path', i)
      hunks.push({ type: 'delete', path })
      i++
      continue
    }

    if (line.startsWith('*** Update File:')) {
      const path = line.slice('*** Update File:'.length).trim()
      if (!path) throw new PatchParseError('Update File header missing path', i)
      i++
      let movePath: string | undefined
      if (i < endIdx && lines[i].startsWith('*** Move to:')) {
        movePath = lines[i].slice('*** Move to:'.length).trim()
        i++
      }

      const chunks: UpdateChunk[] = []
      while (i < endIdx && !lines[i].startsWith('*** ')) {
        let context: string | undefined
        if (lines[i].startsWith('@@')) {
          const raw = lines[i].slice(2).trim()
          context = raw.length > 0 ? raw : undefined
          i++
        }
        const oldLines: string[] = []
        const newLines: string[] = []
        while (
          i < endIdx &&
          !lines[i].startsWith('*** ') &&
          !lines[i].startsWith('@@')
        ) {
          const bodyLine = lines[i]
          if (bodyLine.startsWith('+')) {
            newLines.push(bodyLine.slice(1))
          } else if (bodyLine.startsWith('-')) {
            oldLines.push(bodyLine.slice(1))
          } else if (bodyLine.startsWith(' ')) {
            oldLines.push(bodyLine.slice(1))
            newLines.push(bodyLine.slice(1))
          } else if (bodyLine.length === 0) {
            oldLines.push('')
            newLines.push('')
          } else {
            throw new PatchParseError(
              `Unexpected line ${i + 1} in Update hunk: ${JSON.stringify(bodyLine)}`,
              i,
            )
          }
          i++
        }
        if (oldLines.length === 0 && newLines.length === 0) {
          // Empty chunk (e.g. header with no body) — skip.
          continue
        }
        chunks.push({ oldLines, newLines, context })
      }

      if (chunks.length === 0) {
        throw new PatchParseError(
          `Update File ${path} has no chunks`,
          i,
        )
      }
      hunks.push({ type: 'update', path, movePath, chunks })
      continue
    }

    throw new PatchParseError(
      `Unknown patch directive on line ${i + 1}: ${JSON.stringify(line)}`,
      i,
    )
  }

  return { hunks }
}

/**
 * Apply a set of UpdateChunks to the current file contents, returning the new
 * contents. Fails if any chunk's old lines don't uniquely match the current
 * file. This is the validation gate that makes apply_patch atomic.
 */
export function applyUpdateChunks(
  filePath: string,
  original: string,
  chunks: UpdateChunk[],
): string {
  // Preserve the file's line endings: split by \n but keep track of whether the
  // original ended with a newline so we can re-emit in the same shape.
  const endsWithNewline = original.endsWith('\n')
  const lines = (endsWithNewline ? original.slice(0, -1) : original).split('\n')
  let updated = lines

  for (const chunk of chunks) {
    const { oldLines, newLines } = chunk

    if (oldLines.length === 0) {
      // Pure insertion. Place at end of file (safe default when no anchor).
      updated = [...updated, ...newLines]
      continue
    }

    const occurrences: number[] = []
    for (let i = 0; i <= updated.length - oldLines.length; i++) {
      let match = true
      for (let j = 0; j < oldLines.length; j++) {
        if (updated[i + j] !== oldLines[j]) {
          match = false
          break
        }
      }
      if (match) occurrences.push(i)
    }

    if (occurrences.length === 0) {
      throw new PatchParseError(
        `apply_patch: chunk for ${filePath} did not match the current file contents. Re-read the file and regenerate the patch.`,
      )
    }
    if (occurrences.length > 1) {
      throw new PatchParseError(
        `apply_patch: chunk for ${filePath} matched ${occurrences.length} locations. Add more surrounding context so the match is unique.`,
      )
    }

    const at = occurrences[0]
    updated = [
      ...updated.slice(0, at),
      ...newLines,
      ...updated.slice(at + oldLines.length),
    ]
  }

  const joined = updated.join('\n')
  return endsWithNewline ? `${joined}\n` : joined
}

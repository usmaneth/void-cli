import { dirname, isAbsolute, resolve } from 'path'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { writeTextContent } from '../../utils/file.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { expandPath, toRelativePath } from '../../utils/path.js'
import { matchingRuleForInput } from '../../utils/permissions/filesystem.js'
import { MULTI_EDIT_TOOL_NAME } from './constants.js'
import { getMultiEditDescription } from './prompt.js'
import {
  inputSchema,
  type MultiEditEdit,
  type MultiEditInput,
  type MultiEditInputSchema,
  type MultiEditOutput,
  type MultiEditOutputSchema,
  outputSchema,
} from './types.js'

function resolvePath(p: string): string {
  if (isAbsolute(p)) return expandPath(p)
  return resolve(getCwd(), p)
}

function countNewlines(s: string): number {
  if (s.length === 0) return 0
  let n = 0
  for (const ch of s) if (ch === '\n') n++
  return n
}

/**
 * Apply a single edit to a string. Returns the new text and the number of
 * occurrences replaced. Throws if the oldString isn't found, or if there are
 * multiple matches and replaceAll is false — callers rely on this as the
 * all-or-nothing validation gate for atomic multi-file edits.
 */
export function applySingleEdit(
  source: string,
  edit: Pick<MultiEditEdit, 'oldString' | 'newString' | 'replaceAll'>,
): { content: string; replaced: number } {
  const { oldString, newString, replaceAll } = edit
  if (oldString === newString) {
    throw new Error('MultiEdit: oldString and newString are identical.')
  }
  if (oldString === '') {
    // Allow inserting into an empty file (matches FileEditTool semantics).
    if (source.length === 0) {
      return { content: newString, replaced: 1 }
    }
    throw new Error(
      'MultiEdit: oldString is empty but the target file is not empty.',
    )
  }

  const occurrences = source.split(oldString).length - 1
  if (occurrences === 0) {
    throw new Error(
      `MultiEdit: oldString not found in file.\nString: ${oldString}`,
    )
  }
  if (occurrences > 1 && !replaceAll) {
    throw new Error(
      `MultiEdit: oldString matched ${occurrences} times but replaceAll is false. Add more context or set replaceAll: true.`,
    )
  }
  const content = replaceAll
    ? source.split(oldString).join(newString)
    : source.replace(oldString, newString)
  return { content, replaced: replaceAll ? occurrences : 1 }
}

export const MultiEditTool = buildTool({
  name: MULTI_EDIT_TOOL_NAME,
  searchHint: 'apply a batch of edits atomically across one or more files',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Apply multiple string edits across one or more files atomically'
  },
  async prompt() {
    return getMultiEditDescription()
  },
  userFacingName() {
    return 'Multi Edit'
  },
  getActivityDescription(input) {
    const n = input?.edits?.length ?? 0
    return n > 0 ? `Applying ${n} edit${n === 1 ? '' : 's'}` : 'Applying edits'
  },
  get inputSchema(): MultiEditInputSchema {
    return inputSchema()
  },
  get outputSchema(): MultiEditOutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return (input.edits ?? [])
      .map(e => `${e.path}: ${e.oldString} -> ${e.newString}`)
      .join('\n')
      .slice(0, 4000)
  },
  renderToolUseMessage(input) {
    if (!input?.edits?.length) return null
    const files = new Set(input.edits.map(e => e.path))
    return `${input.edits.length} edits across ${files.size} file(s)`
  },
  async validateInput(input: MultiEditInput) {
    if (!input.edits?.length) {
      return { result: false, message: 'No edits provided', errorCode: 1 }
    }
    for (const edit of input.edits) {
      if (edit.oldString === edit.newString) {
        return {
          result: false,
          message: `Edit for ${edit.path}: oldString and newString are identical`,
          errorCode: 2,
        }
      }
    }
    return { result: true }
  },
  async checkPermissions(
    input: MultiEditInput,
    context,
  ): Promise<PermissionResult> {
    const appState = context.getAppState()
    for (const edit of input.edits) {
      const abs = resolvePath(edit.path)
      const rule = matchingRuleForInput(
        abs,
        appState.toolPermissionContext,
        'edit',
        'deny',
      )
      if (rule) {
        return {
          behavior: 'deny',
          message: `Permission to edit ${abs} has been denied.`,
          decisionReason: { type: 'rule', rule },
        }
      }
    }
    return { behavior: 'allow', updatedInput: input }
  },
  async call(input: MultiEditInput) {
    const fs = getFsImplementation()

    // Group edits by file while preserving order.
    const byFile = new Map<string, MultiEditEdit[]>()
    for (const edit of input.edits) {
      const abs = resolvePath(edit.path)
      const list = byFile.get(abs) ?? []
      list.push(edit)
      byFile.set(abs, list)
    }

    // === Validation pass: compute final contents for every file without
    // touching disk. Any failure aborts the whole batch. ===
    const pending = new Map<
      string,
      {
        path: string
        before: string
        after: string
        editsApplied: number
        additions: number
        deletions: number
      }
    >()

    for (const [abs, edits] of byFile) {
      let current: string
      try {
        current = await fs.readFile(abs, { encoding: 'utf8' })
      } catch {
        throw new Error(
          `MultiEdit: file not found — ${abs}. Read it first before editing.`,
        )
      }
      const before = current
      let editsApplied = 0
      for (const edit of edits) {
        const { content, replaced } = applySingleEdit(current, edit)
        current = content
        editsApplied += replaced
      }
      const additions = countNewlines(current) - countNewlines(before)
      pending.set(abs, {
        path: abs,
        before,
        after: current,
        editsApplied,
        additions: additions > 0 ? additions : 0,
        deletions: additions < 0 ? -additions : 0,
      })
    }

    // === Mutation pass ===
    const files: MultiEditOutput['files'] = []
    let totalEdits = 0
    for (const entry of pending.values()) {
      await fs.mkdir(dirname(entry.path))
      writeTextContent(entry.path, entry.after, 'utf8', 'LF')
      totalEdits += entry.editsApplied
      files.push({
        path: entry.path,
        relativePath: toRelativePath(entry.path) ?? entry.path,
        editsApplied: entry.editsApplied,
        additions: entry.additions,
        deletions: entry.deletions,
      })
    }

    return {
      data: {
        files,
        totalEdits,
      },
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    const summary = data.files
      .map(f => `M ${f.relativePath} (${f.editsApplied} edit${f.editsApplied === 1 ? '' : 's'})`)
      .join('\n')
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Applied ${data.totalEdits} edit(s) across ${data.files.length} file(s).\n${summary}`,
    }
  },
} satisfies ToolDef<MultiEditInputSchema, MultiEditOutput>)

import { dirname, resolve } from 'path'
import type { PermissionResult } from 'src/utils/permissions/PermissionResult.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { writeTextContent } from '../../utils/file.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { expandPath, toRelativePath } from '../../utils/path.js'
import { matchingRuleForInput } from '../../utils/permissions/filesystem.js'
import { APPLY_PATCH_TOOL_NAME } from './constants.js'
import { applyUpdateChunks, parsePatch, PatchParseError } from './parser.js'
import { getApplyPatchDescription } from './prompt.js'
import {
  type ApplyPatchInput,
  type ApplyPatchInputSchema,
  type ApplyPatchOutput,
  type ApplyPatchOutputSchema,
  inputSchema,
  outputSchema,
} from './types.js'

function resolvePatchPath(path: string): string {
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return expandPath(path)
  }
  return resolve(getCwd(), path)
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  return text.split('\n').length
}

export const ApplyPatchTool = buildTool({
  name: APPLY_PATCH_TOOL_NAME,
  searchHint: 'apply unified patch across multiple files atomically',
  maxResultSizeChars: 200_000,
  async description() {
    return 'Apply a unified multi-file patch atomically'
  },
  async prompt() {
    return getApplyPatchDescription()
  },
  userFacingName() {
    return 'Apply Patch'
  },
  getActivityDescription() {
    return 'Applying patch'
  },
  get inputSchema(): ApplyPatchInputSchema {
    return inputSchema()
  },
  get outputSchema(): ApplyPatchOutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isDestructive() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.patch.slice(0, 4000)
  },
  renderToolUseMessage(input) {
    if (!input?.patch) return null
    const firstFile = input.patch.match(
      /\*\*\*\s+(?:Add File|Delete File|Update File):\s+(.+)/,
    )
    return firstFile ? `patch: ${firstFile[1]}…` : 'patch'
  },
  async validateInput(input: ApplyPatchInput) {
    try {
      const { hunks } = parsePatch(input.patch)
      if (hunks.length === 0) {
        return {
          result: false,
          message: 'Patch has no hunks to apply.',
          errorCode: 1,
        }
      }
      return { result: true }
    } catch (e) {
      return {
        result: false,
        message: e instanceof Error ? e.message : 'Failed to parse patch',
        errorCode: 2,
      }
    }
  },
  async checkPermissions(
    input: ApplyPatchInput,
    context,
  ): Promise<PermissionResult> {
    const { hunks } = parsePatch(input.patch)
    const appState = context.getAppState()
    for (const hunk of hunks) {
      const abs = resolvePatchPath(hunk.path)
      const denyRule = matchingRuleForInput(
        abs,
        appState.toolPermissionContext,
        'edit',
        'deny',
      )
      if (denyRule) {
        return {
          behavior: 'deny',
          message: `Permission to edit ${abs} has been denied.`,
          decisionReason: { type: 'rule', rule: denyRule },
        }
      }
    }
    return { behavior: 'allow', updatedInput: input }
  },
  async call(input: ApplyPatchInput) {
    const { hunks } = parsePatch(input.patch)
    const fs = getFsImplementation()

    type PendingWrite =
      | { kind: 'write'; path: string; content: string }
      | { kind: 'unlink'; path: string }

    const plan: PendingWrite[] = []
    const fileChanges: ApplyPatchOutput['files'] = []
    let totalAdditions = 0
    let totalDeletions = 0

    // === Validation pass: compute every write against current contents without
    // touching disk. If anything fails, we throw before any write happens. ===
    for (const hunk of hunks) {
      const abs = resolvePatchPath(hunk.path)
      if (hunk.type === 'add') {
        let exists = false
        try {
          const stat = await fs.stat(abs)
          exists = !!stat
        } catch {
          exists = false
        }
        if (exists) {
          throw new PatchParseError(
            `apply_patch: cannot Add File — ${abs} already exists. Use Update File instead.`,
          )
        }
        const content = hunk.contents.endsWith('\n') || hunk.contents === ''
          ? hunk.contents
          : `${hunk.contents}\n`
        const additions = countLines(content)
        totalAdditions += additions
        plan.push({ kind: 'write', path: abs, content })
        fileChanges.push({
          filePath: abs,
          relativePath: toRelativePath(abs) ?? abs,
          type: 'add',
          additions,
          deletions: 0,
        })
      } else if (hunk.type === 'delete') {
        let existing: string
        try {
          existing = await fs.readFile(abs, { encoding: 'utf8' })
        } catch {
          throw new PatchParseError(
            `apply_patch: cannot Delete File — ${abs} does not exist.`,
          )
        }
        const deletions = countLines(existing)
        totalDeletions += deletions
        plan.push({ kind: 'unlink', path: abs })
        fileChanges.push({
          filePath: abs,
          relativePath: toRelativePath(abs) ?? abs,
          type: 'delete',
          additions: 0,
          deletions,
        })
      } else {
        let existing: string
        try {
          existing = await fs.readFile(abs, { encoding: 'utf8' })
        } catch {
          throw new PatchParseError(
            `apply_patch: cannot Update File — ${abs} does not exist.`,
          )
        }
        const updated = applyUpdateChunks(abs, existing, hunk.chunks)
        const additions = hunk.chunks.reduce(
          (n, c) => n + c.newLines.length,
          0,
        )
        const deletions = hunk.chunks.reduce(
          (n, c) => n + c.oldLines.length,
          0,
        )
        totalAdditions += additions
        totalDeletions += deletions

        if (hunk.movePath) {
          const destAbs = resolvePatchPath(hunk.movePath)
          plan.push({ kind: 'write', path: destAbs, content: updated })
          plan.push({ kind: 'unlink', path: abs })
          fileChanges.push({
            filePath: abs,
            relativePath: toRelativePath(destAbs) ?? destAbs,
            type: 'move',
            additions,
            deletions,
            movePath: destAbs,
          })
        } else {
          plan.push({ kind: 'write', path: abs, content: updated })
          fileChanges.push({
            filePath: abs,
            relativePath: toRelativePath(abs) ?? abs,
            type: 'update',
            additions,
            deletions,
          })
        }
      }
    }

    // === Mutation pass: at this point every change has been validated. ===
    for (const step of plan) {
      if (step.kind === 'write') {
        await fs.mkdir(dirname(step.path))
        writeTextContent(step.path, step.content, 'utf8', 'LF')
      } else {
        await fs.rm(step.path, { force: true })
      }
    }

    const data: ApplyPatchOutput = {
      patch: input.patch,
      files: fileChanges,
      totalAdditions,
      totalDeletions,
    }
    return { data }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    const lines = data.files.map(f => {
      if (f.type === 'add') return `A ${f.relativePath}`
      if (f.type === 'delete') return `D ${f.relativePath}`
      if (f.type === 'move') return `R ${f.relativePath}`
      return `M ${f.relativePath}`
    })
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Patch applied. ${data.files.length} file(s), +${data.totalAdditions}/-${data.totalDeletions}.\n${lines.join('\n')}`,
    }
  },
} satisfies ToolDef<ApplyPatchInputSchema, ApplyPatchOutput>)

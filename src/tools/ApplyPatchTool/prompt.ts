import { APPLY_PATCH_TOOL_NAME } from './constants.js'

export { APPLY_PATCH_TOOL_NAME }

export function getApplyPatchDescription(): string {
  return `Applies a unified patch that can span multiple files atomically.

The patch format is a simplified \`*** Begin Patch\` / \`*** End Patch\` block
with three hunk headers:

  *** Add File: <path>
  +<new line 1>
  +<new line 2>

  *** Delete File: <path>

  *** Update File: <path>
  *** Move to: <optional new path>
  @@ <optional context>
  -<old line>
  +<new line>
   <unchanged context>

Rules:
- Every path must be absolute or relative to the current working directory.
- For Update hunks, the lines prefixed with a single space are required context;
  they must match the existing file exactly. Otherwise the whole patch aborts
  with no partial writes.
- All hunks are validated before any file is touched. If any hunk fails, the
  tool returns an actionable error and does not modify the filesystem.
- ${APPLY_PATCH_TOOL_NAME} is the preferred tool when you need to change
  multiple files in a single coherent diff — use the Edit tool for single-file
  in-place replacements.`
}

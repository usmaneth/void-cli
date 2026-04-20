import { MULTI_EDIT_TOOL_NAME } from './constants.js'

export { MULTI_EDIT_TOOL_NAME }

export function getMultiEditDescription(): string {
  return `Applies a batch of string replacements across one or more files.

Each edit is \`{ path, oldString, newString, replaceAll? }\`. Edits are applied
sequentially within each file in the order given, and are atomic across all
files — if any edit fails validation the filesystem is left untouched and an
actionable error is returned.

Use ${MULTI_EDIT_TOOL_NAME} when you need to rename an identifier across
multiple files, apply a refactor in one shot, or chain multiple edits to the
same file without intermediate reads.`
}

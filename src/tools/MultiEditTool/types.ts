import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticBoolean } from '../../utils/semanticBoolean.js'

export const editSchema = lazySchema(() =>
  z.strictObject({
    path: z
      .string()
      .describe('Absolute or cwd-relative path to the file to edit'),
    oldString: z.string().describe('The text to replace'),
    newString: z
      .string()
      .describe('The text to replace it with (must differ from oldString)'),
    replaceAll: semanticBoolean(z.boolean().default(false).optional()).describe(
      'Replace every occurrence rather than just the first (default false)',
    ),
  }),
)

export const inputSchema = lazySchema(() =>
  z.strictObject({
    edits: z
      .array(editSchema())
      .min(1)
      .describe('Batch of edits to apply atomically across one or more files'),
  }),
)

export type MultiEditInputSchema = ReturnType<typeof inputSchema>
export type MultiEditInput = z.output<MultiEditInputSchema>
export type MultiEditEdit = z.output<ReturnType<typeof editSchema>>

export const perFileResultSchema = lazySchema(() =>
  z.object({
    path: z.string(),
    relativePath: z.string(),
    editsApplied: z.number(),
    additions: z.number(),
    deletions: z.number(),
  }),
)

export const outputSchema = lazySchema(() =>
  z.object({
    files: z.array(perFileResultSchema()),
    totalEdits: z.number(),
  }),
)

export type MultiEditOutputSchema = ReturnType<typeof outputSchema>
export type MultiEditOutput = z.infer<MultiEditOutputSchema>

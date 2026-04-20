import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

export const inputSchema = lazySchema(() =>
  z.strictObject({
    patch: z
      .string()
      .min(1)
      .describe(
        'Full patch text in *** Begin Patch / *** End Patch format spanning one or more files.',
      ),
  }),
)

export type ApplyPatchInputSchema = ReturnType<typeof inputSchema>
export type ApplyPatchInput = z.output<ApplyPatchInputSchema>

export const fileChangeSchema = lazySchema(() =>
  z.object({
    filePath: z.string(),
    relativePath: z.string(),
    type: z.enum(['add', 'update', 'delete', 'move']),
    additions: z.number(),
    deletions: z.number(),
    movePath: z.string().optional(),
  }),
)

export const outputSchema = lazySchema(() =>
  z.object({
    patch: z.string(),
    files: z.array(fileChangeSchema()),
    totalAdditions: z.number(),
    totalDeletions: z.number(),
  }),
)

export type ApplyPatchOutputSchema = ReturnType<typeof outputSchema>
export type ApplyPatchOutput = z.infer<ApplyPatchOutputSchema>

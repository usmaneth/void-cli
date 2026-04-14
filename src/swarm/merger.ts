/**
 * Swarm Merger — merges completed worktree branches back into the main branch.
 *
 * For each completed workstream:
 * 1. Merge its branch with --no-edit (auto-message)
 * 2. On conflict: accept theirs, stage, and commit
 * 3. Clean up the worktree and branch
 */

import { execa } from 'execa'
import type { MergeResult, Workstream } from './types.js'

/**
 * Merge all completed workstream branches back into the current branch.
 * Processes sequentially to handle conflicts one at a time.
 */
export async function mergeWorktrees(
  workstreams: Workstream[],
  repoRoot: string,
): Promise<MergeResult> {
  const completed = workstreams.filter(ws => ws.status === 'done' && ws.worktreeBranch)
  let totalConflicts = 0
  const allConflictFiles: string[] = []

  for (const ws of completed) {
    const branch = ws.worktreeBranch!
    try {
      // Attempt a clean merge
      await execa('git', ['merge', branch, '--no-edit'], { cwd: repoRoot })
    } catch {
      // Merge conflict — resolve by accepting theirs
      totalConflicts++

      // Find conflicting files
      const diffResult = await execa(
        'git',
        ['diff', '--name-only', '--diff-filter=U'],
        { cwd: repoRoot, reject: false },
      )
      const conflictFiles = diffResult.stdout
        .split('\n')
        .map(f => f.trim())
        .filter(Boolean)

      allConflictFiles.push(...conflictFiles)

      if (conflictFiles.length > 0) {
        // Accept theirs for all conflicting files
        await execa('git', ['checkout', '--theirs', ...conflictFiles], {
          cwd: repoRoot,
        })
        // Stage resolved files
        await execa('git', ['add', ...conflictFiles], { cwd: repoRoot })
        // Commit the merge resolution
        await execa(
          'git',
          ['commit', '--no-edit', '-m', `merge: resolve conflicts from ${branch} (accept theirs)`],
          { cwd: repoRoot },
        )
      } else {
        // No unmerged files but merge still failed — abort and skip
        await execa('git', ['merge', '--abort'], {
          cwd: repoRoot,
          reject: false,
        })
      }
    }
  }

  // Clean up worktrees and branches
  for (const ws of completed) {
    if (ws.worktreePath) {
      await execa('git', ['worktree', 'remove', ws.worktreePath, '--force'], {
        cwd: repoRoot,
        reject: false,
      })
    }
    if (ws.worktreeBranch) {
      await execa('git', ['branch', '-D', ws.worktreeBranch], {
        cwd: repoRoot,
        reject: false,
      })
    }
  }

  return {
    success: totalConflicts === 0,
    conflicts: totalConflicts,
    conflictFiles: [...new Set(allConflictFiles)],
  }
}

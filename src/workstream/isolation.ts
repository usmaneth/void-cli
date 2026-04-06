/**
 * Workstream Isolation — Git branch + working directory per workstream.
 * Uses only Node.js built-ins (child_process).
 */

import { execFileSync } from 'child_process'

/**
 * Sanitize a branch name to prevent shell injection.
 * Only allows alphanumeric, hyphens, underscores, slashes, and dots.
 */
function sanitizeBranchName(name: string): string {
  return name.replace(/[^a-zA-Z0-9/_.\-]/g, '-')
}

export class WorkstreamIsolation {
  private run(args: string[]): string {
    try {
      return execFileSync('git', args, { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    } catch (e: any) {
      return e.stdout?.toString().trim() ?? ''
    }
  }

  getCurrentBranch(): string {
    return this.run(['branch', '--show-current'])
  }

  createBranch(workstreamName: string): string {
    const branch = `void/workstream/${workstreamName.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    this.run(['checkout', '-b', sanitizeBranchName(branch)])
    return branch
  }

  switchToBranch(branchName: string): void {
    this.run(['checkout', sanitizeBranchName(branchName)])
  }

  mergeBranch(branchName: string): string {
    return this.run(['merge', sanitizeBranchName(branchName), '--no-edit'])
  }

  diffBranch(branchName: string): string {
    const safe = sanitizeBranchName(branchName)
    const base = this.run(['merge-base', 'HEAD', safe])
    if (!base) return 'No common ancestor found.'
    return this.run(['diff', '--stat', `${base}..${safe}`])
  }

  deleteBranch(branchName: string): void {
    this.run(['branch', '-d', sanitizeBranchName(branchName)])
  }

  stashChanges(): boolean {
    const result = this.run(['stash'])
    return !result.includes('No local changes')
  }

  popStash(): void {
    this.run(['stash', 'pop'])
  }

  branchExists(branchName: string): boolean {
    const result = this.run(['branch', '--list', sanitizeBranchName(branchName)])
    return result.length > 0
  }
}

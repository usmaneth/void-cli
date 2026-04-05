/**
 * Workstream Isolation — Git branch + working directory per workstream.
 * Uses only Node.js built-ins (child_process).
 */

import { execSync } from 'child_process'

export class WorkstreamIsolation {
  private run(cmd: string): string {
    try {
      return execSync(cmd, { encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    } catch (e: any) {
      return e.stdout?.toString().trim() ?? ''
    }
  }

  getCurrentBranch(): string {
    return this.run('git branch --show-current')
  }

  createBranch(workstreamName: string): string {
    const branch = `void/workstream/${workstreamName.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    this.run(`git checkout -b "${branch}"`)
    return branch
  }

  switchToBranch(branchName: string): void {
    this.run(`git checkout "${branchName}"`)
  }

  mergeBranch(branchName: string): string {
    return this.run(`git merge "${branchName}" --no-edit`)
  }

  diffBranch(branchName: string): string {
    const base = this.run(`git merge-base HEAD "${branchName}"`)
    if (!base) return 'No common ancestor found.'
    return this.run(`git diff --stat "${base}..${branchName}"`)
  }

  deleteBranch(branchName: string): void {
    this.run(`git branch -d "${branchName}"`)
  }

  stashChanges(): boolean {
    const result = this.run('git stash')
    return !result.includes('No local changes')
  }

  popStash(): void {
    this.run('git stash pop')
  }

  branchExists(branchName: string): boolean {
    const result = this.run(`git branch --list "${branchName}"`)
    return result.length > 0
  }
}

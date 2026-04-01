/**
 * Diagnostic tracking - stubbed (telemetry stripped)
 */

export type DiagnosticFile = {
  path: string
  uri: string
  diagnostics: any[]
  [key: string]: any
}

export class DiagnosticTrackingService {
  trackDiagnostics(_files: DiagnosticFile[]): void {}
  getDiagnosticFiles(): DiagnosticFile[] {
    return []
  }
  clear(): void {}
  handleQueryStart(_clients?: unknown): void {}
  shutdown(): void {}
  beforeFileEdited(_path: string): void {}
  getNewDiagnostics(): DiagnosticFile[] {
    return []
  }
  static formatDiagnosticsSummary(_files: DiagnosticFile[]): string {
    return ''
  }
  static getSeveritySymbol(_severity: any): string {
    return ''
  }
}

export const diagnosticTracker = new DiagnosticTrackingService()

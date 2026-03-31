/**
 * Diagnostic tracking - stubbed (telemetry stripped)
 */

export type DiagnosticFile = {
  path: string
  diagnostics: unknown[]
}

export class DiagnosticTrackingService {
  trackDiagnostics(_files: DiagnosticFile[]): void {}
  getDiagnosticFiles(): DiagnosticFile[] {
    return []
  }
  clear(): void {}
}

export const diagnosticTracker = new DiagnosticTrackingService()

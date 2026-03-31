/**
 * BigQuery exporter - stubbed (telemetry stripped)
 */

export class BigQueryMetricsExporter {
  export(_metrics: unknown[], _resultCallback: (result: { code: number }) => void): void {
    _resultCallback({ code: 0 })
  }

  async forceFlush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

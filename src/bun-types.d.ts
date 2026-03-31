// Minimal Bun type stubs for non-Bun builds
declare namespace Bun {
  function spawn(cmd: string[], opts?: any): any
  function spawnSync(cmd: string[], opts?: any): any
  function write(path: string, data: any): Promise<number>
  function file(path: string): any
  function sleep(ms: number): Promise<void>
  const env: Record<string, string | undefined>
  const version: string
}

// Bun-specific modules
declare module 'bun' {
  export = Bun
}

declare module 'bun:test' {
  export function test(name: string, fn: () => void | Promise<void>): void
  export function describe(name: string, fn: () => void): void
  export function expect(value: any): any
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
}

// Bun supports importing .md files as text at build time
// This shim declares them as string modules for tsc
declare module '*.md' {
  const content: string
  export default content
}

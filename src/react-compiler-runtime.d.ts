// Override the empty type declarations for react/compiler-runtime
// The React Compiler emits imports of { c } from this module
declare module 'react/compiler-runtime' {
  export function c(size: number): any[]
}

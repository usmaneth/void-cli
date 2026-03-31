// Auto-generated stub for missing module
export type DeepImmutable<T> = T extends (infer R)[]
  ? ReadonlyArray<DeepImmutable<R>>
  : T extends object
  ? { readonly [P in keyof T]: DeepImmutable<T[P]> }
  : T
export type Permutations<T extends string, U extends string = T> = [T] extends [never]
  ? []
  : T extends any
  ? [T, ...Permutations<Exclude<U, T>>]
  : never

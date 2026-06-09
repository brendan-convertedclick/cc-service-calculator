// Allow the `inert` attribute on React HTML elements — @types/react@18.x does
// not declare it.
//
// This file MUST stay an external module (the `export {}` below). Without a
// top-level import/export, `declare module "react"` is treated as a wholesale
// ambient declaration that REPLACES @types/react entirely — silently stripping
// every React export (useState, ReactNode, forwardRef, …) from the whole app
// and breaking typecheck repo-wide. As a module, it AUGMENTS the real types.
export {};

declare module "react" {
  interface HTMLAttributes<T> {
    inert?: "";
  }
}

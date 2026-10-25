/**
 * Vitest augmentation for the jest-dom matchers.
 *
 * `@testing-library/jest-dom/vitest` resolves to its own copy of `vitest`'s
 * module augmentation, which can point at a different `Assertion` interface
 * than the one these tests import. We re-declare the augmentation against
 * *this* project's `vitest` module instead, so `toBeInTheDocument()` and the
 * other DOM matchers typecheck in `*.test.tsx`.
 *
 * Runtime: the matchers are actually installed in `src/test/setup.ts` via
 * `expect.extend(matchers)` — this file contributes types only.
 */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  interface Assertion<T = unknown>
    extends TestingLibraryMatchers<unknown, T> {}

  interface AsymmetricMatchersContaining
    extends TestingLibraryMatchers<unknown, unknown> {}
}

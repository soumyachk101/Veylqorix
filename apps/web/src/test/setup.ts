/**
 * jest-dom matchers for Vitest.
 *
 * We extend the *local* `expect` (the same instance the test files use) with
 * jest-dom's matchers instead of importing `@testing-library/jest-dom/vitest`,
 * because that integration re-imports `vitest` and can bind to a different
 * copy than the one running these tests.
 */
import { expect } from 'vitest';
import * as jestDomMatchers from '@testing-library/jest-dom/matchers';
// Type augmentation only (erased at runtime).
import type {} from '@testing-library/jest-dom/vitest';

expect.extend(jestDomMatchers);

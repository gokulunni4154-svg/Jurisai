import '@testing-library/jest-dom/vitest';

/**
 * Global Vitest setup, loaded once via `test.setupFiles` in vitest.config.ts.
 *
 * WHY THIS EXISTS: extends Vitest's `expect` with @testing-library/jest-dom's
 * DOM-specific matchers (e.g. `toBeInTheDocument()`, `toHaveTextContent()`).
 * Without this import, those matchers don't exist on `expect(...)` and any
 * future component test using them fails with "not a function" rather than
 * a meaningful assertion failure. The `/vitest` subpath (not the bare
 * `@testing-library/jest-dom` import) is deliberate — jest-dom ships a
 * Vitest-specific entry point that extends Vitest's `expect` directly,
 * rather than assuming a global Jest `expect` exists (this project uses
 * Vitest, not Jest, throughout).
 *
 * KEPT DELIBERATELY EMPTY BEYOND THIS. No global mocks, no test data
 * factories, no environment-variable stubbing live here. Per this
 * project's "no placeholder code" and DRY/KISS conventions, this file's
 * only job is matcher registration — anything test-specific belongs in
 * the individual test file that needs it, so a future reader of a failing
 * test doesn't have to go hunting through global setup to understand
 * what's being mocked.
 */
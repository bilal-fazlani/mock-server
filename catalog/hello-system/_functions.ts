import type { MockFn } from '../../src/lib/mock-engine/functions' // Editor-only type import (erased at load — the sandbox has no require).

// Prefer explicit params (the taught default); context is the escape hatch.
export const label: MockFn = (_ctx, status) => `CUSTOMER: ${String(status).toUpperCase()}`

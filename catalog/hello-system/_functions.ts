import type { MockFn } from '../../src/lib/mock-engine/functions' // authors installing the pkg use the published path

// Prefer explicit params (the taught default); context is the escape hatch.
export const label: MockFn = (_ctx, status) => `CUSTOMER: ${String(status).toUpperCase()}`

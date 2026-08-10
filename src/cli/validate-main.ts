// Entry point for the bundle that `mock-server validate` runs (#40). Bundled by
// scripts/build-standalone-entries.mjs into .next/standalone/validate.cjs, which is what
// both the npm launcher and the Docker shim execute — so this file must stay
// free of any Next.js import, and must not touch MongoDB.
//
// Path resolution mirrors serving: positional argument > CATALOG_PATH >
// ./catalog, resolved against the caller's cwd. The npm launcher already hands
// over an absolute path; the Docker shim and a direct `node validate.cjs` do
// not, so the fallback chain lives here too.
import path from 'node:path'
import { runValidate } from './validate'

const raw = process.argv[2] ?? process.env.CATALOG_PATH ?? 'catalog'
process.exit(runValidate(path.resolve(process.cwd(), raw)))

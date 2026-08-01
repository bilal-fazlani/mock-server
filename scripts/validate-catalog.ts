// Validates THIS repository's example catalog from a source checkout.
//
// It is `mock-server validate` (src/cli/validate.ts) plus the env-dependent
// validateAppConfig pass. The shipped subcommand deliberately omits that pass —
// a consumer's CI has no upstream base URLs to check (#40) — but here the
// catalog and this checkout's environment are validated together, exactly as
// the server would at startup.
import path from 'node:path'
import { inspectCatalog, reportValidation } from '../src/cli/validate'
import { validateAppConfig } from '../src/lib/catalog/validate'
import { ConfigError, parsePassthroughAsDefault } from '../src/lib/config'

const catalogDir = path.join(process.cwd(), 'catalog')
const report = inspectCatalog(catalogDir)

if (report.catalog !== null) {
  try {
    const passthroughAsDefault = parsePassthroughAsDefault(process.env.PASSTHROUGH_AS_DEFAULT)
    report.errors.push(...validateAppConfig(report.catalog, process.env, passthroughAsDefault))
  } catch (err) {
    if (err instanceof ConfigError) report.errors.push(err.message)
    else throw err
  }
}

process.exit(reportValidation(report))

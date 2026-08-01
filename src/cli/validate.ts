import { CatalogLoadError, loadCatalog } from '../lib/catalog/load'
import { validateCatalog } from '../lib/catalog/validate'
import type { Catalog } from '../lib/catalog/types'
import { compileResolvers } from '../lib/runtime'

export interface ValidateReport {
  /** The loaded catalog, or null when the structural walk itself failed. */
  catalog: Catalog | null
  warnings: string[]
  /** Per-item problems, rendered as a " - " list. */
  errors: string[]
  /** A structural failure that aborted the walk; already multi-line, printed verbatim. */
  fatal: string | null
}

export interface ValidateIo {
  out: (line: string) => void
  err: (line: string) => void
}

const consoleIo: ValidateIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}

/**
 * The environment-independent half of the startup gate (#40): every check that
 * is a pure function of the files on disk — the structural walk, semantic
 * validation, and resolver/`_functions` compilation.
 *
 * It deliberately omits `validateAppConfig`. Upstream base URLs and
 * `PASSTHROUGH_AS_DEFAULT` describe a deployment, not a catalog, and are
 * legitimately unset in the consumer CI runs and image builds `mock-server
 * validate` is written for; failing there would reject a perfectly good catalog
 * edit. Those checks stay with server startup, which is where a missing base
 * URL actually matters. `scripts/validate-catalog.ts` adds them back on top of
 * this function, because the repo's own catalog is checked alongside its `.env`.
 */
export function inspectCatalog(catalogDir: string): ValidateReport {
  let catalog: Catalog
  try {
    catalog = loadCatalog(catalogDir)
  } catch (err) {
    if (err instanceof CatalogLoadError) {
      return { catalog: null, warnings: [], errors: [], fatal: err.message }
    }
    throw err
  }
  const { errors: catalogErrors } = validateCatalog(catalog, catalogDir)
  const { errors: resolverErrors } = compileResolvers(catalog, catalogDir)
  return {
    catalog,
    warnings: catalog.warnings ?? [],
    errors: [...catalogErrors, ...resolverErrors],
    fatal: null,
  }
}

/** Prints a report and returns the process exit code: 0 clean, 1 on any error. */
export function reportValidation(report: ValidateReport, io: ValidateIo = consoleIo): number {
  for (const warning of report.warnings) io.err(` ! ${warning}`)

  if (report.fatal !== null) {
    io.err('Catalog validation FAILED:')
    io.err(report.fatal)
    return 1
  }
  if (report.errors.length > 0) {
    io.err('Catalog validation FAILED:')
    for (const e of report.errors) io.err(` - ${e}`)
    return 1
  }
  io.out('Catalog validation passed.')
  return 0
}

/** `inspectCatalog` + `reportValidation`: the whole `mock-server validate` run. */
export function runValidate(catalogDir: string, io: ValidateIo = consoleIo): number {
  return reportValidation(inspectCatalog(catalogDir), io)
}

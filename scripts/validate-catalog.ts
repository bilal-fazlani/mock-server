import path from 'node:path'
import { validateAppConfig, validateCatalog } from '../src/lib/catalog/validate'
import { ConfigError, parsePassthroughAsDefault } from '../src/lib/config'
import { CatalogLoadError, loadCatalog } from '../src/lib/catalog/load'
import { compileResolvers } from '../src/lib/runtime'

const root = process.cwd()
let catalog
try {
  catalog = loadCatalog(path.join(root, 'catalog'))
} catch (err) {
  if (err instanceof CatalogLoadError) {
    console.error('Catalog validation FAILED:')
    console.error(err.message)
    process.exit(1)
  }
  throw err
}
for (const warning of catalog.warnings ?? []) {
  console.warn(` ! ${warning}`)
}
const { errors: catalogErrors } = validateCatalog(catalog, path.join(root, 'catalog'))

let configErrors: string[] = []
try {
  const passthroughAsDefault = parsePassthroughAsDefault(process.env.PASSTHROUGH_AS_DEFAULT)
  configErrors = validateAppConfig(catalog, process.env, passthroughAsDefault)
} catch (err) {
  if (err instanceof ConfigError) configErrors = [err.message]
  else throw err
}

const { errors: resolverErrors } = compileResolvers(catalog, path.join(root, 'catalog'))

const errors = [...catalogErrors, ...configErrors, ...resolverErrors]
if (errors.length > 0) {
  console.error('Catalog validation FAILED:')
  for (const e of errors) console.error(` - ${e}`)
  process.exit(1)
}
console.log('Catalog validation passed.')

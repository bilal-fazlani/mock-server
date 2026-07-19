import type { Catalog } from './catalog/types'

export type EnvironmentStatus = 'set' | 'default' | 'unset'

export interface EnvironmentDefinition {
  name: string
  category: string
  description: string
  defaultValue?: string
  possibleValues?: string[]
  hideValue?: boolean
  display: boolean
}

export interface EnvironmentRow {
  name: string
  value: string
  status: EnvironmentStatus
  category: string
  description: string
  possibleValues?: string[]
  valueHidden?: boolean
}

export const APP_ENVIRONMENT: EnvironmentDefinition[] = [
  {
    name: 'CATALOG_PATH',
    category: 'System',
    description:
      'Path to the catalog directory. Relative paths resolve against the server working directory; absolute paths are used as-is.',
    defaultValue: './catalog',
    display: true,
  },
  {
    name: 'MONGODB_CONNECTION_STRING',
    category: 'System',
    description: 'MongoDB connection URI for profiles, global mocks, mappings, and logs.',
    hideValue: true,
    display: true,
  },
  {
    name: 'MONGODB_DB',
    category: 'System',
    description: 'MongoDB database name for mock data.',
    defaultValue: 'mockDB',
    display: true,
  },
  {
    name: 'PASSTHROUGH_AS_DEFAULT',
    category: 'Routing',
    description: 'Selects passthrough as the implicit scenario when true.',
    defaultValue: 'false',
    possibleValues: ['true', 'false'],
    display: true,
  },
  {
    name: 'UNMOCKED_USERS',
    category: 'Routing',
    description: 'Controls fallback behavior for unknown profile IDs.',
    defaultValue: 'ERROR',
    possibleValues: ['ERROR', 'DEFAULT_MOCK', 'REAL'],
    display: true,
  },
  {
    name: 'MOCK_CONSOLE_LOG_LEVEL',
    category: 'System',
    description: 'Console request log threshold.',
    defaultValue: 'info',
    possibleValues: ['info', 'warn', 'error'],
    display: true,
  },
  {
    name: 'PASSTHROUGH_TIMEOUT_MS',
    category: 'Routing',
    description: 'Timeout for real upstream passthrough requests.',
    defaultValue: '30000',
    display: true,
  },
  {
    name: 'RESOLVER_HISTORY_LIMIT',
    category: 'Routing',
    description: 'Number of past returned slugs passed to scenario resolvers (<slug>.mjs) as history.',
    defaultValue: '10',
    display: true,
  },
  {
    name: 'RESOLVER_HISTORY_TTL_DURATION',
    category: 'Routing',
    description:
      'How long resolver history survives for a caller with no profile. History owned by a profile or global mock never expires.',
    defaultValue: '1d',
    display: true,
  },
  {
    name: 'REQUEST_LOG_TTL_DURATION',
    category: 'System',
    description: 'How long request logs are retained before MongoDB expires them.',
    defaultValue: '1d',
    display: true,
  },
  {
    name: 'NODE_ENV',
    category: 'Runtime',
    description: 'Runtime mode reported by Next.js and Node.',
    display: false,
  },
]

export function buildEnvironmentRows(
  catalog: Catalog,
  env: Record<string, string | undefined>,
): EnvironmentRow[] {
  return [
    ...APP_ENVIRONMENT.filter((definition) => definition.display).map((definition) =>
      rowForDefinition(definition, env),
    ),
    ...catalogBaseUrlRows(catalog, env),
  ]
}

function catalogBaseUrlRows(
  catalog: Catalog,
  env: Record<string, string | undefined>,
): EnvironmentRow[] {
  const systemsByEnv = new Map<string, string[]>()
  for (const system of catalog.systems) {
    const systems = systemsByEnv.get(system.baseUrlEnv) ?? []
    systems.push(system.name)
    systemsByEnv.set(system.baseUrlEnv, systems)
  }

  return [...systemsByEnv.entries()].map(([name, systems]) =>
    rowForDefinition(
      {
        name,
        category: 'Upstream',
        description: `Base URL for ${systems.join(', ')} passthrough.`,
        display: true,
      },
      env,
    ),
  )
}

function rowForDefinition(
  definition: EnvironmentDefinition,
  env: Record<string, string | undefined>,
): EnvironmentRow {
  const raw = env[definition.name]
  const value =
    definition.hideValue && raw !== undefined
      ? 'Hidden'
      : raw === undefined
      ? definition.defaultValue === undefined
        ? '(not set)'
        : `(default: ${definition.defaultValue})`
      : raw === ''
        ? '(empty string)'
        : raw

  return {
    name: definition.name,
    value,
    status: raw === undefined ? (definition.defaultValue === undefined ? 'unset' : 'default') : 'set',
    category: definition.category,
    description: definition.description,
    ...(definition.possibleValues ? { possibleValues: definition.possibleValues } : {}),
    ...(definition.hideValue && raw !== undefined ? { valueHidden: true } : {}),
  }
}

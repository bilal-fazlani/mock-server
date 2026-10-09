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
    name: 'BIND_ADDRESS',
    category: 'System',
    description:
      'IP address the server listens on (IPv4 or IPv6). The platform-set HOSTNAME is ignored. Applies to the shipped server, CLI and image, not next dev or next start.',
    defaultValue: '0.0.0.0',
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
    defaultValue: 'DEFAULT_MOCK',
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
    name: 'MOCK_LOG_FORMAT',
    category: 'System',
    description:
      'Console log serialization: text one-liners, or one ECS-style JSON object per line for a log aggregator.',
    defaultValue: 'text',
    possibleValues: ['text', 'json'],
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
    name: 'PROFILE_KEY_TTL_DURATION',
    category: 'Routing',
    description:
      'How long a captured profile-key mapping survives when it was captured for a profile that does not exist. Mappings owned by a real profile never expire.',
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
    ...catalogUpstreamRows(catalog, env),
  ]
}

type Describe = (systems: string) => string

interface UpstreamVariable {
  systems: string[]
  describe: Describe
  hideValue: boolean
}

function catalogUpstreamRows(
  catalog: Catalog,
  env: Record<string, string | undefined>,
): EnvironmentRow[] {
  const definitions = new Map<string, UpstreamVariable>()
  const add = (name: string, system: string, describe: Describe, hideValue: boolean) => {
    const definition = definitions.get(name) ?? { systems: [], describe, hideValue }
    definition.hideValue ||= hideValue
    definition.systems.push(system)
    definitions.set(name, definition)
  }
  for (const system of catalog.systems) {
    add(system.baseUrlEnv, system.name, (systems) => `Base URL for ${systems} passthrough.`, false)
    if (system.clientCertEnv && system.clientKeyEnv) {
      add(
        system.clientCertEnv,
        system.name,
        (systems) => `PEM client certificate presented on ${systems} passthrough.`,
        true,
      )
      add(
        system.clientKeyEnv,
        system.name,
        (systems) => `PEM private key for the ${systems} client certificate.`,
        true,
      )
    }
  }

  return [...definitions.entries()].map(([name, { systems, describe, hideValue }]) =>
    rowForDefinition(
      {
        name,
        category: 'Upstream',
        description: describe(systems.join(', ')),
        ...(hideValue && { hideValue }),
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

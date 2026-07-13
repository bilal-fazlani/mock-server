import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/lib/catalog/types'
import { buildEnvironmentRows } from '../../src/lib/environment'

const catalog: Catalog = {
  systems: [
    {
      name: 'Hello System',
      slug: 'hello-system',
      baseUrlEnv: 'HELLO_SYSTEM_URL',
      endpoints: [],
    },
    {
      name: 'Orders',
      slug: 'orders',
      baseUrlEnv: 'ORDERS_URL',
      endpoints: [],
    },
    {
      name: 'Orders Duplicate',
      slug: 'orders-duplicate',
      baseUrlEnv: 'ORDERS_URL',
      endpoints: [],
    },
  ],
}

describe('buildEnvironmentRows', () => {
  it('renders app env vars and catalog upstream env vars without leaking the Mongo connection string value', () => {
    const rows = buildEnvironmentRows(catalog, {
      MONGODB_CONNECTION_STRING: 'mongodb://user:pass@localhost:27017',
      MONGODB_DB: 'mockDB',
      PASSTHROUGH_AS_DEFAULT: 'true',
      UNMOCKED_USERS: 'REAL',
      MOCK_CONSOLE_LOG_LEVEL: 'warn',
      PASSTHROUGH_TIMEOUT_MS: '1000',
      NODE_ENV: 'test',
      HELLO_SYSTEM_URL: 'http://hello.test',
      ORDERS_URL: 'http://orders.test',
    })

    expect(rows.map((row) => row.name)).toEqual([
      'MONGODB_CONNECTION_STRING',
      'MONGODB_DB',
      'PASSTHROUGH_AS_DEFAULT',
      'UNMOCKED_USERS',
      'MOCK_CONSOLE_LOG_LEVEL',
      'PASSTHROUGH_TIMEOUT_MS',
      'HELLO_SYSTEM_URL',
      'ORDERS_URL',
    ])
    expect(rows.find((row) => row.name === 'MONGODB_CONNECTION_STRING')).toMatchObject({
      category: 'System',
      status: 'set',
      value: 'Hidden',
    })
    expect(rows.find((row) => row.name === 'MONGODB_CONNECTION_STRING')?.value).not.toContain(
      'mongodb://user:pass@localhost:27017',
    )
    expect(rows.find((row) => row.name === 'NODE_ENV')).toBeUndefined()
    expect(rows.find((row) => row.name === 'ORDERS_URL')?.value).toBe('http://orders.test')
  })

  it('includes possible values for enum environment variables', () => {
    const rows = buildEnvironmentRows(catalog, {})

    expect(rows.find((row) => row.name === 'PASSTHROUGH_AS_DEFAULT')?.possibleValues).toEqual([
      'true',
      'false',
    ])
    expect(rows.find((row) => row.name === 'UNMOCKED_USERS')?.possibleValues).toEqual([
      'ERROR',
      'DEFAULT_MOCK',
      'REAL',
    ])
    expect(rows.find((row) => row.name === 'MOCK_CONSOLE_LOG_LEVEL')?.possibleValues).toEqual([
      'info',
      'warn',
      'error',
    ])
    expect(rows.find((row) => row.name === 'MONGODB_DB')?.possibleValues).toBeUndefined()
  })

  it('groups app variables into their display categories', () => {
    const rows = buildEnvironmentRows(catalog, {})

    expect(rows.find((row) => row.name === 'MONGODB_DB')?.category).toBe('System')
    expect(rows.find((row) => row.name === 'MONGODB_CONNECTION_STRING')?.category).toBe('System')
    expect(rows.find((row) => row.name === 'MOCK_CONSOLE_LOG_LEVEL')?.category).toBe('System')
    expect(rows.find((row) => row.name === 'PASSTHROUGH_TIMEOUT_MS')?.category).toBe('Routing')
    expect(rows.find((row) => row.name === 'PASSTHROUGH_AS_DEFAULT')?.category).toBe('Routing')
    expect(rows.find((row) => row.name === 'HELLO_SYSTEM_URL')?.category).toBe('Upstream')
  })

  it('marks unset optional values with their default', () => {
    const rows = buildEnvironmentRows(catalog, {})

    expect(rows.find((row) => row.name === 'MONGODB_DB')).toMatchObject({
      value: '(default: mockDB)',
      status: 'default',
    })
    expect(rows.find((row) => row.name === 'HELLO_SYSTEM_URL')).toMatchObject({
      value: '(not set)',
      status: 'unset',
    })
  })
})

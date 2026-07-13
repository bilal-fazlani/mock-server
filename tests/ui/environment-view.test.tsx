import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EnvironmentView } from '../../src/app/ui/environment/EnvironmentView'
import type { EnvironmentRow } from '../../src/lib/environment'

const rows: EnvironmentRow[] = [
  {
    name: 'MONGODB_CONNECTION_STRING',
    value: 'Hidden',
    status: 'set',
    category: 'System',
    description: 'Mongo connection URI.',
    valueHidden: true,
  },
  {
    name: 'MONGODB_DB',
    value: 'mockDB',
    status: 'set',
    category: 'System',
    description: 'Mongo database name.',
  },
  {
    name: 'MOCK_CONSOLE_LOG_LEVEL',
    value: 'info',
    status: 'default',
    category: 'System',
    description: 'Console log level.',
    possibleValues: ['info', 'warn', 'error'],
  },
  {
    name: 'UNMOCKED_USERS',
    value: 'ERROR',
    status: 'default',
    category: 'Routing',
    description: 'Unknown profile fallback.',
    possibleValues: ['ERROR', 'DEFAULT_MOCK', 'REAL'],
  },
  {
    name: 'HELLO_SYSTEM_URL',
    value: 'http://hello.test',
    status: 'set',
    category: 'Upstream',
    description: 'Base URL for Hello System passthrough.',
  },
]

describe('EnvironmentView', () => {
  it('renders environment variable names, values, and descriptions', () => {
    const html = renderToStaticMarkup(<EnvironmentView rows={rows} />)

    expect(html).toContain('Environment')
    expect(html).toContain('System')
    expect(html).toContain('Routing')
    expect(html).toContain('MONGODB_CONNECTION_STRING')
    expect(html).toContain('Hidden')
    expect(html).toContain('Mongo connection URI.')
    expect(html).toContain('MONGODB_DB')
    expect(html).toContain('mockDB')
    expect(html).toContain('MOCK_CONSOLE_LOG_LEVEL')
    expect(html).toContain('warn')
    expect(html).toContain('UNMOCKED_USERS')
    expect(html).toContain('ERROR')
    expect(html).toContain('DEFAULT_MOCK')
    expect(html).toContain('REAL')
    expect(html).toContain('HELLO_SYSTEM_URL')
    expect(html).toContain('http://hello.test')
    expect(html).toContain('Base URL for Hello System passthrough.')
  })

  it('groups by category instead of rendering a category column', () => {
    const html = renderToStaticMarkup(<EnvironmentView rows={rows} />)

    expect(html).not.toContain('<th>Category</th>')
    expect(html).toContain('<h2')
  })

  it('renders allowed values inside the description column for enum variables', () => {
    const html = renderToStaticMarkup(<EnvironmentView rows={rows} />)

    expect(html).toContain('<th>Description</th>')
    expect(html).not.toContain('<th>Allowed values</th>')
    expect(html).not.toContain('<th>Purpose</th>')
    expect(html).toContain('Allowed values:')
    expect(html).toContain('warn')
    expect(html).not.toContain('Not enum')
  })

  it('does not render the MongoDB connection string value', () => {
    const html = renderToStaticMarkup(<EnvironmentView rows={rows} />)

    expect(html).not.toContain('mongodb://')
  })
})

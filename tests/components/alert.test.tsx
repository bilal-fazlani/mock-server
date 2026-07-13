import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Alert } from '../../src/app/components/Alert'

describe('Alert', () => {
  it('renders children inside a role=alert element', () => {
    const html = renderToStaticMarkup(<Alert>Something is stale</Alert>)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Something is stale')
  })
})

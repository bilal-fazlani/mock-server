import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LogsView } from '../../src/app/ui/logs/LogsView'

const options = {
  profiles: [{ profileId: 'customer-123', displayName: 'Happy path' }],
  endpoints: [
    {
      name: 'request_transfer_assessment',
      displayName: 'Request Transfer Assessment',
      method: 'POST',
      path: '/request-transfer-assessment',
    },
  ],
}

describe('LogsView filters', () => {
  it('renders a profile combobox, endpoint listbox trigger, and log id filter', () => {
    const html = renderToStaticMarkup(
      <LogsView initialEntries={[]} options={options} initialProfile="" />,
    )
    expect(html).toContain('role="combobox"')
    expect(html).toContain('placeholder="Filter by profile"')
    expect(html).toContain('aria-label="Filter by endpoint"')
    expect(html).toContain('All endpoints')
    expect(html).toContain('placeholder="Filter by log id"')
    expect(html).not.toContain('Filter by path')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ScenarioDisclosure,
  ScenarioHoverCardBody,
  ScenarioResponseModalBody,
} from '../../src/app/components/ScenarioDisclosure'
import { Dialog } from '../../src/app/components/ui/dialog'
import type { ScenarioView } from '../../src/app/ui/catalog/scenario-view'

const frozen = { label: 'Frozen', summary: 'Account is frozen', status: 403, kind: 'fixture' as const }

// The modal body titles the dialog through Radix's `DialogTitle`, which reads the
// Dialog root context (it owns the generated `titleId` the content is labelled
// by), so it throws when rendered standalone. Rendering the body under an open
// `Dialog` root mirrors how it is mounted in the component and keeps the SSR
// markup assertable — `DialogContent` itself is portalled, and Radix portals
// render nothing under `renderToStaticMarkup` (see tests/components/ui-primitives).
function renderModalBody(body: React.ReactElement): string {
  return renderToStaticMarkup(<Dialog open>{body}</Dialog>)
}

describe('ScenarioHoverCardBody', () => {
  it('renders label, status pill, summary, and the response button', () => {
    const html = renderToStaticMarkup(<ScenarioHoverCardBody option={frozen} onViewResponse={() => {}} />)
    expect(html).toContain('Frozen')
    expect(html).toContain('HTTP 403 Forbidden')
    expect(html).toContain('Account is frozen')
    expect(html).toContain('View full response')
  })
  it('labels the resolver button as code and omits the pill without a status', () => {
    const html = renderToStaticMarkup(
      <ScenarioHoverCardBody option={{ label: 'dynamic', summary: 's', kind: 'resolver' }} onViewResponse={() => {}} />,
    )
    expect(html).toContain('View resolver code')
    expect(html).not.toContain('HTTP')
  })
  it('renders passthrough without any response button', () => {
    const html = renderToStaticMarkup(
      <ScenarioHoverCardBody option={{ label: 'Passthrough', summary: 'Forwards the request to the live upstream service.', kind: 'passthrough' }} />,
    )
    expect(html).toContain('Forwards the request')
    expect(html).not.toContain('View full response')
  })
  it('omits the summary line when the option has none', () => {
    const html = renderToStaticMarkup(<ScenarioHoverCardBody option={{ label: 'Plain', status: 200, kind: 'fixture' }} onViewResponse={() => {}} />)
    expect(html).toContain('HTTP 200 OK')
    expect(html).not.toContain('data-slot="scenario-summary"')
  })
})

describe('ScenarioResponseModalBody', () => {
  const view: ScenarioView = {
    key: 'frozen', label: 'Frozen', isDefault: false, kind: 'fixture',
    json: JSON.stringify({ status: 403, body: {} }), html: '<pre class="shiki"><code>{}</code></pre>',
  }
  it('renders header, content, and the catalog link when ready', () => {
    const html = renderModalBody(
      <ScenarioResponseModalBody
        state={{ kind: 'ready', view }}
        option={frozen}
        catalogHref="/ui/catalog/hello-system/customer_status"
        endpointDisplayName="Customer Status"
      />,
    )
    expect(html).toContain('HTTP 403 Forbidden')
    expect(html).toContain('shiki')
    expect(html).toContain('href="/ui/catalog/hello-system/customer_status"')
    expect(html).toContain('Open Customer Status in the catalog')
    // The label is the dialog's accessible name, not a plain heading.
    expect(html).toMatch(/data-slot="dialog-title"[^>]*>Frozen</)
    expect(html).toContain('Account is frozen')
    // Ready means the skeleton and the failure notice are both gone.
    expect(html).not.toContain('Loading response')
    expect(html).not.toContain('Could not load')
  })
  it('renders the error state with a retry button', () => {
    const html = renderModalBody(
      <ScenarioResponseModalBody state={{ kind: 'error', retry: () => {} }} option={frozen} catalogHref="/x" endpointDisplayName="X" />,
    )
    expect(html).toContain('Could not load')
    expect(html).toContain('Retry')
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/)
    // No stale response body, and the skeleton has given way to the notice.
    expect(html).not.toContain('shiki')
    expect(html).not.toContain('Loading response')
  })
  it('renders a labelled skeleton while loading', () => {
    const html = renderModalBody(
      <ScenarioResponseModalBody state={{ kind: 'loading' }} option={frozen} catalogHref="/x" endpointDisplayName="X" />,
    )
    expect(html).toContain('aria-label="Loading response"')
    // The header and the catalog escape hatch are available before the body lands.
    expect(html).toContain('HTTP 403 Forbidden')
    expect(html).toContain('Open X in the catalog')
    expect(html).not.toContain('Could not load')
  })
})

describe('ScenarioDisclosure', () => {
  it('wraps its child as the hover trigger without altering the element', () => {
    const html = renderToStaticMarkup(
      <ScenarioDisclosure system="s" endpointName="e" endpointDisplayName="E" slug="frozen" option={frozen}>
        <button type="button">chip</button>
      </ScenarioDisclosure>,
    )
    expect(html).toContain('>chip</button>')
    expect(html).toContain('data-state="closed"')
    // Discriminating asChild check: the trigger props must land ON the child
    // button, not on a Radix-rendered wrapper (HoverCardTrigger defaults to an
    // anchor). Both halves matter — no wrapper, and the state attribute is the
    // button's own.
    expect(html).not.toMatch(/<a[^>]*>\s*<button/)
    expect(html).toMatch(/<button[^>]*data-state="closed"[^>]*>chip<\/button>/)
  })
})

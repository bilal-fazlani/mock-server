import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HoverCard, HoverCardTrigger } from '../../src/app/components/ui/hover-card'
import { Dialog, DialogContent, DialogTitle } from '../../src/app/components/ui/dialog'

describe('hover-card primitive', () => {
  it('renders an asChild trigger without wrapping markup', () => {
    const html = renderToStaticMarkup(
      <HoverCard>
        <HoverCardTrigger asChild>
          <button type="button">chip</button>
        </HoverCardTrigger>
      </HoverCard>,
    )
    expect(html).toContain('>chip</button>')
    expect(html).toContain('data-state="closed"')
  })
})

describe('dialog primitive', () => {
  it('renders nothing for closed content', () => {
    // Radix portals render into a detached container and are skipped entirely by
    // renderToStaticMarkup, regardless of open state — so only the closed-state
    // (empty output) assertion is checkable here. Real open-state markup is
    // covered where DialogContent's body is exercised (Task 8).
    expect(
      renderToStaticMarkup(
        <Dialog><DialogContent><DialogTitle>t</DialogTitle></DialogContent></Dialog>,
      ),
    ).toBe('')
  })
})

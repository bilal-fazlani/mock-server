'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Full-bleed sticky page header. The band spans the viewport width (breaking
 * out of the centered layout container with negative margins) while its
 * content stays aligned to the layout grid. Elevation appears only once the
 * bar is actually stuck to the viewport top.
 */
export function StickyPageHeader({
  children,
  className,
  contentClassName,
}: {
  children: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const update = () => setStuck(bar.getBoundingClientRect().top < 1)
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return (
    <div
      ref={barRef}
      data-stuck={stuck}
      className={cn(
        'sticky top-0 z-30 -mt-2 mx-[calc(50%-50vw)] border-b border-border bg-background/85 backdrop-blur-md transition-[box-shadow] duration-200',
        'data-[stuck=true]:shadow-[0_4px_12px_rgba(16,24,40,0.08)] dark:data-[stuck=true]:shadow-[0_6px_16px_rgba(0,0,0,0.45)]',
        className,
      )}
    >
      <div className="mx-auto w-full max-w-[1280px] px-6">
        <div className={cn('flex flex-wrap items-center gap-3.5 py-2.5', contentClassName)}>
          {children}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '../../components/ui/button'

function fallbackCopyText(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.focus()
  textarea.select()

  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/plain', value)
    event.preventDefault()
  }

  document.addEventListener('copy', onCopy)
  document.execCommand('copy')
  document.removeEventListener('copy', onCopy)
  textarea.remove()
}

export function CopyProfileIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copyProfileId() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(value)
    } catch {
      fallbackCopyText(value)
    }
    setCopied(true)
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={copied ? 'Copied profile ID' : 'Copy profile ID'}
      title={copied ? 'Copied' : 'Copy profile ID'}
      onClick={copyProfileId}
      className="text-secondary-foreground hover:text-foreground"
    >
      <Copy aria-hidden="true" />
    </Button>
  )
}

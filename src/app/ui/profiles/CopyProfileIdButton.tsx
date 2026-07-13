'use client'

import { useState } from 'react'
import styles from './ProfileForm.module.css'

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
    <button
      type="button"
      className={styles.copyButton}
      aria-label={copied ? 'Copied profile ID' : 'Copy profile ID'}
      title={copied ? 'Copied' : 'Copy profile ID'}
      onClick={copyProfileId}
    >
      <svg
        className={styles.copyIcon}
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
    </button>
  )
}

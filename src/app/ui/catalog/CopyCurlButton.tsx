'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { EndpointRequestExample } from '../../../lib/catalog/request-example'
import styles from './endpoint.module.css'

export function CopyCurlButton({ example }: { example: EndpointRequestExample }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={styles.copyCurl}
      onClick={() => {
        void navigator.clipboard.writeText(buildCurl(example)).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? (
        <Check className={styles.copyCurlIcon} aria-hidden="true" />
      ) : (
        <Copy className={styles.copyCurlIcon} aria-hidden="true" />
      )}
      {copied ? 'Copied' : 'Copy as cURL'}
    </button>
  )
}

function buildCurl(example: EndpointRequestExample): string {
  const parts = [
    `curl -X ${example.method} '${window.location.origin}${example.path}${example.search}'`,
  ]
  for (const [name, value] of Object.entries(example.headers)) {
    parts.push(`-H '${name}: ${value}'`)
  }
  if (example.body) {
    parts.push(`-H 'content-type: application/json'`)
    parts.push(`-d '${JSON.stringify(example.body, null, 2)}'`)
  }
  return parts.join(' \\\n  ')
}

import { Badge } from '@/app/components/ui/badge'

/**
 * Badge shown for endpoints that declare a `_schema.json`, i.e. whose request
 * and response bodies are validated against a schema at runtime.
 */
export function SchemaBadge() {
  return (
    <Badge
      variant="schema"
      title="Request and response bodies are validated against a schema"
    >
      <svg
        className="h-[13px] w-[13px] shrink-0"
        viewBox="0 0 16 16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 1.5 2.5 3.5v4c0 3 2.2 5.3 5.5 6.5 3.3-1.2 5.5-3.5 5.5-6.5v-4L8 1.5Z" />
        <path d="m5.8 7.8 1.6 1.6 3-3.2" />
      </svg>
      Schema verified
    </Badge>
  )
}

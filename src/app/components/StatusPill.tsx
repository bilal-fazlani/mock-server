export function StatusPill({ value }: { value: unknown }) {
  const status = formatStatus(value)
  if (!status) return null
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full border px-2 py-[3px] font-mono text-[0.72rem] font-bold leading-[1.2] ${statusToneClassName(status.tone)}`}
    >
      {status.label}
    </span>
  )
}

function formatMetadataValue(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

type StatusTone = 'success' | 'redirect' | 'error' | 'neutral'

type FormattedStatus = {
  label: string
  tone: StatusTone
}

function formatStatus(value: unknown): FormattedStatus | null {
  const rawStatus = formatMetadataValue(value)
  if (!rawStatus) return null

  const statusCode = Number(rawStatus)
  if (!Number.isInteger(statusCode)) return { label: `HTTP ${rawStatus}`, tone: 'neutral' }

  const reasonPhrase = STATUS_REASONS[statusCode]
  return {
    label: reasonPhrase ? `HTTP ${statusCode} ${reasonPhrase}` : `HTTP ${statusCode}`,
    tone: statusTone(statusCode),
  }
}

// Status tone convention (everywhere): 2xx green, 3xx yellow, 4xx/5xx red.
function statusTone(statusCode: number): StatusTone {
  if (statusCode >= 200 && statusCode <= 299) return 'success'
  if (statusCode >= 300 && statusCode <= 399) return 'redirect'
  if (statusCode >= 400 && statusCode <= 599) return 'error'
  return 'neutral'
}

function statusToneClassName(tone: StatusTone): string {
  if (tone === 'success') return 'border-[rgba(var(--success-rgb),0.45)] bg-[var(--success-tint)] text-[var(--success)]'
  if (tone === 'redirect') return 'border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]'
  if (tone === 'error') return 'border-[#d92d20] bg-[rgba(217,45,32,0.12)] text-[#d92d20]'
  return 'border-border bg-background text-secondary-foreground'
}

const STATUS_REASONS: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
}

import { Badge } from '@/app/components/ui/badge'

export function MethodBadge({ method }: { method: string }) {
  return <Badge variant="method">{method.toUpperCase()}</Badge>
}

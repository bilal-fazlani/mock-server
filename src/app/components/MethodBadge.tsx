import styles from './MethodBadge.module.css'

export function MethodBadge({ method }: { method: string }) {
  const upper = method.toUpperCase()
  return <span className={styles.badge}>{upper}</span>
}

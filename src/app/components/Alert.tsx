import styles from './Alert.module.css'

export function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className={styles.alert}>
      {children}
    </div>
  )
}

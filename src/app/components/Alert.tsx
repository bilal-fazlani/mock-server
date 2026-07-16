export function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border px-3 py-2.5 text-[0.9rem] leading-[1.45] border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]"
    >
      {children}
    </div>
  )
}

import { RotateCcw } from 'lucide-react'

/**
 * The small "reset this endpoint's state" submit button, shared by the profile
 * form and the global-mocks form. Both surfaces used to carry their own copy of
 * the same class string; keeping the markup here is what stops them drifting.
 *
 * It is a plain submit button so `formAction` can route the enclosing form to a
 * reset server action instead of its own save action.
 */
export function ResetButton({
  formAction,
  children,
}: {
  /** Server action for this reset, pre-bound to the endpoint it resets. */
  formAction: (formData: FormData) => void | Promise<void>
  children: React.ReactNode
}) {
  return (
    <button
      formAction={formAction}
      className="inline-flex items-center gap-1.5 bg-background px-2.5 py-1 text-[0.76rem] text-secondary-foreground hover:border-muted-foreground hover:text-foreground"
    >
      <RotateCcw className="size-[13px]" aria-hidden="true" />
      {children}
    </button>
  )
}

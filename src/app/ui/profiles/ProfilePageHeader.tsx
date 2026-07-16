import Link from 'next/link'
import { Save, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { deleteProfileAction } from './actions'

export function ProfilePageHeader({
  title,
  profileId,
  meta,
  formId,
}: {
  title: string
  profileId?: string
  meta?: string
  formId?: string
}) {
  return (
    <>
      <div className="sticky top-0 z-30 -mt-2 flex w-full max-w-[1200px] flex-wrap items-center gap-3.5 border-b border-border bg-background py-2.5 shadow-[0_16px_30px_-12px_rgba(0,0,0,0.95),0_1px_0_rgba(255,255,255,0.07)] after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-3.5 after:h-3.5 after:bg-gradient-to-b after:from-[rgba(0,0,0,0.36)] after:to-transparent after:content-['']">
        <Button asChild variant="secondary">
          <Link href="/ui">← All profiles</Link>
        </Button>
        <div className="flex min-w-0 flex-[1_1_320px] items-center">
          <h1 className="min-w-0 [overflow-wrap:anywhere]">{title}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2.5">
          {formId && (
            <Button
              type="submit"
              id="profile-save-button"
              form={formId}
              className="h-9 gap-2 px-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.22)]"
            >
              <Save className="size-4" aria-hidden="true" />
              Save profile
            </Button>
          )}
          {profileId && (
            <form action={deleteProfileAction} className="flex">
              <input type="hidden" name="profileId" value={profileId} />
              <Button
                type="submit"
                variant="outline"
                size="icon"
                aria-label="Delete profile"
                title="Delete profile"
                className="border-[rgba(217,45,32,0.45)] bg-card text-[#d92d20] hover:border-[#d92d20] hover:bg-[#d92d20] hover:text-white dark:border-[rgba(217,45,32,0.45)] dark:bg-card dark:hover:border-[#d92d20] dark:hover:bg-[#d92d20]"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </form>
          )}
        </div>
      </div>
      {meta && <p className="font-mono text-[0.85rem] text-muted-foreground">{meta}</p>}
    </>
  )
}

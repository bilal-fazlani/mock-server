import Link from 'next/link'
import { Save, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { StickyPageHeader } from '../../components/StickyPageHeader'
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
      <StickyPageHeader contentClassName="max-w-[1200px]">
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
              className="h-9 gap-2 px-3.5"
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
      </StickyPageHeader>
      {meta && <p className="font-mono text-[0.85rem] text-muted-foreground">{meta}</p>}
    </>
  )
}

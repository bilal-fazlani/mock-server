import { getRuntime } from '../../../../lib/runtime'
import { ProfileForm } from '../ProfileForm'
import { ProfilePageHeader } from '../ProfilePageHeader'

// Render per request: the form's scenario options and implicit-scenario
// preselection come from runtime env (PASSTHROUGH_AS_DEFAULT) and the runtime
// catalog. Without this, `next build` prerenders the page with build-time
// values baked in.
export const dynamic = 'force-dynamic'

const profileFormId = 'profile-form'

export default function NewProfilePage() {
  return (
    <main className="grid gap-4">
      <ProfilePageHeader title="New mock profile" formId={profileFormId} />
      <ProfileForm
        catalog={getRuntime().catalog}
        passthroughAsDefault={getRuntime().passthroughAsDefault}
        formId={profileFormId}
      />
    </main>
  )
}

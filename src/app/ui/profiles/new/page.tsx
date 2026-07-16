import { getRuntime } from '../../../../lib/runtime'
import { ProfileForm } from '../ProfileForm'
import { ProfilePageHeader } from '../ProfilePageHeader'

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

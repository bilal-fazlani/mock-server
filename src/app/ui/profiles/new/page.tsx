import { getRuntime } from '../../../../lib/runtime'
import { ProfileForm } from '../ProfileForm'
import { ProfilePageHeader } from '../ProfilePageHeader'
import styles from '../profilePage.module.css'

const profileFormId = 'profile-form'

export default function NewProfilePage() {
  return (
    <main className={styles.page}>
      <ProfilePageHeader title="New mock profile" formId={profileFormId} />
      <ProfileForm
        catalog={getRuntime().catalog}
        passthroughAsDefault={getRuntime().passthroughAsDefault}
        formId={profileFormId}
      />
    </main>
  )
}

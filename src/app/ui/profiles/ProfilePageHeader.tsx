import Link from 'next/link'
import { Save, Trash2 } from 'lucide-react'
import { deleteProfileAction } from './actions'
import styles from './profilePage.module.css'

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
      <div className={styles.stickyHeader}>
        <Link href="/ui" className="btnSecondary">
          ← All profiles
        </Link>
        <div className={styles.titleRow}>
          <h1>{title}</h1>
        </div>
        <div className={styles.headerActions}>
          {formId && (
            <button
              type="submit"
              id="profile-save-button"
              form={formId}
              className={`btnPrimary ${styles.saveButton}`}
            >
              <Save className={styles.actionIcon} aria-hidden="true" />
              Save profile
            </button>
          )}
          {profileId && (
            <form action={deleteProfileAction} className={styles.deleteForm}>
              <input type="hidden" name="profileId" value={profileId} />
              <button
                type="submit"
                className={styles.deleteIconButton}
                aria-label="Delete profile"
                title="Delete profile"
              >
                <Trash2 className={styles.actionIcon} aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      </div>
      {meta && <p className={styles.meta}>{meta}</p>}
    </>
  )
}

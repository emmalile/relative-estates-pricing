import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { isInternal, hasFullAccess } from '@/lib/auth'
import FilesClient from './FilesClient'

// Project files. Internal roles only — clients never see this page, matching
// the decision that Dropbox files are internal-only.
export const dynamic = 'force-dynamic'

export default async function ProjectFilesPage({ params }) {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=/projects/${params.slug}/files`)
  if (!user.profile) redirect('/login?error=no_access')
  if (!isInternal(user.role)) redirect('/my-projects')

  return <FilesClient slug={params.slug} canManage={hasFullAccess(user.role)} />
}

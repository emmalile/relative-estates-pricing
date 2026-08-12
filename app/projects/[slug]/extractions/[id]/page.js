import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { isInternal } from '@/lib/auth'
import ExtractionClient from './ExtractionClient'

// Reviewing proposed line items is internal work — the same boundary as the
// Files page it is reached from.
export const dynamic = 'force-dynamic'

export default async function ExtractionReviewPage({ params }) {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=/projects/${params.slug}/extractions/${params.id}`)
  if (!user.profile) redirect('/login?error=no_access')
  if (!isInternal(user.role)) redirect('/my-projects')

  return <ExtractionClient slug={params.slug} id={params.id} />
}

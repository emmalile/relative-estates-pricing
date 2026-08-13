import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { isInternal } from '@/lib/auth'
import ReportingClient from './ReportingClient'

// Cost, revenue and profit across projects. Internal only — this is the
// margin view, and it sits on the same side of the boundary as the dashboard.
export const dynamic = 'force-dynamic'

export default async function ReportingPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/reporting')
  if (!user.profile) redirect('/login?error=no_access')
  if (!isInternal(user.role)) redirect('/my-projects')

  return <ReportingClient />
}

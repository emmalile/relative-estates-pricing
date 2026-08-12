import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { hasFullAccess } from '@/lib/auth'
import PeopleClient from './PeopleClient'

// Admin-gated server-side so a non-admin never briefly renders the screen
// before being bounced. The API routes enforce the same rule independently —
// hiding the UI is not the control, it just avoids a pointless round trip.
export const dynamic = 'force-dynamic'

export default async function PeoplePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/people')
  if (!user.profile) redirect('/login?error=no_access')
  if (!hasFullAccess(user.role)) redirect('/')

  return <PeopleClient currentUserId={user.id} currentUserRole={user.role} />
}

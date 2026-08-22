import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { isInternal } from '@/lib/auth'
import InboxClient from './InboxClient'

// The shared inbox. Internal only — it holds what clients and vendors have
// said to us and what the team intends to say back, and a client reading
// another client's thread would be worse than any pricing leak.
export const dynamic = 'force-dynamic'

export default async function InboxPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/inbox')
  if (!user.profile) redirect('/login?error=no_access')
  if (!isInternal(user.role)) redirect('/my-projects')

  return <InboxClient />
}

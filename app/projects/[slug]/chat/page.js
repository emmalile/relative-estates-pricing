import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { isInternal } from '@/lib/auth'
import ChatClient from './ChatClient'

// Chat sees cost and margin, so it sits on the internal side of the same
// boundary as the dashboard and project files.
export const dynamic = 'force-dynamic'

export default async function ProjectChatPage({ params }) {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?next=/projects/${params.slug}/chat`)
  if (!user.profile) redirect('/login?error=no_access')
  if (!isInternal(user.role)) redirect('/my-projects')

  return <ChatClient slug={params.slug} />
}

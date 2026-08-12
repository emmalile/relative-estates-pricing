import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { hasFullAccess } from '@/lib/auth'
import DropboxSettingsClient from './DropboxSettingsClient'

export const dynamic = 'force-dynamic'

export default async function DropboxSettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/settings/dropbox')
  if (!user.profile) redirect('/login?error=no_access')
  if (!hasFullAccess(user.role)) redirect('/')

  return <DropboxSettingsClient />
}

import { createAdminClient } from './supabase/admin'
import { hasFullAccess } from './auth'

// Does this user have access to this project?
//
// Needed because the routes that serve the client view read through the
// service-role client, which bypasses RLS. When RLS is not doing the
// filtering, the check has to be explicit and up front — otherwise the
// service role would happily hand over any project to anyone signed in.
//
// owner and admin have access to everything by role. member and client
// have access only to projects listed for them in project_members.
export async function canAccessProject(user, projectId) {
  if (!user?.profile) return false
  if (hasFullAccess(user.role)) return true

  const admin = createAdminClient()
  const { data } = await admin
    .from('project_members')
    .select('project_id')
    .eq('user_id', user.id)
    .eq('project_id', projectId)
    .maybeSingle()

  return !!data
}

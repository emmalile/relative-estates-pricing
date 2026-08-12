import { createAdminClient } from './supabase/admin'

// Turns a pending invitation into a real profile the first time someone
// signs in.
//
// A profile row cannot be created before the person authenticates, because
// profiles.id references auth.users(id) and that row does not exist yet.
// So an admin's "add Carrie" writes an invitation keyed by her email, and
// this runs on her first sign-in to convert it.
//
// Uses the service-role client deliberately: at this point the caller has
// an auth record but no profile, so has no role for any policy to check.
// It is narrow — it only ever acts on an invitation matching the verified
// email of the user who just signed in.
export async function acceptInvitationFor(user) {
  if (!user?.email) return null

  const admin = createAdminClient()
  const email = user.email.trim().toLowerCase()

  const { data: invite } = await admin
    .from('invitations')
    .select('*')
    .eq('email', email)
    .single()

  if (!invite) return null

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .upsert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
      role: invite.role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    .select()
    .single()

  if (profileError) {
    console.error('Could not create profile from invitation:', profileError)
    return null
  }

  // owner and admin see every project by role, so membership rows would be
  // redundant for them. Only scoped roles get them.
  const projectIds = invite.project_ids || []
  if (projectIds.length && !['owner', 'admin'].includes(invite.role)) {
    await admin.from('project_members').upsert(
      projectIds.map(pid => ({
        project_id: pid,
        user_id: user.id,
        added_by: invite.invited_by || null,
      })),
      { onConflict: 'project_id,user_id' }
    )
  }

  // Consumed — deleting keeps the pending list honest, and revoking later
  // is a matter of removing the profile rather than the invitation.
  await admin.from('invitations').delete().eq('email', email)

  return profile
}

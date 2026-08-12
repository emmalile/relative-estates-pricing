import { NextResponse } from 'next/server'
import { requireAdmin, ROLES } from '@/lib/auth'

// PATCH /api/people/[id] — change someone's role and/or which projects
// they can see. id is their profile id.
export async function PATCH(request, { params }) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase, user } = auth
  const { id } = params

  const { role, projectIds } = await request.json()

  const { data: target } = await supabase
    .from('profiles').select('id, role, email').eq('id', id).single()
  if (!target) {
    return NextResponse.json({ error: 'No such person' }, { status: 404 })
  }

  // The owner is the account of last resort — if it could be demoted, an
  // admin could lock the owner out of their own system.
  if (target.role === 'owner' && role && role !== 'owner') {
    return NextResponse.json({ error: 'The owner role cannot be changed' }, { status: 403 })
  }
  if (role && !ROLES.includes(role)) {
    return NextResponse.json({ error: 'Unknown role' }, { status: 400 })
  }
  if (role === 'owner' && user.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can grant the owner role' }, { status: 403 })
  }

  const nextRole = role || target.role

  if (role) {
    const { error } = await supabase
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Project assignments are replaced wholesale — the UI sends the full set
  // it wants, so this is a set operation rather than an incremental one.
  if (Array.isArray(projectIds)) {
    const { error: delError } = await supabase
      .from('project_members').delete().eq('user_id', id)
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

    // owner and admin see everything by role, so membership rows would be
    // meaningless for them.
    if (projectIds.length && !['owner', 'admin'].includes(nextRole)) {
      const { error: insError } = await supabase.from('project_members').insert(
        projectIds.map(pid => ({ project_id: pid, user_id: id, added_by: user.id }))
      )
      if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}

// DELETE /api/people/[id] — revoke someone entirely.
//
// Deleting the profile cascades to project_members, so their access ends
// on their next request. Their auth record is left alone: they can still
// sign in, they just land on "no access" like anyone uninvited.
export async function DELETE(request, { params }) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase, user } = auth
  const { id } = params

  if (id === user.id) {
    return NextResponse.json({ error: 'You cannot remove your own access' }, { status: 400 })
  }

  const { data: target } = await supabase
    .from('profiles').select('id, role').eq('id', id).single()
  if (!target) {
    return NextResponse.json({ error: 'No such person' }, { status: 404 })
  }
  if (target.role === 'owner') {
    return NextResponse.json({ error: 'The owner cannot be removed' }, { status: 403 })
  }

  const { error } = await supabase.from('profiles').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

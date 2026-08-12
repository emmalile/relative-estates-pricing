import { NextResponse } from 'next/server'
import { requireAdmin, ROLES } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/people — everyone with access, plus invitations not yet claimed.
export async function GET() {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase } = auth

  const [{ data: profiles }, { data: memberships }, { data: invitations }, { data: projects }] =
    await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('project_members').select('project_id, user_id'),
      supabase.from('invitations').select('*').order('created_at'),
      supabase.from('projects').select('id, name, slug').order('name'),
    ])

  const byUser = {}
  ;(memberships || []).forEach(m => {
    ;(byUser[m.user_id] = byUser[m.user_id] || []).push(m.project_id)
  })

  return NextResponse.json({
    members: (profiles || []).map(p => ({ ...p, project_ids: byUser[p.id] || [] })),
    invitations: invitations || [],
    projects: projects || [],
  })
}

// POST /api/people — invite someone by email.
//
// Writes an invitation rather than a profile, because profiles.id
// references auth.users(id) and that row does not exist until the person
// signs in for the first time. The invitation is claimed automatically at
// that point. See lib/invitations.js.
export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const { email, role, projectIds } = await request.json()

  const cleanEmail = (email || '').trim().toLowerCase()
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
  }
  if (!ROLES.includes(role)) {
    return NextResponse.json({ error: 'Unknown role' }, { status: 400 })
  }
  // Only the owner can mint another owner.
  if (role === 'owner' && user.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can grant the owner role' }, { status: 403 })
  }

  // Already has access? Then this is an edit, not an invite — say so rather
  // than silently creating an invitation that will never be claimed.
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('profiles').select('id, email').ilike('email', cleanEmail).maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: 'That person already has access. Edit their role below instead.' },
      { status: 409 }
    )
  }

  const { data, error } = await supabase
    .from('invitations')
    .upsert({
      email: cleanEmail,
      role,
      project_ids: Array.isArray(projectIds) ? projectIds : [],
      invited_by: user.id,
    }, { onConflict: 'email' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

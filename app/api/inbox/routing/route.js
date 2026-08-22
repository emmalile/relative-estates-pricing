import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'

// POST /api/inbox/routing — who answers for a project by default.
//
// Every message that arrives raises a task, and a task has to name
// somebody. Without this the fallback is the owner, which is the same
// bottleneck this feature exists to remove — one person, by default, for
// everything.
//
// Admins only: this decides whose work queue other people's messages land
// in, which is not a thing to be changed by whoever happens to be reading
// a thread.
export const dynamic = 'force-dynamic'

export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { projectId, assigneeId } = await request.json().catch(() => ({}))
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })

  // Only somebody who can actually see the project's threads. Assigning a
  // client, or a member without access, produces a task nobody can open.
  if (assigneeId) {
    const { data: profile } = await supabase
      .from('profiles').select('id, role').eq('id', assigneeId).maybeSingle()
    if (!profile) return NextResponse.json({ error: 'Unknown person' }, { status: 400 })
    if (!['owner', 'admin', 'member'].includes(profile.role)) {
      return NextResponse.json(
        { error: 'Messages can only be assigned to someone on the internal team.' },
        { status: 400 }
      )
    }
  }

  const { data, error } = await supabase
    .from('projects')
    .update({ primary_contact_id: assigneeId || null })
    .eq('id', projectId)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}

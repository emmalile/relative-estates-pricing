import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { AUDIENCE_LABEL } from '@/lib/messaging'

// POST /api/inbox/:id/identify — say who a number belongs to.
//
// ADMINS ONLY, and deliberately so. Every other action in the inbox is
// open to the internal team: reading threads, replying, assigning,
// closing. This one decides what a phone number is allowed to be told,
// which is the single disclosure decision in the whole feature — and once
// automatic answers are switched on, it is the decision that lets a
// number be answered from project data without a person reading the
// question first.
//
// A member can answer anybody. Only an owner or an admin can say who
// anybody is.
export const dynamic = 'force-dynamic'

// 'unknown' is not settable here. It is where a number starts, not
// somewhere a person puts one; the way to undo a mistake is to correct
// the identification, and the way to stop replying is to close the thread.
const SETTABLE = ['client', 'manufacturer', 'internal']

export async function POST(request, { params }) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { audience, profileId, vendorId, projectId, displayName } =
    await request.json().catch(() => ({}))

  if (!SETTABLE.includes(audience)) {
    return NextResponse.json(
      { error: `Audience must be one of: ${SETTABLE.join(', ')}.` }, { status: 400 }
    )
  }

  const { data: conversation } = await supabase
    .from('conversations').select('id, contact_id').eq('id', params.id).maybeSingle()
  if (!conversation) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  // A client thread has to belong to a project. It is the scope of every
  // answer that will ever be given in it — without one, "what does that
  // cost" has no defined subject, and the first automatic answer would
  // have to pick a project on the sender's behalf.
  if (audience === 'client' && !projectId) {
    return NextResponse.json(
      { error: 'A client has to be attached to a project, so it is clear what their questions are about.' },
      { status: 400 }
    )
  }

  // Each reference is checked rather than trusted. These arrive from a
  // form, and a bad id here mislabels who someone is.
  if (projectId) {
    const { data: project } = await supabase
      .from('projects').select('id').eq('id', projectId).maybeSingle()
    if (!project) return NextResponse.json({ error: 'Unknown project' }, { status: 400 })
  }

  if (profileId) {
    const { data: profile } = await supabase
      .from('profiles').select('id').eq('id', profileId).maybeSingle()
    if (!profile) return NextResponse.json({ error: 'Unknown person' }, { status: 400 })
  }

  if (vendorId) {
    const { data: vendor } = await supabase
      .from('vendors').select('id').eq('id', vendorId).maybeSingle()
    if (!vendor) return NextResponse.json({ error: 'Unknown vendor' }, { status: 400 })
  }

  const { error } = await supabase
    .from('contacts')
    .update({
      audience,
      // Cleared rather than left behind: a number reassigned from a vendor
      // to a client must not keep pointing at the vendor it used to be.
      profile_id: audience === 'client' ? (profileId || null) : null,
      vendor_id: audience === 'manufacturer' ? (vendorId || null) : null,
      project_id: projectId || null,
      display_name: displayName?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.contact_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The thread follows the contact onto the project, so it appears where
  // the work is and RLS scopes it to the people on that project.
  if (projectId) {
    await supabase.from('conversations').update({ project_id: projectId }).eq('id', params.id)
  }

  // The "who is this" task is answered by this action.
  await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      completed_by: auth.user.id,
    })
    .eq('conversation_id', params.id)
    .eq('reason', 'unknown_contact')
    .eq('status', 'open')

  return NextResponse.json({ ok: true, audience, label: AUDIENCE_LABEL[audience] })
}

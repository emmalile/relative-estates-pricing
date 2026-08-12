import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'

// DELETE /api/people/invitations/[email] — cancel an invitation that has
// not been claimed yet. Invitations are keyed by email, not by id, since
// the person has no auth record until they first sign in.
export async function DELETE(request, { params }) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase } = auth

  const email = decodeURIComponent(params.email || '').trim().toLowerCase()
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const { error } = await supabase.from('invitations').delete().eq('email', email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

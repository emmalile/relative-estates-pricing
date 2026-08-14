import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject } from '@/lib/projectAccess'

// Pricing links for one project + category: list them, issue one for a new
// vendor, revoke one.
//
// Internal only. The links themselves are the credential a vendor uses, so
// handing them out is exactly as sensitive as the pricing behind them.
//
// Reads through the service role after an explicit membership check,
// matching the other routes that cross project boundaries.

async function guard(request) {
  const auth = await requireInternal()
  if (auth.response) return { response: auth.response }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const category = searchParams.get('category')
  if (!projectId || !category) {
    return { response: NextResponse.json({ error: 'projectId and category are required' }, { status: 400 }) }
  }
  if (!(await canAccessProject(auth.user, projectId))) {
    return { response: NextResponse.json({ error: 'Not authorized for this project' }, { status: 403 }) }
  }
  return { user: auth.user, projectId, category, admin: createAdminClient() }
}

export async function GET(request) {
  const g = await guard(request)
  if (g.response) return g.response

  const { data, error } = await g.admin
    .from('vendor_form_tokens')
    .select('id, vendor_name, token, created_at, last_used_at')
    .eq('project_id', g.projectId)
    .eq('category', g.category)
    .is('revoked_at', null)
    .order('vendor_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ links: data || [] })
}

// POST — issue a link for a vendor, or re-issue one.
//
// Re-issuing replaces the token in place, which is the revoke-and-reissue
// people actually want: the old link stops working the moment the new one
// exists, rather than both being live until someone remembers to revoke.
export async function POST(request) {
  const g = await guard(request)
  if (g.response) return g.response

  const body = await request.json().catch(() => ({}))
  const vendorName = String(body.vendorName || '').trim()
  if (!vendorName) {
    return NextResponse.json({ error: 'vendorName is required' }, { status: 400 })
  }

  const { data: existing } = await g.admin
    .from('vendor_form_tokens')
    .select('id')
    .eq('project_id', g.projectId)
    .eq('category', g.category)
    .eq('vendor_name', vendorName)
    .maybeSingle()

  // 32 bytes from the platform CSPRNG, hex encoded — the same shape as the
  // column default. Generated here rather than left to the default because
  // re-issuing has to rotate an existing row, and a default only applies on
  // insert: silently keeping the old token would leave the link everyone
  // was told is dead still working.
  const token = randomBytes(32).toString('hex')

  if (existing) {
    const patch = {
      token,
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
      created_by: g.user.id,
    }
    const { data, error } = await g.admin
      .from('vendor_form_tokens')
      .update(patch)
      .eq('id', existing.id)
      .select('id, vendor_name, token, created_at, last_used_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ link: data, reissued: true })
  }

  const { data, error } = await g.admin
    .from('vendor_form_tokens')
    .insert({ project_id: g.projectId, category: g.category, vendor_name: vendorName, token, created_by: g.user.id })
    .select('id, vendor_name, token, created_at, last_used_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ link: data, reissued: false })
}

// DELETE — revoke. The row is kept so the record of who had access, and
// when they last used it, survives the link being turned off.
export async function DELETE(request) {
  const g = await guard(request)
  if (g.response) return g.response

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await g.admin
    .from('vendor_form_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('project_id', g.projectId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

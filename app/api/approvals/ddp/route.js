import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject } from '@/lib/projectAccess'

// POST /api/approvals/ddp — set the DDP / shipping rate on many lines.
//
// Shipping is quoted per container, not per material: a stone order lands
// with one freight cost that applies to every slab on it. Entering the
// same number fifty-two times, one expanded row at a time, was the way to
// do that, and it was the way it did not get done.
//
// Body: { projectId | projectSlug, category, values: { itemKey: number } }
//
// A map rather than "one value for all keys", so the same request handles
// the bulk case and the corrections you make to individual lines right
// afterwards — which is how the editor on the dashboard is laid out.
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const body = await request.json()
  const { projectId, projectSlug, category, values } = body

  if (!category || !values || typeof values !== 'object' || (!projectId && !projectSlug)) {
    return NextResponse.json(
      { error: 'category, values and one of projectId or projectSlug are required' },
      { status: 400 }
    )
  }

  const entries = Object.entries(values)
  if (!entries.length) return NextResponse.json({ updated: 0 })

  const admin = createAdminClient()

  let resolvedProjectId = projectId
  if (!resolvedProjectId) {
    const { data: project } = await admin
      .from('projects').select('id').eq('slug', projectSlug).single()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    resolvedProjectId = project.id
  }

  if (!(await canAccessProject(user, resolvedProjectId))) {
    return NextResponse.json({ error: 'Not authorized for this project' }, { status: 403 })
  }

  const { data: existingRows } = await admin
    .from('approvals').select('*')
    .eq('project_id', resolvedProjectId).eq('category', category)

  const existing = {}
  ;(existingRows || []).forEach(r => { existing[r.item_key] = r })

  const now = new Date().toISOString()
  const rows = []

  for (const [itemKey, raw] of entries) {
    const ddp = raw === null || raw === '' ? 0 : parseFloat(raw)
    if (!Number.isFinite(ddp) || ddp < 0) continue
    const ap = existing[itemKey] || {}
    // The whole stored row, then the freight rate on top. Setting shipping
    // must not be able to un-approve a line, drop a tracking number or
    // reset what the client has been shown, and enumerating the columns to
    // keep is how one of those eventually gets missed.
    //
    // client_released and client_price are among what is carried through
    // untouched, deliberately: changing freight changes the price we would
    // charge, not the price the client has already been given. The
    // dashboard flags the difference and somebody decides.
    const { id: _id, ...carried } = ap // the primary key is not ours to re-assert
    rows.push({
      ...carried,
      project_id: resolvedProjectId,
      category,
      item_key: itemKey,
      updated_at: now,
      shipping_ddp: ddp,
    })
  }

  if (!rows.length) return NextResponse.json({ updated: 0 })

  const { data, error } = await supabase
    .from('approvals')
    .upsert(rows, { onConflict: 'project_id,category,item_key' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ updated: data?.length || 0, approvals: data })
}

import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject } from '@/lib/projectAccess'
import { clientPrice } from '@/lib/clientPricing'

// POST /api/approvals/release — put prices in front of the client, or take
// them back.
//
// Internal only, and deliberately its own endpoint rather than another
// field on /api/approvals:
//
//   • The price released is computed HERE. The browser knows the number —
//     it renders it — but a client's price is not something a request body
//     gets to assert. The server recomputes it from the quotes on file.
//
//   • Releasing is a bulk action by nature. Quotes arrive a schedule at a
//     time and get reviewed a schedule at a time; fifty-two round trips to
//     do what is one decision would be slow and would half-apply if the
//     tab were closed in the middle.
//
// Body: { projectId | projectSlug, category, itemKeys: [...], release: bool }
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const body = await request.json()
  const { projectId, projectSlug, category, itemKeys, release } = body

  if (!category || !Array.isArray(itemKeys) || (!projectId && !projectSlug)) {
    return NextResponse.json(
      { error: 'category, itemKeys and one of projectId or projectSlug are required' },
      { status: 400 }
    )
  }
  if (!itemKeys.length) return NextResponse.json({ updated: 0 })

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

  const [{ data: schedule }, { data: subs }, { data: existingRows }] = await Promise.all([
    admin.from('schedules').select('items').eq('project_id', resolvedProjectId).eq('category', category).maybeSingle(),
    admin.from('submissions').select('*').eq('project_id', resolvedProjectId).eq('category', category),
    admin.from('approvals').select('*').eq('project_id', resolvedProjectId).eq('category', category),
  ])

  // Latest submission per manufacturer — the same rule the dashboard and
  // the client view use to decide which quote counts.
  const latest = {}
  ;(subs || []).forEach(s => {
    const k = s.manufacturer_name
    if (!latest[k] || new Date(s.submitted_at) > new Date(latest[k].submitted_at)) latest[k] = s
  })
  const catSubs = Object.values(latest)

  const items = schedule?.items || []
  const existing = {}
  ;(existingRows || []).forEach(r => { existing[r.item_key] = r })

  const now = new Date().toISOString()
  const wanted = new Set(itemKeys)
  const rows = []
  const skipped = []

  items.forEach((item, i) => {
    if (!wanted.has(item.key)) return
    const ap = existing[item.key] || {}
    // The whole stored row, then the release fields on top. Listing the
    // columns to carry forward by hand is how a bulk write quietly drops
    // the ones nobody remembered — tracking numbers, sample ETAs, a
    // column added next month. Spreading keeps them by default and makes
    // forgetting impossible.
    const { id: _id, ...carried } = ap // the primary key is not ours to re-assert
    const base = {
      ...carried,
      project_id: resolvedProjectId,
      category,
      item_key: item.key,
      updated_at: now,
    }

    if (!release) {
      // Holding clears the snapshot as well as the flag. Leaving a stale
      // number behind would mean a later release-without-recompute could
      // publish a price nobody looked at.
      rows.push({ ...base, client_released: false, client_price: null, client_released_at: null, client_released_by: null })
      return
    }

    const { price } = clientPrice(category, catSubs, item, i, ap)
    if (price == null) {
      // Nothing to release. Releasing a line with no price would put an
      // empty cell on the client's page and call it published.
      skipped.push(item.key)
      return
    }

    rows.push({
      ...base,
      client_released: true,
      client_price: parseFloat(price.toFixed(2)),
      client_released_at: now,
      client_released_by: user.email || null,
    })
  })

  if (!rows.length) return NextResponse.json({ updated: 0, skipped })

  // Written as the signed-in user so the "internal write approvals" policy
  // still applies — the admin client above is for reading the quotes this
  // user is already entitled to see.
  const { data, error } = await supabase
    .from('approvals')
    .upsert(rows, { onConflict: 'project_id,category,item_key' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ updated: data?.length || 0, skipped, approvals: data })
}

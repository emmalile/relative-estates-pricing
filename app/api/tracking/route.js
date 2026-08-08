import { supabase } from '@/lib/supabase'
import { STAGE_KEYS, carrierTrackingUrl } from '@/lib/shipment'
import { NextResponse } from 'next/server'

// ═══════════════════════════════════════════════════════
// POST /api/tracking — set shipment status / tracking on approvals
// ═══════════════════════════════════════════════════════
// Deliberately separate from /api/approvals so the existing pricing +
// approval flow is never touched. This route ONLY writes the Phase 3
// shipment columns; it never modifies status, quantity, notes, pricing
// or design_selection.
//
// Body:
//   projectId       (required)
//   category        (required)
//   itemKey         (single item)  — or —
//   itemKeys: []    (bulk apply to many items at once)
//   shipmentStatus  one of STAGE_KEYS, or null to clear
//   trackingNumber  string | null
//   carrier         carrier id from lib/shipment CARRIERS | null
//   trackingUrl     explicit override; otherwise derived from carrier+number
//   eta             'YYYY-MM-DD' | null
//
// Only the fields present in the body are written, so you can update a
// status without wiping an existing tracking number and vice versa.
// ═══════════════════════════════════════════════════════
export async function POST(request) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { projectId, category, itemKey, itemKeys } = body

  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  if (!category)  return NextResponse.json({ error: 'category is required' }, { status: 400 })

  const keys = Array.isArray(itemKeys) && itemKeys.length ? itemKeys : (itemKey ? [itemKey] : [])
  if (keys.length === 0) {
    return NextResponse.json({ error: 'itemKey or itemKeys is required' }, { status: 400 })
  }

  // Validate the stage against the same list the DB constraint enforces,
  // so we return a clean 400 instead of a Postgres constraint error.
  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'shipmentStatus')
  if (hasStatus && body.shipmentStatus !== null && !STAGE_KEYS.includes(body.shipmentStatus)) {
    return NextResponse.json(
      { error: `Invalid shipmentStatus. Expected one of: ${STAGE_KEYS.join(', ')}` },
      { status: 400 }
    )
  }

  // Build the patch from only the keys actually supplied.
  const patch = {}
  if (hasStatus) patch.shipment_status = body.shipmentStatus || null
  if (Object.prototype.hasOwnProperty.call(body, 'trackingNumber')) patch.tracking_number = body.trackingNumber || null
  if (Object.prototype.hasOwnProperty.call(body, 'carrier')) patch.carrier = body.carrier || null
  if (Object.prototype.hasOwnProperty.call(body, 'eta')) patch.eta = body.eta || null

  if (Object.prototype.hasOwnProperty.call(body, 'trackingUrl')) {
    patch.tracking_url = body.trackingUrl || null
  } else if (patch.carrier !== undefined || patch.tracking_number !== undefined) {
    // Derive a tracking link when we have enough to build one.
    const derived = carrierTrackingUrl(
      patch.carrier !== undefined ? patch.carrier : body.carrier,
      patch.tracking_number !== undefined ? patch.tracking_number : body.trackingNumber
    )
    if (derived) patch.tracking_url = derived
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  patch.shipment_updated_at = new Date().toISOString()

  // Approval rows may not exist yet for an item that has never been
  // actioned, so upsert on the existing unique (project_id, category,
  // item_key) constraint. Existing rows keep their pricing/approval data.
  const rows = keys.map(k => ({
    project_id: projectId,
    category,
    item_key: k,
    ...patch,
  }))

  const { data, error } = await supabase
    .from('approvals')
    .upsert(rows, { onConflict: 'project_id,category,item_key' })
    .select()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, updated: data?.length || 0, approvals: data })
}

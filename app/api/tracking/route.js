import { requireInternal } from '@/lib/auth'
import { STAGE_KEYS, KIND_KEYS, getKind, carrierTrackingUrl } from '@/lib/shipment'
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
//   kind            'product' (default) | 'sample'
//   shipmentStatus  one of STAGE_KEYS, or null to clear
//   trackingNumber  string | null
//   carrier         carrier id from lib/shipment CARRIERS | null
//   trackingUrl     explicit override; otherwise derived from carrier+number
//   eta             'YYYY-MM-DD' | null
//
// `kind` picks which set of columns the same payload lands in, so tracking
// a sample can never overwrite where the product itself is, and vice versa.
// Only the fields present in the body are written, so you can update a
// status without wiping an existing tracking number and vice versa.
// ═══════════════════════════════════════════════════════
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

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

  // Which shipment this payload is for — the product, or the sample sent
  // for it. Unknown kinds are rejected rather than silently treated as the
  // product, so a typo can't quietly overwrite real product tracking.
  const kindKey = body.kind || 'product'
  if (!KIND_KEYS.includes(kindKey)) {
    return NextResponse.json(
      { error: `Invalid kind. Expected one of: ${KIND_KEYS.join(', ')}` },
      { status: 400 }
    )
  }
  const col = getKind(kindKey).columns

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
  if (hasStatus) patch[col.status] = body.shipmentStatus || null
  if (Object.prototype.hasOwnProperty.call(body, 'trackingNumber')) patch[col.trackingNumber] = body.trackingNumber || null
  if (Object.prototype.hasOwnProperty.call(body, 'carrier')) patch[col.carrier] = body.carrier || null
  if (Object.prototype.hasOwnProperty.call(body, 'eta')) patch[col.eta] = body.eta || null

  if (Object.prototype.hasOwnProperty.call(body, 'trackingUrl')) {
    patch[col.trackingUrl] = body.trackingUrl || null
  } else if (patch[col.carrier] !== undefined || patch[col.trackingNumber] !== undefined) {
    // Derive a tracking link when we have enough to build one.
    const derived = carrierTrackingUrl(
      patch[col.carrier] !== undefined ? patch[col.carrier] : body.carrier,
      patch[col.trackingNumber] !== undefined ? patch[col.trackingNumber] : body.trackingNumber
    )
    if (derived) patch[col.trackingUrl] = derived
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  patch[col.updatedAt] = new Date().toISOString()

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

  return NextResponse.json({ success: true, kind: kindKey, updated: data?.length || 0, approvals: data })
}

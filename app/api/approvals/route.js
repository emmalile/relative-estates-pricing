import { NextResponse } from 'next/server'
import { requireUser, isInternal } from '@/lib/auth'

// GET /api/approvals?projectId=xxx&category=stone
//
// Open to any signed-in user, but RLS narrows the rows to projects they
// actually belong to — an admin sees everything, a member or client sees
// only their own projects.
export async function GET(request) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const category = searchParams.get('category')

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  let query = supabase
    .from('approvals')
    .select('*')
    .eq('project_id', projectId)

  if (category) query = query.eq('category', category)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// POST /api/approvals — upsert a single approval
//
// This merges with any existing row rather than blindly overwriting every
// column. That way a caller that's only updating one thing (e.g. the client
// dashboard saving a client note, or the owner dashboard saving a quantity)
// never has to know about — or accidentally wipe out — every other field on
// the row. Any field omitted from the request body falls back to whatever
// is already stored, not a hardcoded default.
//
// Clients are the one role that can reach this endpoint without being
// internal, and they may only write client_notes. Everything else on this
// row — status, quantity, pricing — is the team's to set, so a client
// posting those fields gets them ignored rather than honoured.
export async function POST(request) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const body = await request.json()
  const { projectId, category, itemKey, status, quantity, notes, shippingDdp, markupOverride, clientNotes, designSelection } = body

  if (!projectId || !category || !itemKey) {
    return NextResponse.json({ error: 'projectId, category, and itemKey are required' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('approvals')
    .select('*')
    .eq('project_id', projectId)
    .eq('category', category)
    .eq('item_key', itemKey)
    .single()

  const internal = isInternal(user.role)

  // A client can only ever move client_notes; every other column keeps its
  // stored value regardless of what they sent.
  const row = internal
    ? {
        project_id: projectId,
        category,
        item_key: itemKey,
        status: status !== undefined ? status : (existing?.status || 'pending'),
        quantity: quantity !== undefined ? quantity : (existing?.quantity || 0),
        notes: notes !== undefined ? notes : (existing?.notes || ''),
        shipping_ddp: shippingDdp !== undefined ? shippingDdp : (existing?.shipping_ddp || 0),
        markup_override: markupOverride !== undefined ? markupOverride : (existing?.markup_override ?? null),
        client_notes: clientNotes !== undefined ? clientNotes : (existing?.client_notes || ''),
        design_selection: designSelection !== undefined ? designSelection : (existing?.design_selection ?? null),
        updated_at: new Date().toISOString(),
      }
    : {
        project_id: projectId,
        category,
        item_key: itemKey,
        status: existing?.status || 'pending',
        quantity: existing?.quantity || 0,
        notes: existing?.notes || '',
        shipping_ddp: existing?.shipping_ddp || 0,
        markup_override: existing?.markup_override ?? null,
        client_notes: clientNotes !== undefined ? clientNotes : (existing?.client_notes || ''),
        design_selection: existing?.design_selection ?? null,
        updated_at: new Date().toISOString(),
      }

  const { data, error } = await supabase
    .from('approvals')
    .upsert(row, { onConflict: 'project_id,category,item_key' })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

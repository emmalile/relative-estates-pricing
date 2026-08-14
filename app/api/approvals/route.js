import { NextResponse } from 'next/server'
import { requireUser, requireInternal, isInternal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject } from '@/lib/projectAccess'
import { recordApprovedProduct } from '@/lib/repository'
import { recordApprovalEvent, isStatusChange } from '@/lib/approvalAudit'

// GET /api/approvals?projectId=xxx&category=stone
//
// Internal only. Approvals carry markup_override, shipping_ddp and internal
// notes, so this is not a client-facing endpoint — clients get their
// (curated) view from /api/client-view/[slug] instead.
export async function GET(request) {
  const auth = await requireInternal()
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
// Merges with any existing row rather than blindly overwriting every column,
// so a caller updating one field never has to know about — or accidentally
// wipe out — the rest of the row.
//
// Two callers with very different rights land here:
//
//   • Internal users write through their own session, so RLS applies and
//     they can set status, quantity, pricing and internal notes.
//
//   • Clients may write client_notes and nothing else. Since the lockdown,
//     the approvals write policy requires is_internal(), so a client's own
//     session is refused by the database. That path therefore goes through
//     the service-role client — which means the project-access check has to
//     be made explicitly here, because RLS is no longer doing it, and the
//     write is narrowed to the single column by construction.
export async function POST(request) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const body = await request.json()
  const {
    projectId, projectSlug, category, itemKey,
    status, quantity, notes, shippingDdp, markupOverride, clientNotes, designSelection,
  } = body

  if (!category || !itemKey || (!projectId && !projectSlug)) {
    return NextResponse.json(
      { error: 'category, itemKey, and one of projectId or projectSlug are required' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // Resolve the project id, whichever identifier the caller supplied.
  let resolvedProjectId = projectId
  if (!resolvedProjectId) {
    const { data: project } = await admin
      .from('projects').select('id').eq('slug', projectSlug).single()
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    resolvedProjectId = project.id
  }

  if (!(await canAccessProject(user, resolvedProjectId))) {
    return NextResponse.json({ error: 'Not authorized for this project' }, { status: 403 })
  }

  const internal = isInternal(user.role)
  // Internal writes run as the user so RLS still applies to them. The client
  // note path has to bypass it, having just been authorized above.
  const db = internal ? supabase : admin

  const { data: existing } = await admin
    .from('approvals')
    .select('*')
    .eq('project_id', resolvedProjectId)
    .eq('category', category)
    .eq('item_key', itemKey)
    .maybeSingle()

  const base = {
    project_id: resolvedProjectId,
    category,
    item_key: itemKey,
    updated_at: new Date().toISOString(),
  }

  const row = internal
    ? {
        ...base,
        status: status !== undefined ? status : (existing?.status || 'pending'),
        quantity: quantity !== undefined ? quantity : (existing?.quantity || 0),
        notes: notes !== undefined ? notes : (existing?.notes || ''),
        shipping_ddp: shippingDdp !== undefined ? shippingDdp : (existing?.shipping_ddp || 0),
        markup_override: markupOverride !== undefined ? markupOverride : (existing?.markup_override ?? null),
        client_notes: clientNotes !== undefined ? clientNotes : (existing?.client_notes || ''),
        design_selection: designSelection !== undefined ? designSelection : (existing?.design_selection ?? null),
      }
    : {
        // Everything except client_notes keeps its stored value, regardless
        // of what the request body claimed.
        ...base,
        status: existing?.status || 'pending',
        quantity: existing?.quantity || 0,
        notes: existing?.notes || '',
        shipping_ddp: existing?.shipping_ddp || 0,
        markup_override: existing?.markup_override ?? null,
        client_notes: clientNotes !== undefined ? clientNotes : (existing?.client_notes || ''),
        design_selection: existing?.design_selection ?? null,
      }

  const { data, error } = await db
    .from('approvals')
    .upsert(row, { onConflict: 'project_id,category,item_key' })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Who decided what, when, and at what price. Only on a real change of
  // decision — quantity and note edits arrive through this same endpoint,
  // and logging those would bury the decisions among them.
  //
  // Not awaited on purpose: the approval is already saved and the caller is
  // often waiting on a bulk loop of fifty-two of these. The function
  // swallows its own failures, so nothing here can surface as a failed
  // approval.
  if (isStatusChange(existing?.status, data.status)) {
    recordApprovalEvent(admin, {
      projectId: resolvedProjectId,
      category,
      itemKey,
      fromStatus: existing?.status,
      toStatus: data.status,
      approval: data,
      user,
    })
  }

  // An approval is the moment the firm commits to a material, so it is the
  // moment the material belongs in the repository — recorded at each vendor's
  // quoted price. Only on the transition into approved: re-saving an already
  // approved line should not keep rewriting the catalog.
  //
  // Bookkeeping must never cost an approval. A failure here is logged and
  // swallowed; the approval itself has already been written.
  if (internal && data.status === 'approved' && existing?.status !== 'approved') {
    try {
      await recordApprovedProduct(admin, {
        projectId: resolvedProjectId, category, itemKey,
      })
    } catch (e) {
      console.warn('[repository] could not record approved product:', e.message)
    }
  }

  // Never echo the internal columns back to a client.
  if (!internal) {
    return NextResponse.json({ success: true, client_notes: data.client_notes })
  }
  return NextResponse.json(data)
}

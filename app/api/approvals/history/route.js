import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject } from '@/lib/projectAccess'

// GET /api/approvals/history?projectId&category&itemKey
//
// The decision history for one line: every status change, who made it, when,
// and the price at the time.
//
// Internal only. It carries actor identities and the client price, and it
// exists to settle disputes rather than to inform a client.
export async function GET(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const category = searchParams.get('category')
  const itemKey = searchParams.get('itemKey')

  if (!projectId || !category || !itemKey) {
    return NextResponse.json({ error: 'projectId, category and itemKey are required' }, { status: 400 })
  }
  if (!(await canAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Not authorized for this project' }, { status: 403 })
  }

  const { data, error } = await createAdminClient()
    .from('approval_events')
    .select('id, from_status, to_status, unit_price, quantity, line_total, actor_email, created_at')
    .eq('project_id', projectId)
    .eq('category', category)
    .eq('item_key', itemKey)
    .order('created_at', { ascending: false })
    .limit(50)

  // Before supabase-audit-migration.sql has been run there is no table, and
  // a line with no history is the honest answer rather than an error.
  if (error) return NextResponse.json({ events: [], unavailable: true })

  return NextResponse.json({ events: data || [] })
}

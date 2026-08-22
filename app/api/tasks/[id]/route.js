import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'

// PATCH /api/tasks/:id — complete it, cancel it, or hand it to someone else.
//
// Anyone internal may act on any task they can see. Row level security has
// already decided what that is, by project.
export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const { status, assigneeId, dueAt } = await request.json().catch(() => ({}))
  const patch = {}

  if (status !== undefined) {
    if (!['open', 'done', 'cancelled'].includes(status)) {
      return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
    }
    patch.status = status
    // Who closed it and when, or cleared if it is being reopened — a task
    // marked done by somebody who then reopens it should not still claim
    // to have been finished.
    patch.completed_at = status === 'open' ? null : new Date().toISOString()
    patch.completed_by = status === 'open' ? null : user.id
  }

  if (assigneeId !== undefined) patch.assignee_id = assigneeId || null
  if (dueAt !== undefined) patch.due_at = dueAt || null

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('tasks').update(patch).eq('id', params.id).select('*').maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  return NextResponse.json({ task: data })
}

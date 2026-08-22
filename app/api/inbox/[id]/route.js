import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { AUDIENCE_SCOPE, AUDIENCE_LABEL } from '@/lib/messaging'

// One thread: who it is with, what may be said to them, and everything
// that has been said so far.
export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*), project:projects(id, name, slug)')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // RLS returns nothing rather than refusing, so an inaccessible thread and
  // a missing one look the same from here. Both are 404 — which of the two
  // it is, is not a caller's business.
  if (!conversation) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  const [{ data: messages }, { data: tasks }] = await Promise.all([
    supabase
      .from('messages')
      .select('id, direction, author, body, status, error, sent_by, created_at')
      .eq('conversation_id', params.id)
      .order('created_at')
      .limit(500),
    supabase
      .from('tasks')
      .select('*')
      .eq('conversation_id', params.id)
      .order('created_at', { ascending: false }),
  ])

  const audience = conversation.contact?.audience || 'unknown'

  return NextResponse.json({
    thread: {
      id: conversation.id,
      status: conversation.status,
      channel: conversation.channel,
      assigneeId: conversation.assignee_id,
      project: conversation.project || null,
      contact: conversation.contact,
      lastReadAt: conversation.last_read_at,
    },
    // Sent with the thread rather than looked up in the browser, so the
    // rule about what this person may be told travels with the data it
    // applies to and cannot be rendered from a stale copy.
    audience: {
      id: audience,
      label: AUDIENCE_LABEL[audience],
      scope: AUDIENCE_SCOPE[audience],
    },
    messages: messages || [],
    tasks: tasks || [],
  })
}

// PATCH — assign it, close it, reopen it, or mark it read.
export async function PATCH(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const body = await request.json().catch(() => ({}))
  const patch = {}

  if ('assigneeId' in body) patch.assignee_id = body.assigneeId || null
  if ('status' in body) {
    if (!['open', 'waiting', 'closed'].includes(body.status)) {
      return NextResponse.json({ error: 'Unknown status' }, { status: 400 })
    }
    patch.status = body.status
  }
  if (body.markRead) patch.last_read_at = new Date().toISOString()

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('conversations').update(patch).eq('id', params.id).select('id').maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  // Closing a thread settles its outstanding task. Leaving an open task
  // pointing at a closed conversation is how a task list stops being
  // trusted, and once it stops being trusted the fallback is worthless.
  if (patch.status === 'closed') {
    await supabase
      .from('tasks')
      .update({
        status: 'done',
        completed_at: new Date().toISOString(),
        completed_by: auth.user.id,
      })
      .eq('conversation_id', params.id)
      .eq('status', 'open')
  }

  return NextResponse.json({ ok: true })
}

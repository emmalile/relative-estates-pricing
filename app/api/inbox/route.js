import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { configState } from '@/lib/twilio'

// GET /api/inbox — everything the inbox screen renders in one call.
//
// Read through the signed-in user's client, not the service role, so row
// level security does the scoping: a member sees threads on the projects
// they belong to, and unscoped threads, and nothing else. The webhook is
// the only part of this feature that bypasses RLS, because it is the only
// part with no user to evaluate.
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const { searchParams } = new URL(request.url)
  const showClosed = searchParams.get('closed') === '1'

  let query = supabase
    .from('conversations')
    .select('*, contact:contacts(*), project:projects(id, name, slug)')
    .order('last_message_at', { ascending: false })
    .limit(200)

  if (!showClosed) query = query.neq('status', 'closed')

  const [
    { data: conversations, error }, { data: tasks }, { data: people },
    { data: projects }, { data: clients }, { data: vendors },
  ] = await Promise.all([
    query,
    supabase
      .from('tasks')
      .select('id, title, detail, reason, status, project_id, conversation_id, assignee_id, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(200),
    // Who a thread can be handed to. Clients are excluded: assigning a
    // client to answer a client is not a thing.
    supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .in('role', ['owner', 'admin', 'member'])
      .order('full_name'),
    // The three lists the "who is this number" form picks from.
    supabase.from('projects').select('id, name, slug, primary_contact_id').order('name'),
    supabase.from('profiles').select('id, email, full_name').eq('role', 'client').order('full_name'),
    supabase.from('vendors').select('id, name').order('name').limit(500),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (conversations || []).map(c => c.id)

  // The last line of each thread, for the list. Fetched in one query and
  // reduced here rather than as a query per thread.
  let previews = {}
  if (ids.length) {
    const { data: recent } = await supabase
      .from('messages')
      .select('conversation_id, body, direction, author, created_at')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .limit(1000)

    ;(recent || []).forEach(m => {
      if (!previews[m.conversation_id]) previews[m.conversation_id] = m
    })
  }

  const openByConversation = {}
  ;(tasks || []).forEach(t => {
    if (t.conversation_id) openByConversation[t.conversation_id] = true
  })

  const threads = (conversations || []).map(c => {
    const last = previews[c.id] || null
    return {
      id: c.id,
      status: c.status,
      channel: c.channel,
      assigneeId: c.assignee_id,
      projectId: c.project_id,
      project: c.project ? { id: c.project.id, name: c.project.name, slug: c.project.slug } : null,
      contact: c.contact
        ? {
            id: c.contact.id,
            phone: c.contact.phone,
            audience: c.contact.audience,
            displayName: c.contact.display_name,
            optedOut: !!c.contact.opted_out_at,
          }
        : null,
      lastMessage: last
        ? { body: last.body, direction: last.direction, author: last.author, at: last.created_at }
        : null,
      lastMessageAt: c.last_message_at,
      // Anything said since somebody last opened it.
      unread: !c.last_read_at || new Date(c.last_message_at) > new Date(c.last_read_at),
      hasOpenTask: !!openByConversation[c.id],
    }
  })

  return NextResponse.json({
    threads,
    tasks: tasks || [],
    people: people || [],
    projects: projects || [],
    clients: clients || [],
    vendors: vendors || [],
    me: { id: user.id, role: user.role },
    // So the screen can say "no number is connected yet" instead of
    // rendering an empty inbox that looks broken.
    messaging: configState(),
  })
}

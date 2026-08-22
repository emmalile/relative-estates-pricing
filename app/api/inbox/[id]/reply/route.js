import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { sendMessage, MAX_BODY_LENGTH, configState } from '@/lib/twilio'

// POST /api/inbox/:id/reply — a person answers, from inside the app.
//
// The message is written to the thread BEFORE it is handed to Twilio, and
// updated with what happened. A reply that failed to send is a thing the
// team needs to see; a reply that was never recorded because sending
// threw is a thing nobody can see.
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase, user } = auth

  const { body } = await request.json().catch(() => ({}))
  const text = String(body || '').trim()

  if (!text) return NextResponse.json({ error: 'Nothing to send' }, { status: 400 })
  if (text.length > MAX_BODY_LENGTH) {
    return NextResponse.json(
      { error: `That is ${text.length} characters. The limit is ${MAX_BODY_LENGTH}.` },
      { status: 400 }
    )
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, channel, status, contact:contacts(id, phone, opted_out_at, audience)')
    .eq('id', params.id)
    .maybeSingle()

  if (!conversation) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

  const contact = conversation.contact
  if (!contact?.phone) {
    return NextResponse.json({ error: 'This thread has no phone number.' }, { status: 400 })
  }

  // Refused rather than attempted. Messaging someone who sent STOP is a
  // carrier violation, and Twilio will reject it anyway — better to say so
  // here than to record a failure and leave someone wondering.
  if (contact.opted_out_at) {
    return NextResponse.json({
      error: 'This number has opted out of messages. They have to text START before we can reply.',
    }, { status: 409 })
  }

  const state = configState()
  if (!state.configured) {
    return NextResponse.json({
      error: `No phone number is connected yet — ${state.missing.join(', ')} not set.`,
      messaging: state,
    }, { status: 503 })
  }

  const { data: message, error: insertError } = await supabase
    .from('messages')
    .insert({
      conversation_id: params.id,
      direction: 'outbound',
      author: 'staff',
      body: text,
      sent_by: user.id,
      status: 'queued',
    })
    .select('*')
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  const sent = await sendMessage({
    to: contact.phone,
    body: text,
    channel: conversation.channel,
  })

  const { data: updated } = await supabase
    .from('messages')
    .update({
      status: sent.ok ? 'sent' : 'failed',
      external_id: sent.id || null,
      error: sent.ok ? null : sent.error,
    })
    .eq('id', message.id)
    .select('*')
    .maybeSingle()

  // A thread somebody has answered is waiting on the other end now, not on
  // us, and its task is done.
  if (sent.ok) {
    await Promise.all([
      supabase.from('conversations').update({
        last_message_at: new Date().toISOString(),
        last_read_at: new Date().toISOString(),
        status: conversation.status === 'closed' ? 'closed' : 'waiting',
      }).eq('id', params.id),
      supabase.from('tasks').update({
        status: 'done',
        completed_at: new Date().toISOString(),
        completed_by: user.id,
      }).eq('conversation_id', params.id).eq('status', 'open'),
    ])
  }

  return NextResponse.json(
    { message: updated || message, sent: sent.ok, error: sent.ok ? null : sent.error },
    // 200 with sent:false. The reply exists in the thread either way, and
    // the browser needs the stored message back so it can show it as
    // failed rather than losing what somebody typed.
    { status: 200 }
  )
}

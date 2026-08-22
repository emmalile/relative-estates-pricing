import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifySignature, expectedWebhookUrl, isConfigured, sendMessage } from '@/lib/twilio'
import {
  resolveContact, projectForContact, ensureConversation, defaultAssignee,
  isOptOut, isOptIn, isHelp, summarize, formatPhone,
} from '@/lib/messaging'
import { notifyInbound } from '@/lib/inboxNotify'

// POST /api/sms/inbound — Twilio delivers an inbound text here.
//
// PUBLIC. There is no signed-in user; Twilio is not a person. The request
// is authenticated by Twilio's signature over the URL and the form body,
// and nothing below runs until that check passes. This is the same shape
// as the vendor pricing form: service-role access behind a check the
// route performs itself.
//
// Everything is written through the service-role client, because RLS has
// no session to evaluate here.

export const dynamic = 'force-dynamic'

// Twilio expects TwiML. An empty response means "accepted, send nothing
// back" — every reply this feature sends goes out through the REST API
// instead, so that it is stored in the thread first and a failure to send
// is recorded rather than invisible.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

function twiml() {
  return new NextResponse(EMPTY_TWIML, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// Sent once, when a thread opens, so somebody who has just asked a
// question knows it arrived. Not sent on every message: a reply to each
// text in a running conversation is what an answering machine does.
//
// Says nothing about any project. At this point in Phase 1 nothing has
// been answered automatically, and this line must stay true when that
// changes — it promises a person, not an answer.
const ACKNOWLEDGEMENT =
  'Thanks — we have your message and someone from Relative Estate will come back to you shortly.'

export async function POST(request) {
  // The raw body is needed twice: once to verify the signature exactly as
  // Twilio computed it, once to read the fields.
  const raw = await request.text()
  const params = Object.fromEntries(new URLSearchParams(raw))

  const ok = verifySignature({
    url: expectedWebhookUrl(request),
    params,
    signature: request.headers.get('x-twilio-signature'),
  })

  if (!ok) {
    // Deliberately terse. A caller who failed the signature check is told
    // that it failed and nothing about why, or what shape would pass.
    console.warn('[sms] rejected a webhook with an invalid signature', {
      from: params.From ? `${String(params.From).slice(0, 5)}…` : null,
      configured: isConfigured(),
    })
    return new NextResponse('Forbidden', { status: 403 })
  }

  const from = params.From || ''
  const body = String(params.Body || '').trim()
  const channel = from.toLowerCase().startsWith('whatsapp:') ? 'whatsapp' : 'sms'

  const admin = createAdminClient()

  let contact, source, phone
  try {
    ({ contact, source, phone } = await resolveContact(admin, from))
  } catch (e) {
    console.error('[sms] could not resolve the sender:', e.message)
    // 200 on purpose. A non-200 makes Twilio retry, and a retry of a
    // message we failed to store is a duplicate rather than a recovery.
    return twiml()
  }

  if (!contact) {
    console.warn('[sms] unusable sender number', { from: from.slice(0, 6) })
    return twiml()
  }

  // ── STOP / START ───────────────────────────────────────
  // Twilio answers these itself on US long codes and the carriers require
  // that it does, so nothing is sent from here. What matters is that our
  // record matches the carrier's, or the app will keep queueing messages
  // that will never be delivered.
  if (isOptOut(body) || isOptIn(body)) {
    await admin.from('contacts').update({
      opted_out_at: isOptOut(body) ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', contact.id)
    return twiml()
  }

  if (isHelp(body)) return twiml()

  const projectId = await projectForContact(admin, contact)

  let conversation
  try {
    conversation = await ensureConversation(admin, { contact, projectId, channel })
  } catch (e) {
    console.error('[sms] could not open a thread:', e.message)
    return twiml()
  }

  const { data: message } = await admin.from('messages').insert({
    conversation_id: conversation.id,
    direction: 'inbound',
    author: 'contact',
    body: body || '(no text — an attachment may have been sent)',
    external_id: params.MessageSid || null,
    status: 'received',
  }).select('id').single()

  await admin.from('conversations').update({
    last_message_at: new Date().toISOString(),
    status: 'open',
    // A number is one contact whichever app they use, so switching from
    // SMS to WhatsApp continues the same thread rather than starting a
    // rival one. The thread follows them: without this the reply would go
    // back out on whichever channel the thread happened to open on, which
    // for someone abroad is the one that does not reach them.
    channel,
  }).eq('id', conversation.id)

  // Whether this is the first thing anyone has said in this thread, asked
  // of the messages themselves rather than of the thread's age. Two texts
  // sent seconds apart both find a thread that was just created; only one
  // of them finds itself alone in it.
  const { count: messageCount } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)

  const isNewThread = messageCount === 1

  // ── The task ───────────────────────────────────────────
  // One open task per thread, not one per message. Someone answering a
  // running conversation should not come back to six tasks for six texts
  // about the same thing.
  const { data: openTask } = await admin
    .from('tasks').select('id').eq('conversation_id', conversation.id)
    .eq('status', 'open').limit(1).maybeSingle()

  const assignee = conversation.assignee_id || await defaultAssignee(admin, projectId)
  const unknown = contact.audience === 'unknown'

  if (!openTask) {
    await admin.from('tasks').insert({
      project_id: projectId || null,
      conversation_id: conversation.id,
      message_id: message?.id || null,
      title: unknown
        ? `Identify ${formatPhone(contact.phone)}`
        : `Reply to ${contact.display_name || formatPhone(contact.phone)}`,
      // The question itself, so the task list is readable without opening
      // every thread. Withheld for a number nobody has identified.
      detail: unknown ? null : summarize(body, 140),
      reason: unknown ? 'unknown_contact' : 'inbound_message',
      assignee_id: assignee,
    })
  }

  // ── Letting somebody know ──────────────────────────────
  if (assignee) {
    const [{ data: profile }, { data: project }] = await Promise.all([
      admin.from('profiles').select('email').eq('id', assignee).maybeSingle(),
      projectId
        ? admin.from('projects').select('name').eq('id', projectId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    if (profile?.email) {
      await notifyInbound({
        to: profile.email,
        contact,
        project,
        body,
        conversationId: conversation.id,
        origin: process.env.NEXT_PUBLIC_APP_URL || null,
        reason: unknown ? 'unknown_contact' : 'inbound_message',
      })
    }
  }

  // ── Acknowledgement ────────────────────────────────────
  // Last, and only on a new thread. Recorded in the conversation before
  // it is sent, so the thread shows what the person on the other end
  // received even when Twilio rejects it.
  if (isNewThread && !contact.opted_out_at) {
    const { data: ack } = await admin.from('messages').insert({
      conversation_id: conversation.id,
      direction: 'outbound',
      author: 'assistant',
      body: ACKNOWLEDGEMENT,
      status: 'queued',
    }).select('id').single()

    const sent = await sendMessage({ to: contact.phone, body: ACKNOWLEDGEMENT, channel })

    if (ack?.id) {
      await admin.from('messages').update({
        status: sent.ok ? 'sent' : 'failed',
        external_id: sent.id || null,
        error: sent.ok ? null : sent.error,
      }).eq('id', ack.id)
    }
  }

  return twiml()
}

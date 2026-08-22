import { CLIENT_SHARE_SCOPE, VENDOR_SHARE_SCOPE } from './permissions'

// ═══════════════════════════════════════════════════════
// MESSAGING — WHO IS TEXTING, AND WHAT THEY MAY BE TOLD
// ═══════════════════════════════════════════════════════
// A phone number is weak identification. It is not a password, it is
// printed on business cards, and the sender is not authenticated by
// anything except that Twilio says so. Everything below is built on the
// assumption that knowing a number proves very little:
//
//   • an unrecognised number is told nothing about any project — it gets
//     an acknowledgement and raises a task for a person;
//   • a recognised number's audience decides what may be said back, and
//     audience is stored, never inferred at the moment of replying.
//
// The audience is not a level. A client and a vendor are each kept from
// seeing a different thing, and neither sees what the dashboard shows —
// see AUDIENCE_SCOPE below and the header of the migration.
// ═══════════════════════════════════════════════════════

export const AUDIENCES = ['unknown', 'client', 'manufacturer', 'internal']

export const AUDIENCE_LABEL = {
  unknown: 'Unidentified',
  client: 'Client',
  manufacturer: 'Vendor',
  internal: 'Team',
}

// What a person replying in this thread is allowed to put in front of the
// person on the other end. Rendered above the reply box, because a member
// of staff with the dashboard open in the next tab can leak margin faster
// than any assistant.
export const AUDIENCE_SCOPE = {
  unknown:
    'This number has not been identified. Say nothing about any project, ' +
    'price or schedule until it is linked to a client or a vendor.',
  client: CLIENT_SHARE_SCOPE,
  manufacturer: VENDOR_SHARE_SCOPE,
  internal: 'Internal thread. Anything the dashboard shows may be discussed here.',
}

// Whether project information may be discussed in a thread at all. Kept as
// a predicate rather than a comparison at each call site, so the answer for
// a new audience is decided in one place.
export function mayDiscussProject(audience) {
  return audience === 'client' || audience === 'manufacturer' || audience === 'internal'
}

// ── Phone numbers ────────────────────────────────────────

// To E.164, or null if it cannot be made into one.
//
// Numbers reach us three ways — Twilio (already E.164), the vendor list
// (typed by hand, "(310) 555-0134") and someone linking a contact in the
// app — and all three have to land on the same string, or the same person
// gets two contact rows and two answers to what they may see.
//
// A bare ten-digit number is assumed to be North American, but only when
// it could actually BE one. That guard matters more than it looks:
//
//   "02 1234 5678" is a Milan landline, and it is ten digits. Assuming +1
//   turns it into +1 (021) 234-5678 — a real US number belonging to
//   somebody else, which we would then quite happily text.
//
// No North American area code or exchange begins with 0 or 1, so those
// two positions are enough to tell a domestic number from a foreign one
// written locally, and anything failing the test is refused rather than
// guessed at. An overseas number has to be stored with its country code.
function isPlausiblyNorthAmerican(ten) {
  return /^[2-9]\d\d[2-9]\d{6}$/.test(ten)
}

export function normalizePhone(raw) {
  if (!raw) return null

  let s = String(raw).trim()

  // WhatsApp addresses arrive as whatsapp:+13105551234.
  s = s.replace(/^whatsapp:/i, '')

  // 00 is how most of the world writes +, and how a European vendor will
  // have typed their own number into a form.
  const hadPlus = s.startsWith('+') || /^\s*00\d/.test(s)
  const digits = s.replace(/\D/g, '').replace(/^00/, '')
  if (!digits) return null

  if (hadPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null
  if (digits.length === 10) return isPlausiblyNorthAmerican(digits) ? `+1${digits}` : null
  if (digits.length === 11 && digits.startsWith('1')) {
    return isPlausiblyNorthAmerican(digits.slice(1)) ? `+${digits}` : null
  }

  // Anything else is ambiguous — a local number with a trunk prefix, an
  // extension glued on, a typo. Refusing beats guessing wrong and
  // messaging someone else entirely.
  return null
}

// For display. +13105550134 → (310) 555-0134; anything not North
// American is left as it is rather than formatted into a shape it is not.
export function formatPhone(e164) {
  const s = String(e164 || '')
  const m = s.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : s || '—'
}

// ── Opt-out ──────────────────────────────────────────────
// Twilio answers these itself on US numbers, and carriers require that it
// does. We still recognise them so the contact's state in our database
// matches the carrier's, and so nothing queues an outbound message to
// somebody who has opted out.
const STOP_WORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']
const START_WORDS = ['start', 'yes', 'unstop']

function keyword(body) {
  return String(body || '').trim().toLowerCase().replace(/[^a-z]/g, '')
}

export function isOptOut(body) { return STOP_WORDS.includes(keyword(body)) }
export function isOptIn(body) { return START_WORDS.includes(keyword(body)) }
export function isHelp(body) { return keyword(body) === 'help' || keyword(body) === 'info' }

// ── Identification ───────────────────────────────────────

// Who is this number?
//
// Returns { contact, source } where source says how it was recognised:
//   'contact' — a row somebody created deliberately
//   'vendor'  — matched against a number already on the vendor list, and
//               recorded as a contact so it is only guessed once
//   'new'     — not recognised at all. A contact row is still created,
//               with audience 'unknown', because the message is real and
//               needs somewhere to live. 'unknown' discloses nothing.
//
// The vendor fallback exists because vendor phone numbers are already on
// file and a vendor is the *narrower* audience — matching one can only
// ever result in less being disclosed than a client thread would allow.
// There is deliberately no equivalent fallback that produces a client:
// promoting an unknown number to the audience that may see prices, on the
// strength of the number alone, is the mistake this whole file avoids.
export async function resolveContact(admin, rawPhone) {
  const phone = normalizePhone(rawPhone)
  if (!phone) return { contact: null, source: null, phone: null }

  const { data: existing } = await admin
    .from('contacts')
    .select('*')
    .eq('phone', phone)
    .maybeSingle()

  if (existing) return { contact: existing, source: 'contact', phone }

  // Vendors keep their number as typed, so every candidate is normalised
  // and compared rather than matched in SQL.
  const { data: vendors } = await admin
    .from('vendors')
    .select('id, name, contact_phone, contact_name')
    .not('contact_phone', 'is', null)
    .limit(1000)

  const vendor = (vendors || []).find(v => normalizePhone(v.contact_phone) === phone)

  const row = vendor
    ? {
        phone,
        audience: 'manufacturer',
        vendor_id: vendor.id,
        display_name: vendor.contact_name || vendor.name,
        notes: `Recognised automatically from ${vendor.name} on the vendor list.`,
      }
    : { phone, audience: 'unknown' }

  const { data: created, error } = await admin
    .from('contacts').insert(row).select('*').single()

  // Two messages from one new number arriving together: the unique index
  // on phone rejects the second, and the row it wanted now exists.
  if (error) {
    const { data: raced } = await admin
      .from('contacts').select('*').eq('phone', phone).maybeSingle()
    if (!raced) throw error
    return { contact: raced, source: 'contact', phone }
  }

  return { contact: created, source: vendor ? 'vendor' : 'new', phone }
}

// Which project is this thread about?
//
// Only answered when there is one possible answer. A client on a single
// project gets that project; anyone else gets null, and the thread sits
// unscoped until a person picks. Null is a fine state — the inbox shows
// the thread, a task names an owner, and nobody has been told anything
// about the wrong job.
export async function projectForContact(admin, contact) {
  if (!contact) return null
  if (contact.project_id) return contact.project_id

  if (contact.audience === 'client' && contact.profile_id) {
    const { data } = await admin
      .from('project_members')
      .select('project_id')
      .eq('user_id', contact.profile_id)
      .limit(2)
    if (data?.length === 1) return data[0].project_id
  }

  if (contact.audience === 'manufacturer' && contact.vendor_id) {
    const { data: vendor } = await admin
      .from('vendors').select('name').eq('id', contact.vendor_id).maybeSingle()
    if (vendor?.name) {
      const { data } = await admin
        .from('vendor_form_tokens')
        .select('project_id')
        .ilike('vendor_name', vendor.name)
        .is('revoked_at', null)
        .limit(2)
      const ids = [...new Set((data || []).map(r => r.project_id))]
      if (ids.length === 1) return ids[0]
    }
  }

  return null
}

// ── Ownership ────────────────────────────────────────────

// Who answers for this project when nobody has claimed the thread.
//
// Falls back to the owner rather than to nobody. An unassigned question
// is the thing being fixed here, so the fallback has to name someone even
// when a project has had no contact set.
export async function defaultAssignee(admin, projectId) {
  if (projectId) {
    const { data: project } = await admin
      .from('projects').select('primary_contact_id').eq('id', projectId).maybeSingle()
    if (project?.primary_contact_id) return project.primary_contact_id
  }

  const { data: owner } = await admin
    .from('profiles').select('id').eq('role', 'owner').order('created_at').limit(1).maybeSingle()

  return owner?.id || null
}

// ── Threads ──────────────────────────────────────────────

// The open thread for this contact and project, or a new one.
//
// Matches the partial unique index in the migration: one open thread per
// contact per project. A closed thread stays closed and a later message
// opens a fresh one, so "closed" means something.
export async function ensureConversation(admin, { contact, projectId, channel = 'sms' }) {
  // Built fresh each time it is run: a Supabase query builder is consumed
  // when awaited, so the retry below cannot reuse the first one.
  const findOpen = () => {
    const q = admin
      .from('conversations')
      .select('*')
      .eq('contact_id', contact.id)
      .neq('status', 'closed')
      .limit(1)
    return (projectId ? q.eq('project_id', projectId) : q.is('project_id', null)).maybeSingle()
  }

  const { data: open } = await findOpen()
  if (open) return open

  const { data: created, error } = await admin
    .from('conversations')
    .insert({
      contact_id: contact.id,
      project_id: projectId || null,
      channel,
      assignee_id: await defaultAssignee(admin, projectId),
    })
    .select('*')
    .single()

  // Two messages arriving together race for the same thread; the unique
  // index rejects the loser, whose thread is the one that already exists.
  if (error) {
    const { data: raced } = await findOpen()
    if (raced) return raced
    throw error
  }

  return created
}

// A short, readable summary of what was asked, for the task list and the
// thread list. Not the whole message — the message is one click away and
// a task list of paragraphs is a task list nobody reads.
export function summarize(body, limit = 80) {
  const clean = String(body || '').replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`
}

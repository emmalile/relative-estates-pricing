import crypto from 'crypto'

// ═══════════════════════════════════════════════════════
// TWILIO — SENDING AND VERIFYING TEXT MESSAGES
// ═══════════════════════════════════════════════════════
// Called directly over HTTP rather than through Twilio's SDK. Two calls
// are needed — send a message, verify a webhook signature — and both are
// a few lines each. A dependency that ships an HTTP client, a WebSocket
// client and a TwiML builder to provide them is not worth the install.
//
// Nothing here throws on missing configuration. The inbox has to be
// readable and honest before a phone number exists, so `configState()`
// reports which piece is missing and the UI says so, in the same shape
// the Anthropic key check uses. Guessing at "not configured yet" cost
// two days last time.
// ═══════════════════════════════════════════════════════

const API = 'https://api.twilio.com/2010-04-01'

const VARS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER']

// Trimmed, because a value pasted into a dashboard usually arrives with a
// newline on the end and a trailing newline in an auth token fails
// signature checks in a way that looks like an attack.
function env(name) {
  const raw = process.env[name]
  return typeof raw === 'string' ? raw.trim() : ''
}

// Which of the three are actually present, one by one. "Not configured"
// is a useless thing to tell someone who believes they configured it.
export function configState() {
  const missing = VARS.filter(v => !env(v))
  const sid = env('TWILIO_ACCOUNT_SID')
  return {
    configured: missing.length === 0,
    missing,
    // Enough to tell two accounts apart in a log without printing the id.
    accountHint: sid ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : null,
    fromNumber: env('TWILIO_PHONE_NUMBER') || null,
    // A common mistake with its own symptom: the SID of an API key rather
    // than the account, which authenticates but sends from nowhere.
    sidLooksWrong: !!sid && !sid.startsWith('AC'),
    deployment: {
      env: process.env.VERCEL_ENV || 'local',
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    },
  }
}

export function isConfigured() {
  return configState().configured
}

// Twilio signs each webhook with the full request URL and the POST body.
//
// The URL has to be the one Twilio called, which is not what the request
// object reports behind a proxy — Vercel terminates TLS and the handler
// sees its own internal host. `TWILIO_WEBHOOK_URL` pins it: whatever is
// configured in the Twilio console, character for character, query string
// included.
export function expectedWebhookUrl(request) {
  const pinned = env('TWILIO_WEBHOOK_URL')
  if (pinned) return pinned

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const path = new URL(request.url).pathname
  return `${proto}://${host}${path}`
}

// The signature is HMAC-SHA1 of the URL with every POST parameter appended
// as name then value, sorted by name.
//
// An unconfigured auth token returns false rather than true. This is the
// only thing standing between a public URL and the ability to write into
// the inbox as any client; "we could not check" is not a pass.
export function verifySignature({ url, params, signature }) {
  const token = env('TWILIO_AUTH_TOKEN')
  if (!token || !signature) return false

  const payload = Object.keys(params).sort().reduce(
    (acc, key) => acc + key + params[key], url
  )

  const expected = crypto.createHmac('sha1', token).update(Buffer.from(payload, 'utf8')).digest('base64')

  const a = Buffer.from(expected)
  const b = Buffer.from(String(signature))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// A single SMS segment is 160 characters, or 70 once any character falls
// outside GSM-7 — one curly quote pasted from a document more than halves
// the limit. Twilio splits longer messages itself and bills per segment;
// this only guards against sending something absurd by accident.
export const MAX_BODY_LENGTH = 1500

// WhatsApp numbers travel through the same API prefixed with `whatsapp:`.
// Handling it here means one send path for both channels rather than a
// branch at every call site.
function addressFor(number, channel) {
  const clean = String(number || '').trim()
  return channel === 'whatsapp' && !clean.startsWith('whatsapp:')
    ? `whatsapp:${clean}`
    : clean
}

// Sends a message. Resolves to { ok, id, status, error } and never throws
// — the caller has already stored the message and needs to record what
// happened to it, not lose the record to an exception.
export async function sendMessage({ to, body, channel = 'sms' }) {
  const state = configState()
  if (!state.configured) {
    return { ok: false, error: `Twilio is not configured: ${state.missing.join(', ')} not set.` }
  }

  const text = String(body || '').trim()
  if (!text) return { ok: false, error: 'Nothing to send.' }
  if (text.length > MAX_BODY_LENGTH) {
    return { ok: false, error: `Message is ${text.length} characters; the limit is ${MAX_BODY_LENGTH}.` }
  }

  const sid = env('TWILIO_ACCOUNT_SID')
  const auth = Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64')

  const form = new URLSearchParams({
    To: addressFor(to, channel),
    From: addressFor(env('TWILIO_PHONE_NUMBER'), channel),
    Body: text,
  })

  try {
    const res = await fetch(`${API}/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      // Twilio's own message is more useful than the status code — it
      // names the unverified number or the unregistered campaign.
      return { ok: false, error: data.message || `Twilio returned ${res.status}.`, code: data.code }
    }

    return { ok: true, id: data.sid, status: data.status || 'queued' }
  } catch (e) {
    return { ok: false, error: e.message || 'Could not reach Twilio.' }
  }
}

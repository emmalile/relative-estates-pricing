import { Resend } from 'resend'
import { AUDIENCE_LABEL, formatPhone } from './messaging'

// ═══════════════════════════════════════════════════════
// TELLING SOMEBODY A MESSAGE ARRIVED
// ═══════════════════════════════════════════════════════
// The inbox is only an improvement on one person's phone if the person
// who owns a question finds out about it without opening the app. This
// sends that email.
//
// Best effort throughout. The message is already stored and the task is
// already raised by the time this runs; a mail failure must not undo
// either, and must never fail the webhook — Twilio retries a non-200,
// which would deliver the same message twice.
// ═══════════════════════════════════════════════════════

const FROM = 'Relative Estate <notifications@relativeestates.com>'

// Deliberately does NOT include the message body for an unidentified
// number. Anyone can text the number; forwarding whatever they wrote into
// staff inboxes makes an unauthenticated channel into a delivery
// mechanism. The link into the inbox is enough.
function bodyBlock(text, audience) {
  if (audience === 'unknown') {
    return `<div style="font-size:13px;color:#6b6862;line-height:1.7;font-style:italic;">
      The message is in the inbox. It is not repeated here because this number has not been identified.
    </div>`
  }
  const escaped = String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<div style="font-size:15px;color:#0d0d0b;line-height:1.7;padding:16px 18px;background:#f7f5f0;border-left:2px solid #9a7a4a;">${escaped}</div>`
}

export async function notifyInbound({
  to, contact, project, body, conversationId, origin, reason,
}) {
  if (!process.env.RESEND_API_KEY || !to) return

  const who = contact?.display_name || formatPhone(contact?.phone)
  const audience = contact?.audience || 'unknown'
  const label = AUDIENCE_LABEL[audience] || 'Unidentified'
  const where = project?.name || 'No project yet'
  const link = origin ? `${origin}/inbox?thread=${conversationId}` : null

  const subject = reason === 'unknown_contact'
    ? `Unidentified number texted — ${formatPhone(contact?.phone)}`
    : `${label} message — ${who}${project?.name ? ` · ${project.name}` : ''}`

  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: FROM,
      to,
      subject,
      html: `
        <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <div style="border-bottom:1px solid #dedad2;padding-bottom:20px;margin-bottom:28px;">
            <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#9a7a4a;margin-bottom:8px;">Relative Estate</div>
            <div style="font-size:24px;font-weight:300;color:#0d0d0b;">${label} message waiting</div>
          </div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #ede9e0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#b0aca4;width:34%;">From</td>
              <td style="padding:10px 0;border-bottom:1px solid #ede9e0;font-size:14px;color:#0d0d0b;">${who}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #ede9e0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#b0aca4;">Project</td>
              <td style="padding:10px 0;border-bottom:1px solid #ede9e0;font-size:14px;color:#0d0d0b;">${where}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#b0aca4;">Assigned to</td>
              <td style="padding:10px 0;font-size:14px;color:#0d0d0b;">You</td>
            </tr>
          </table>
          ${bodyBlock(body, audience)}
          ${link ? `<div style="margin-top:28px;">
            <a href="${link}" style="display:inline-block;padding:12px 22px;background:#0d0d0b;color:#fff;text-decoration:none;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;">Open the thread</a>
          </div>` : ''}
          <div style="margin-top:28px;font-size:12px;color:#9a968e;line-height:1.7;">
            Reply from inside the app so the whole team can see the answer. Replying to this email does not reach them.
          </div>
        </div>`,
    })
  } catch (e) {
    console.warn('[inbox] could not send notification:', e.message)
  }
}

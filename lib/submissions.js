import { Resend } from 'resend'
import { ensureVendor } from './repository'
import { buildPricingCsv, pricingCsvFilename } from './pricingCsv'

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'emma@relativeestates.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.relativeestates.com'

// Writes a manufacturer's pricing for one project+category, then notifies
// on a real submission (not on autosaved drafts).
//
// Shared by two callers with very different trust levels:
//   • the public manufacturer form, via the service-role client
//   • the dashboard's CSV import, via the signed-in user's client
// The caller supplies the client, so this function stays agnostic about
// which one it is and never widens anybody's access on its own.
export async function saveSubmission(supabase, { projectSlug, category, manufacturerName, pricingData, isDraft, copyTo }) {
  const { data: project, error: projectError } = await supabase
    .from('projects').select('id, name, slug').eq('slug', projectSlug).single()

  if (projectError || !project) {
    return { error: 'Project not found', status: 404 }
  }

  const { data: existing } = await supabase
    .from('submissions')
    .select('id')
    .eq('project_id', project.id)
    .eq('category', category)
    .eq('manufacturer_name', manufacturerName)
    .single()

  let submitError
  if (existing) {
    const { error } = await supabase
      .from('submissions')
      .update({ pricing_data: pricingData, submitted_at: new Date().toISOString() })
      .eq('id', existing.id)
    submitError = error
  } else {
    const { error } = await supabase
      .from('submissions')
      .insert({ project_id: project.id, category, manufacturer_name: manufacturerName, pricing_data: pricingData })
    submitError = error
  }

  if (submitError) return { error: submitError.message, status: 500 }

  // A manufacturer who has quoted belongs in the vendor list. Drafts are
  // skipped: an autosave is not yet a quote. Never allowed to fail the
  // submission — a lost quote costs more than a missing list entry.
  if (!isDraft) {
    try {
      await ensureVendor(supabase, { name: manufacturerName, category })
    } catch (e) {
      console.warn('[vendors] could not record manufacturer:', e.message)
    }
  }

  if (!isDraft) await notify({ project, projectSlug, category, manufacturerName, pricingData })

  // The manufacturer's own copy of what they just sent. Only on a real
  // submission, only when a recipient was resolved, and never allowed to
  // fail the submission — the pricing is already saved by this point.
  if (!isDraft && copyTo) {
    await sendPricingCopy({ project, category, manufacturerName, pricingData, to: copyTo })
  }

  return { success: true }
}

// Sends the manufacturer a CSV of exactly what they submitted, as a receipt.
// Built with the same builder as the form's Export CSV button, so the copy
// in their inbox matches the file they could have downloaded.
//
// Deliberately contains nothing but their own pricing: no other vendor's
// quote, no cost, margin, markup or approval state, and no link into the
// internal app.
async function sendPricingCopy({ project, category, manufacturerName, pricingData, to }) {
  if (!process.env.RESEND_API_KEY) return
  try {
    const csv = buildPricingCsv(category, pricingData)
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)
    const priced = (pricingData || []).filter(r => r.priceSqm || r.unitPrice || (r.designOptions || []).some(d => d.unitPrice)).length

    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'Relative Estates <notifications@relativeestates.com>',
      to,
      subject: `Your ${categoryLabel.toLowerCase()} pricing for ${project.name}`,
      attachments: [{
        filename: pricingCsvFilename(manufacturerName, category),
        content: Buffer.from(csv).toString('base64'),
      }],
      html: `
        <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <div style="border-bottom: 1px solid #dedad2; padding-bottom: 24px; margin-bottom: 32px;">
            <div style="font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: #9a7a4a; margin-bottom: 8px;">Relative Estates</div>
            <div style="font-size: 28px; font-weight: 300; color: #0d0d0b;">Thank you — pricing received</div>
          </div>
          <div style="font-size: 14px; color: #4a4843; line-height: 1.7; margin-bottom: 28px;">
            We've received your ${categoryLabel.toLowerCase()} pricing for <strong>${project.name}</strong>. A copy of everything you entered is attached as a CSV for your records.
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 32px;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4; width: 40%;">Project</td><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 14px; color: #0d0d0b;">${project.name}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4;">Category</td><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 14px; color: #0d0d0b;">${categoryLabel}</td></tr>
            <tr><td style="padding: 10px 0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4;">Items Priced</td><td style="padding: 10px 0; font-size: 14px; color: #0d0d0b;">${priced} of ${(pricingData || []).length}</td></tr>
          </table>
          <div style="font-size: 13px; color: #6b6862; line-height: 1.7;">
            Need to change something? Return to the pricing link you were sent and update it — your latest submission replaces the previous one.
          </div>
          <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #ede9e0; font-size: 11px; color: #b0aca4;">Relative Estates LLC · Kansas City, MO</div>
        </div>
      `,
    })
  } catch (emailError) {
    console.error('Manufacturer copy send failed:', emailError)
  }
}

async function notify({ project, projectSlug, category, manufacturerName, pricingData }) {
  if (!process.env.RESEND_API_KEY) return
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)
    const dashboardUrl = `${APP_URL}/projects/${projectSlug}/dashboard`
    await resend.emails.send({
      from: 'Relative Estates <notifications@relativeestates.com>',
      to: NOTIFY_EMAIL,
      subject: `New ${categoryLabel} pricing received — ${project.name}`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <div style="border-bottom: 1px solid #dedad2; padding-bottom: 24px; margin-bottom: 32px;">
            <div style="font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: #9a7a4a; margin-bottom: 8px;">Relative Estates — Material Pricing System</div>
            <div style="font-size: 28px; font-weight: 300; color: #0d0d0b;">New Pricing Received</div>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 32px;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4; width: 40%;">Project</td><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 14px; color: #0d0d0b;">${project.name}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4;">Category</td><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 14px; color: #0d0d0b;">${categoryLabel}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4;">Manufacturer</td><td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 14px; color: #0d0d0b;">${manufacturerName}</td></tr>
            <tr><td style="padding: 10px 0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4;">Items Priced</td><td style="padding: 10px 0; font-size: 14px; color: #0d0d0b;">${pricingData.length} line items</td></tr>
          </table>
          <a href="${dashboardUrl}" style="display: inline-block; padding: 14px 32px; background: #0d0d0b; color: #f7f5f0; text-decoration: none; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase;">View Owner Dashboard →</a>
          <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #ede9e0; font-size: 11px; color: #b0aca4;">Relative Estates LLC · Kansas City, MO</div>
        </div>
      `,
    })
  } catch (emailError) {
    console.error('Email send failed:', emailError)
  }
}

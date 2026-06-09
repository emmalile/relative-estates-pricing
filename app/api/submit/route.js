import { supabase } from '@/lib/supabase'
import { Resend } from 'resend'
import { NextResponse } from 'next/server'

const resend = new Resend(process.env.RESEND_API_KEY)
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'emma@relativeestates.com'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.relativeestates.com'

// POST /api/submit — manufacturer submits their pricing
export async function POST(request) {
  const body = await request.json()
  const { projectSlug, category, manufacturerName, pricingData } = body

  if (!projectSlug || !category || !manufacturerName || !pricingData) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Look up the project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name, slug')
    .eq('slug', projectSlug)
    .single()

  if (projectError || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Save the submission
  const { error: submitError } = await supabase
    .from('submissions')
    .insert({
      project_id: project.id,
      category,
      manufacturer_name: manufacturerName,
      pricing_data: pricingData,
    })

  if (submitError) {
    return NextResponse.json({ error: submitError.message }, { status: 500 })
  }

  // Send notification email to Emma
  try {
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1)
    const itemCount = pricingData.length
    const dashboardUrl = `${APP_URL}/projects/${projectSlug}/dashboard`

    await resend.emails.send({
      from: 'Relative Estates <notifications@relativeestates.com>',
      to: NOTIFY_EMAIL,
      subject: `New ${categoryLabel} pricing received — ${project.name}`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <div style="border-bottom: 1px solid #dedad2; padding-bottom: 24px; margin-bottom: 32px;">
            <div style="font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: #9a7a4a; margin-bottom: 8px;">
              Relative Estates — Material Pricing System
            </div>
            <div style="font-size: 28px; font-weight: 300; color: #0d0d0b; line-height: 1.1;">
              New Pricing Received
            </div>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 32px;">
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4; width: 40%;">Project</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 14px; color: #0d0d0b;">${project.name}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4;">Category</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 14px; color: #0d0d0b;">${categoryLabel}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4;">Manufacturer</td>
              <td style="padding: 10px 0; border-bottom: 1px solid #ede9e0; font-size: 14px; color: #0d0d0b;">${manufacturerName}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b0aca4;">Items Priced</td>
              <td style="padding: 10px 0; font-size: 14px; color: #0d0d0b;">${itemCount} line items</td>
            </tr>
          </table>

          <a href="${dashboardUrl}"
             style="display: inline-block; padding: 14px 32px; background: #0d0d0b; color: #f7f5f0; text-decoration: none; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase;">
            View Owner Dashboard →
          </a>

          <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #ede9e0; font-size: 11px; color: #b0aca4;">
            Relative Estates LLC · Kansas City, MO
          </div>
        </div>
      `,
    })
  } catch (emailError) {
    // Don't fail the submission if email fails — just log it
    console.error('Email send failed:', emailError)
  }

  return NextResponse.json({ success: true })
}

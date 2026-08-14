import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { saveSubmission } from '@/lib/submissions'
import { resolveFormToken, touchFormToken } from '@/lib/formTokens'

// PUBLIC — no sign-in required. This is the manufacturer pricing form.
//
// It uses the service-role client, which bypasses RLS, so it is written to
// be deliberately narrow: it only ever touches the single project+category
// named in the URL, and it returns only the fields the form renders. It
// never returns another manufacturer's pricing, and it never exposes cost,
// margin, approvals or anything else from the internal side of the app.
//
// This replaces the form's old direct-from-browser Supabase queries. Those
// used the anon key, which — once RLS is locked down — can no longer read
// projects or schedules at all.
//
// Access is by per-vendor token, not by URL. The path used to be the whole
// credential, and project slugs are generated from project names — so a
// guessed slug read the schedule and whatever pricing had been submitted
// against it. The token also says WHICH vendor is here, which is what stops
// two vendors on one link from sharing (and overwriting) one set of prices.

// GET — everything the form needs to render itself.
export async function GET(request, { params }) {
  const { slug, category } = params
  const token = new URL(request.url).searchParams.get('t')

  const access = await resolveFormToken(token, { slug, category })
  if (!access) {
    // Deliberately identical whether the token is missing, wrong, revoked,
    // or for another schedule — a different message for each would turn
    // this into an oracle for guessing.
    return NextResponse.json({ error: 'This pricing link is not valid. Ask your contact at Relative Estates to send a new one.' }, { status: 404 })
  }
  const { project, vendorName, tokenId } = access

  const supabase = createAdminClient()
  const { data: schedule } = await supabase
    .from('schedules').select('id, category, manufacturer, items')
    .eq('project_id', project.id).eq('category', category).single()
  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found for this category' }, { status: 404 })
  }

  // This vendor's own prior submission and no one else's — keyed on the
  // token's vendor rather than on the schedule's named manufacturer, which
  // is what a second vendor on the same link used to be handed.
  const { data: existingSub } = await supabase
    .from('submissions')
    .select('pricing_data, submitted_at')
    .eq('project_id', project.id)
    .eq('category', category)
    .eq('manufacturer_name', vendorName)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  touchFormToken(tokenId)

  return NextResponse.json({
    project: { name: project.name, slug: project.slug },
    schedule: {
      category: schedule.category,
      // The vendor sees their own name, not whoever the schedule names.
      manufacturer: vendorName,
      items: schedule.items || [],
    },
    existingSubmission: existingSub
      ? { pricing_data: existingSub.pricing_data, submitted_at: existingSub.submitted_at }
      : null,
  })
}

// POST — save a draft or a final submission.
export async function POST(request, { params }) {
  const { slug, category } = params
  const token = new URL(request.url).searchParams.get('t')

  // Same gate as the GET. Without it, knowing a slug was enough to write
  // pricing into someone else's project under their vendor's name.
  const access = await resolveFormToken(token, { slug, category })
  if (!access) {
    return NextResponse.json({ error: 'This pricing link is not valid. Ask your contact at Relative Estates to send a new one.' }, { status: 404 })
  }
  const { project, vendorName } = access

  const body = await request.json()
  const { pricingData, isDraft, copyEmail } = body

  if (!Array.isArray(pricingData)) {
    return NextResponse.json({ error: 'pricingData is required' }, { status: 400 })
  }

  // Where the manufacturer's own copy of the quote goes. Whatever they typed
  // on the form wins; otherwise fall back to the address on their vendor
  // record. Anything that isn't a plausible address is dropped rather than
  // handed to Resend.
  const typedEmail = typeof copyEmail === 'string' ? copyEmail.trim() : ''
  const validTyped = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typedEmail) ? typedEmail : ''

  const supabase = createAdminClient()

  let copyTo = validTyped
  if (!copyTo && !isDraft) {
    const { data: vendor } = await supabase
      .from('vendors')
      .select('contact_email')
      .ilike('name', vendorName.trim())
      .maybeSingle()
    if (vendor?.contact_email) copyTo = vendor.contact_email
  }

  const result = await saveSubmission(supabase, {
    projectSlug: slug,
    category,
    // The vendor comes from the token, never from the schedule and never
    // from the request body. Two vendors on one category now write two
    // submissions instead of trampling one.
    manufacturerName: vendorName,
    pricingData,
    isDraft,
    copyTo,
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }
  return NextResponse.json({ success: true })
}

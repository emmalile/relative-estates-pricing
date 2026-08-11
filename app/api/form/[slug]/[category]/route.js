import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { saveSubmission } from '@/lib/submissions'

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

// GET — everything the form needs to render itself.
export async function GET(request, { params }) {
  const { slug, category } = params
  const supabase = createAdminClient()

  const { data: project } = await supabase
    .from('projects').select('id, name, slug').eq('slug', slug).single()
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const { data: schedule } = await supabase
    .from('schedules').select('id, category, manufacturer, items')
    .eq('project_id', project.id).eq('category', category).single()
  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found for this category' }, { status: 404 })
  }

  // Only this manufacturer's own prior submission, so one vendor can resume
  // a draft without ever seeing what a competing vendor quoted.
  const { data: existingSub } = await supabase
    .from('submissions')
    .select('pricing_data, submitted_at')
    .eq('project_id', project.id)
    .eq('category', category)
    .eq('manufacturer_name', schedule.manufacturer)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .single()

  return NextResponse.json({
    project: { name: project.name, slug: project.slug },
    schedule: {
      category: schedule.category,
      manufacturer: schedule.manufacturer,
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
  const body = await request.json()
  const { pricingData, isDraft } = body

  if (!Array.isArray(pricingData)) {
    return NextResponse.json({ error: 'pricingData is required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: project } = await supabase
    .from('projects').select('id').eq('slug', slug).single()
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // The manufacturer name comes from the schedule, never from the request
  // body. Otherwise anyone with the form link could write rows under an
  // arbitrary vendor name.
  const { data: schedule } = await supabase
    .from('schedules').select('manufacturer')
    .eq('project_id', project.id).eq('category', category).single()
  if (!schedule) {
    return NextResponse.json({ error: 'Schedule not found for this category' }, { status: 404 })
  }

  const result = await saveSubmission(supabase, {
    projectSlug: slug,
    category,
    manufacturerName: schedule.manufacturer || 'Manufacturer',
    pricingData,
    isDraft,
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }
  return NextResponse.json({ success: true })
}

import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { saveSubmission } from '@/lib/submissions'

// POST /api/submit — record manufacturer pricing on behalf of the team.
//
// This is the INTERNAL path, used by the dashboard's "Import Manufacturer
// CSV" flow, so it requires a signed-in internal user and runs under their
// session (RLS applies). The manufacturers' own form does not come through
// here — it posts to the public /api/form/[slug]/[category] route instead.
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const body = await request.json()
  const { projectSlug, category, manufacturerName, pricingData, isDraft } = body

  if (!projectSlug || !category || !manufacturerName || !pricingData) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const result = await saveSubmission(supabase, {
    projectSlug, category, manufacturerName, pricingData, isDraft,
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }
  return NextResponse.json({ success: true })
}

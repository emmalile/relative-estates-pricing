import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// POST /api/quotes/apply — link a saved quote to an approval
//
// LINK ONLY. This deliberately does NOT write pricing onto the approvals
// row, because the dashboard's pricing fields do not mean what a naive
// writer would assume:
//
//   • markup_override is NOT a multiplier. On non-doors categories it is an
//     absolute dollars-per-sqft CLIENT price (e.g. 54.60). On doors it is an
//     integer percentage margin (e.g. 15). Writing a multiplier like 1.2
//     would set a stone line's client price to $1.20/sqft, silently.
//   • shipping_ddp is per-sqft and applies pre-markup, non-doors only.
//   • The cost basis is not on approvals at all — the dashboard derives it
//     from the lowest priceSqm across submissions.pricing_data. So writing
//     to approvals cannot make a price appear where no submission exists.
//
// A quote therefore records WHERE a number came from; it does not set the
// number. Pricing stays entered through the dashboard, which owns that math.
// To see the quotes behind an approval: GET /api/quotes?approvalId=xxx
export async function POST(request) {
  const body = await request.json()
  const { quoteId, approvalId } = body

  if (!quoteId || !approvalId) {
    return NextResponse.json({ error: 'quoteId and approvalId are required' }, { status: 400 })
  }

  const { data: quote, error: quoteError } = await supabase
    .from('repository_quotes')
    .select('*')
    .eq('id', quoteId)
    .single()

  if (quoteError || !quote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  const { data: approval, error: approvalError } = await supabase
    .from('approvals')
    .select('id, project_id, category')
    .eq('id', approvalId)
    .single()

  if (approvalError || !approval) {
    return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
  }

  const { data: updatedQuote, error: updateQuoteError } = await supabase
    .from('repository_quotes')
    .update({
      approval_id: approvalId,
      project_id: approval.project_id,
      status: 'applied',
      updated_at: new Date().toISOString(),
    })
    .eq('id', quoteId)
    .select()
    .single()

  if (updateQuoteError) {
    return NextResponse.json({ error: updateQuoteError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, quote: updatedQuote })
}

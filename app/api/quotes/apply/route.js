import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// POST /api/quotes/apply — link a saved quote to an approval
//
// This is how a saved quote (standing in the vendor/product repository)
// turns into what's actually on a project's approval line. It:
//   1. Points the quote at the approval (and the approval's project) and
//      marks it status: 'applied'.
//   2. Copies shipping_ddp / markup_override (and quantity, if the quote
//      has one) onto the approvals row, using the same partial-update
//      behavior as /api/approvals — fields the quote doesn't set are left
//      alone.
//
// The approval keeps driving the numbers your dashboards read; the quote
// keeps the paper trail of which vendor/product produced them. To see what
// quote(s) produced an approval's pricing, GET /api/quotes?approvalId=xxx.
export async function POST(request) {
  const body = await request.json()
  const { quoteId, approvalId, applyToApproval } = body
  const shouldApply = applyToApproval !== false

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
    .select('*')
    .eq('id', approvalId)
    .single()

  if (approvalError || !approval) {
    return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
  }

  if (shouldApply) {
    const { error: updateApprovalError } = await supabase
      .from('approvals')
      .update({
        quantity: quote.quantity || approval.quantity,
        shipping_ddp: quote.shipping_ddp,
        markup_override: quote.markup_override,
        updated_at: new Date().toISOString(),
      })
      .eq('id', approvalId)

    if (updateApprovalError) {
      return NextResponse.json({ error: updateApprovalError.message }, { status: 500 })
    }
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

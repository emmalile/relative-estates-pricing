import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// GET /api/quotes — list saved quotes
// ?projectId=xxx    — quotes tied to (or applied to) this project
// ?approvalId=xxx   — quotes tied to this approval
// ?vendorId=xxx     — quotes for this vendor
// ?productId=xxx    — quotes for this repository product
// ?status=saved|applied|archived
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const approvalId = searchParams.get('approvalId')
  const vendorId = searchParams.get('vendorId')
  const productId = searchParams.get('productId')
  const status = searchParams.get('status')

  let query = supabase
    .from('repository_quotes')
    .select('*')
    .order('created_at', { ascending: false })

  if (projectId) query = query.eq('project_id', projectId)
  if (approvalId) query = query.eq('approval_id', approvalId)
  if (vendorId) query = query.eq('vendor_id', vendorId)
  if (productId) query = query.eq('repository_product_id', productId)
  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// POST /api/quotes — save a quote
//
// Two ways to call this:
//  1. Pass repositoryProductId — pulls the vendor + product name and current
//     unit_cost from the catalog and snapshots them onto the quote. Pass
//     unitCost too if the negotiated price differs from the catalog price
//     (the snapshot always wins over the catalog going forward).
//  2. Skip repositoryProductId and pass vendorName/productName/unitCost
//     directly — for a one-off quote that isn't in the repository yet.
//
// A quote is a RECORD of what a vendor charges. It does not drive what the
// client is shown — the dashboard owns that math, and its cost basis comes
// from submissions.pricing_data, not from here. client_price below is a
// saved reference figure only.
export async function POST(request) {
  const body = await request.json()
  const {
    repositoryProductId,
    vendorId: vendorIdInput,
    vendorName,
    productName,
    unitCost: unitCostInput,
    unit: unitInput,
    approvalId,
    projectId: projectIdInput,
    quantity,
    shippingDdp,
    markupOverride,
    notes,
  } = body

  let vendorId = vendorIdInput || null
  let vendorNameSnapshot = vendorName || null
  let productNameSnapshot = productName || null
  let unitCost = unitCostInput
  let unit = unitInput || 'sqft'

  if (repositoryProductId) {
    const { data: product, error: productError } = await supabase
      .from('repository_products')
      .select('*, vendor:vendors(id, name)')
      .eq('id', repositoryProductId)
      .single()

    if (productError || !product) {
      return NextResponse.json({ error: 'Repository product not found' }, { status: 404 })
    }

    vendorId = product.vendor_id
    vendorNameSnapshot = product.vendor?.name || vendorNameSnapshot
    productNameSnapshot = product.name
    unit = unitInput || product.unit
    if (unitCost === undefined) unitCost = product.unit_cost
  }

  if (!vendorNameSnapshot || !productNameSnapshot || unitCost === undefined) {
    return NextResponse.json(
      { error: 'repositoryProductId, or vendorName + productName + unitCost, are required' },
      { status: 400 }
    )
  }

  let projectId = projectIdInput || null
  if (approvalId && !projectId) {
    const { data: approval } = await supabase
      .from('approvals')
      .select('project_id')
      .eq('id', approvalId)
      .single()
    projectId = approval?.project_id || null
  }

  const shipping = shippingDdp || 0
  const markup = markupOverride !== undefined && markupOverride !== null ? markupOverride : 1.2
  const clientPrice = (parseFloat(unitCost) + parseFloat(shipping)) * parseFloat(markup)

  const { data, error } = await supabase
    .from('repository_quotes')
    .insert({
      repository_product_id: repositoryProductId || null,
      vendor_id: vendorId,
      approval_id: approvalId || null,
      project_id: projectId,
      vendor_name_snapshot: vendorNameSnapshot,
      product_name_snapshot: productNameSnapshot,
      unit_cost: unitCost,
      unit,
      quantity: quantity || 0,
      shipping_ddp: shipping,
      markup_override: markupOverride ?? null,
      client_price: clientPrice,
      status: approvalId ? 'applied' : 'saved',
      notes: notes || '',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

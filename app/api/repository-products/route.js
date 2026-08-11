import { requireInternal } from '@/lib/auth'
import { NextResponse } from 'next/server'

// GET /api/repository-products — list catalog products (excludes hidden by default)
// ?vendorId=xxx          — only products from this vendor
// ?category=stone        — only products in this category
// ?include_archived=true — include hidden products
// ?archived_only=true    — return ONLY hidden products
//
// Each row is embedded with its vendor (id, name, deleted_at) so the picker
// UI doesn't need a second round trip just to show who supplies it.
export async function GET(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { searchParams } = new URL(request.url)
  const vendorId = searchParams.get('vendorId')
  const category = searchParams.get('category')
  const includeArchived = searchParams.get('include_archived') === 'true'
  const archivedOnly = searchParams.get('archived_only') === 'true'

  let query = supabase
    .from('repository_products')
    .select('*, vendor:vendors(id, name, deleted_at)')
    .order('name', { ascending: true })

  if (vendorId) query = query.eq('vendor_id', vendorId)
  if (category) query = query.eq('category', category)

  if (archivedOnly) {
    query = query.not('deleted_at', 'is', null)
  } else if (!includeArchived) {
    query = query.is('deleted_at', null)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// POST /api/repository-products — add a product to a vendor's catalog
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const body = await request.json()
  const { vendorId, category, name, sku, description, unit, unitCost, specs, imageUrl } = body

  if (!vendorId || !category || !name) {
    return NextResponse.json({ error: 'vendorId, category, and name are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('repository_products')
    .insert({
      vendor_id: vendorId,
      category,
      name,
      sku: sku || null,
      description: description || null,
      unit: unit || 'sqft',
      unit_cost: unitCost || 0,
      specs: specs || {},
      image_url: imageUrl || null,
    })
    .select('*, vendor:vendors(id, name, deleted_at)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

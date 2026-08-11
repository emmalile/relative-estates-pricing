import { requireInternal } from '@/lib/auth'
import { NextResponse } from 'next/server'

// POST /api/repository-products/update — partial update of a catalog product
// Same merge behavior as /api/vendors/update and /api/approvals.
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const body = await request.json()
  const { id, vendorId, category, name, sku, description, unit, unitCost, specs, imageUrl } = body

  if (!id) {
    return NextResponse.json({ error: 'Product id is required' }, { status: 400 })
  }

  const { data: existing, error: fetchError } = await supabase
    .from('repository_products')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  const row = {
    vendor_id: vendorId !== undefined ? vendorId : existing.vendor_id,
    category: category !== undefined ? category : existing.category,
    name: name !== undefined ? name : existing.name,
    sku: sku !== undefined ? sku : existing.sku,
    description: description !== undefined ? description : existing.description,
    unit: unit !== undefined ? unit : existing.unit,
    unit_cost: unitCost !== undefined ? unitCost : existing.unit_cost,
    specs: specs !== undefined ? specs : existing.specs,
    image_url: imageUrl !== undefined ? imageUrl : existing.image_url,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('repository_products')
    .update(row)
    .eq('id', id)
    .select('*, vendor:vendors(id, name, deleted_at)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

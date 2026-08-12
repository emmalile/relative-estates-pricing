import { requireInternal } from '@/lib/auth'
import { NextResponse } from 'next/server'

// POST /api/repository-products/restore?id=xxx — unhide a catalog product
// Clears the deleted_at timestamp so the product reappears in active lists.
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { searchParams } = new URL(request.url)
  const productId = searchParams.get('id')

  if (!productId) {
    return NextResponse.json({ error: 'Product ID is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('repository_products')
    .update({ deleted_at: null })
    .eq('id', productId)
    .select('*, vendor:vendors(id, name, deleted_at)')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, product: data })
}

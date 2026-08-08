import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// DELETE /api/repository-products/delete?id=xxx — hide a catalog product
// Sets deleted_at; does NOT remove any data and has no permanent option.
// Existing repository_quotes snapshot their own vendor/product name and
// cost at save time, so hiding a product never changes past quote history.
export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const productId = searchParams.get('id')

  if (!productId) {
    return NextResponse.json({ error: 'Product ID is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('repository_products')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', productId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, action: 'hidden' })
}

import { requireInternal } from '@/lib/auth'
import { NextResponse } from 'next/server'

// POST /api/vendors/restore?id=xxx — reactivate a deactivated vendor
// Clears the deleted_at timestamp so the vendor reappears in active lists.
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { searchParams } = new URL(request.url)
  const vendorId = searchParams.get('id')

  if (!vendorId) {
    return NextResponse.json({ error: 'Vendor ID is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('vendors')
    .update({ deleted_at: null })
    .eq('id', vendorId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, vendor: data })
}

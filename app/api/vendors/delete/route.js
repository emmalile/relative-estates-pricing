import { requireInternal } from '@/lib/auth'
import { NextResponse } from 'next/server'

// DELETE /api/vendors/delete?id=xxx — deactivate (hide) a vendor
// Sets deleted_at; does NOT remove any data and has no permanent option.
// Vendors are referenced by repository_products and by historical
// repository_quotes snapshots, so hard-deleting one would either break
// the products FK or silently corrupt past pricing history — hide-not-delete
// is the only supported path here, unlike /api/projects/delete.
export async function DELETE(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { searchParams } = new URL(request.url)
  const vendorId = searchParams.get('id')

  if (!vendorId) {
    return NextResponse.json({ error: 'Vendor ID is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('vendors')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', vendorId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, action: 'deactivated' })
}

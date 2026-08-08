import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// POST /api/vendors/update — partial update of a vendor
//
// Same merge behavior as /api/approvals: any field omitted from the request
// body falls back to whatever is already stored, so a caller updating just
// one field (e.g. a phone number) never has to resend the whole vendor.
export async function POST(request) {
  const body = await request.json()
  const { id, name, categories, contactName, contactEmail, contactPhone, website, notes } = body

  if (!id) {
    return NextResponse.json({ error: 'Vendor id is required' }, { status: 400 })
  }

  const { data: existing, error: fetchError } = await supabase
    .from('vendors')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  }

  const row = {
    name: name !== undefined ? name : existing.name,
    categories: categories !== undefined ? categories : existing.categories,
    contact_name: contactName !== undefined ? contactName : existing.contact_name,
    contact_email: contactEmail !== undefined ? contactEmail : existing.contact_email,
    contact_phone: contactPhone !== undefined ? contactPhone : existing.contact_phone,
    website: website !== undefined ? website : existing.website,
    notes: notes !== undefined ? notes : existing.notes,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('vendors')
    .update(row)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

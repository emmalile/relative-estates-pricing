import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// GET /api/vendors — list vendors (excludes hidden/deactivated by default)
// ?include_archived=true — include deactivated vendors
// ?archived_only=true   — return ONLY deactivated vendors
// ?category=stone       — only vendors whose categories[] contains this value
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const includeArchived = searchParams.get('include_archived') === 'true'
  const archivedOnly = searchParams.get('archived_only') === 'true'
  const category = searchParams.get('category')

  let query = supabase
    .from('vendors')
    .select('*')
    .order('name', { ascending: true })

  if (archivedOnly) {
    query = query.not('deleted_at', 'is', null)
  } else if (!includeArchived) {
    query = query.is('deleted_at', null)
  }

  if (category) {
    query = query.contains('categories', [category])
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// POST /api/vendors — create a new vendor
export async function POST(request) {
  const body = await request.json()
  const { name, categories, contactName, contactEmail, contactPhone, website, notes } = body

  if (!name) {
    return NextResponse.json({ error: 'Vendor name is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('vendors')
    .insert({
      name,
      categories: categories || [],
      contact_name: contactName || null,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      website: website || null,
      notes: notes || '',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

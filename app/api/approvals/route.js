import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

// GET /api/approvals?projectId=xxx&category=stone
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const category = searchParams.get('category')

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  let query = supabase
    .from('approvals')
    .select('*')
    .eq('project_id', projectId)

  if (category) query = query.eq('category', category)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// POST /api/approvals — upsert a single approval
export async function POST(request) {
  const body = await request.json()
  const { projectId, category, itemKey, status, quantity, notes } = body

  if (!projectId || !category || !itemKey) {
    return NextResponse.json({ error: 'projectId, category, and itemKey are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('approvals')
    .upsert(
      {
        project_id: projectId,
        category,
        item_key: itemKey,
        status: status || 'pending',
        quantity: quantity || 0,
        notes: notes || '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,category,item_key' }
    )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

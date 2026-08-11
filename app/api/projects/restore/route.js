import { requireAdmin } from '@/lib/auth'
import { NextResponse } from 'next/server'

// POST /api/projects/restore?id=xxx — restore an archived project
// Clears the deleted_at timestamp so the project reappears in active lists.
export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('id')

  if (!projectId) {
    return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('projects')
    .update({ deleted_at: null })
    .eq('id', projectId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, project: data })
}

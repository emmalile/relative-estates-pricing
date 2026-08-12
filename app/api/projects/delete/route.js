import { requireAdmin } from '@/lib/auth'
import { NextResponse } from 'next/server'

// DELETE /api/projects/delete?id=xxx — soft-delete (archive) a project
// Sets deleted_at timestamp; does NOT remove any data.
// To permanently delete, use ?permanent=true (irreversible).
export async function DELETE(request) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('id')
  const permanent = searchParams.get('permanent') === 'true'

  if (!projectId) {
    return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
  }

  if (permanent) {
    // Hard delete — remove all related data then the project itself
    await supabase.from('approvals').delete().eq('project_id', projectId)
    await supabase.from('submissions').delete().eq('project_id', projectId)
    await supabase.from('schedules').delete().eq('project_id', projectId)

    const { error } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, action: 'permanently_deleted' })
  }

  // Soft delete — just set deleted_at
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', projectId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, action: 'archived' })
}

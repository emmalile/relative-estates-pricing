import { supabase } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function DELETE(request) {
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('id')

  if (!projectId) {
    return NextResponse.json({ error: 'Project ID is required' }, { status: 400 })
  }

  // Delete all related data first, then the project
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

  return NextResponse.json({ success: true })
}

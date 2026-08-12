import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncProjectFiles } from '@/lib/dropboxSync'

// PUT /api/projects/[slug]/folder — point a project at a Dropbox folder.
//
// Admin only: this decides which folder's contents the whole internal team
// sees against a project. Changing it clears the delta cursor and re-lists
// from scratch, since a cursor is only meaningful for the path that produced it.
export async function PUT(request, { params }) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { user } = auth

  const { dropboxPath } = await request.json()
  if (!dropboxPath || typeof dropboxPath !== 'string' || !dropboxPath.startsWith('/')) {
    return NextResponse.json(
      { error: 'A Dropbox folder path is required, starting with /' },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const { data: project } = await admin
    .from('projects').select('id').eq('slug', params.slug).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { error } = await admin.from('project_folders').upsert({
    project_id: project.id,
    dropbox_path: dropboxPath,
    cursor: null,
    last_error: null,
    created_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const result = await syncProjectFiles(project.id, { full: true })
  if (result.error) {
    // The mapping is saved; the sync can be retried from the Files page.
    return NextResponse.json({ success: true, syncError: result.error })
  }
  return NextResponse.json({ success: true, ...result })
}

// DELETE /api/projects/[slug]/folder — unlink, and drop the cached listing.
export async function DELETE(request, { params }) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response

  const admin = createAdminClient()
  const { data: project } = await admin
    .from('projects').select('id').eq('slug', params.slug).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  await admin.from('project_files').delete().eq('project_id', project.id)
  await admin.from('project_folders').delete().eq('project_id', project.id)

  return NextResponse.json({ success: true })
}

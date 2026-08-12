import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject } from '@/lib/projectAccess'
import { getTemporaryLink } from '@/lib/dropbox'

// GET /api/projects/[slug]/files/[id]/link — a short-lived link to open a file.
//
// Minted per request and valid for about four hours, so nothing durable is
// handed out and file bytes never pass through this app. The file is looked
// up by its row id and checked against the project in the URL, so a file id
// from one project cannot be opened via another project's route.
export async function GET(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { user } = auth

  const admin = createAdminClient()
  const { data: project } = await admin
    .from('projects').select('id').eq('slug', params.slug).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!(await canAccessProject(user, project.id))) {
    return NextResponse.json({ error: 'Not authorized for this project' }, { status: 403 })
  }

  const { data: file } = await admin
    .from('project_files')
    .select('path_display, name')
    .eq('id', params.id)
    .eq('project_id', project.id)
    .maybeSingle()

  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  try {
    const link = await getTemporaryLink(file.path_display)
    return NextResponse.json({ url: link, name: file.name })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 })
  }
}

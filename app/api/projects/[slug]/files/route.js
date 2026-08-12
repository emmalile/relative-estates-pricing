import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject } from '@/lib/projectAccess'
import { syncProjectFiles } from '@/lib/dropboxSync'

async function resolveProject(slug) {
  const admin = createAdminClient()
  const { data } = await admin.from('projects').select('id, name, slug').eq('slug', slug).single()
  return data || null
}

// GET /api/projects/[slug]/files — cached file list plus folder mapping.
//
// Internal only. Files are not client-facing, so this sits behind
// requireInternal in addition to the per-project membership check.
export async function GET(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { user } = auth

  const project = await resolveProject(params.slug)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!(await canAccessProject(user, project.id))) {
    return NextResponse.json({ error: 'Not authorized for this project' }, { status: 403 })
  }

  const admin = createAdminClient()
  const [{ data: folder }, { data: files }] = await Promise.all([
    admin.from('project_folders').select('*').eq('project_id', project.id).maybeSingle(),
    admin.from('project_files').select('*').eq('project_id', project.id).order('name'),
  ])

  return NextResponse.json({
    project: { id: project.id, name: project.name, slug: project.slug },
    folder: folder
      ? {
          path: folder.dropbox_path,
          lastSyncedAt: folder.last_synced_at,
          lastError: folder.last_error,
        }
      : null,
    files: (files || []).map(f => ({
      id: f.id,
      name: f.name,
      ext: f.ext,
      path: f.path_display,
      sizeBytes: f.size_bytes,
      modified: f.server_modified || f.client_modified,
    })),
  })
}

// POST /api/projects/[slug]/files — run a sync for this project.
export async function POST(request, { params }) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { user } = auth

  const project = await resolveProject(params.slug)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!(await canAccessProject(user, project.id))) {
    return NextResponse.json({ error: 'Not authorized for this project' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const result = await syncProjectFiles(project.id, { full: !!body.full })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 })
  }
  return NextResponse.json(result)
}

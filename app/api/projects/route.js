import { requireAdmin, requireInternal } from '@/lib/auth'
import { ensureVendor } from '@/lib/repository'
import { slugify } from '@/lib/utils'
import { NextResponse } from 'next/server'

// GET /api/projects — list projects (excludes archived by default)
// ?include_archived=true — include soft-deleted projects
// ?archived_only=true   — return ONLY archived projects
export async function GET(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { supabase } = auth

  const { searchParams } = new URL(request.url)
  const includeArchived = searchParams.get('include_archived') === 'true'
  const archivedOnly = searchParams.get('archived_only') === 'true'

  let query = supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })

  if (archivedOnly) {
    query = query.not('deleted_at', 'is', null)
  } else if (!includeArchived) {
    query = query.is('deleted_at', null)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// POST /api/projects — create a new project
export async function POST(request) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const { supabase } = auth

  const body = await request.json()
  const { name, client, categories, schedules } = body

  if (!name) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
  }

  const slug = slugify(name)

  // Create the project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ name, client, slug, categories })
    .select()
    .single()

  if (projectError) {
    // Handle duplicate slug
    if (projectError.code === '23505') {
      return NextResponse.json(
        { error: 'A project with this name already exists. Try adding a location or year.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: projectError.message }, { status: 500 })
  }

  // Create schedule rows for each category that has items
  if (schedules && schedules.length > 0) {
    const scheduleRows = schedules.map(s => ({
      project_id: project.id,
      category: s.category,
      manufacturer: s.manufacturer,
      items: s.items,
    }))

    const { error: scheduleError } = await supabase
      .from('schedules')
      .insert(scheduleRows)

    if (scheduleError) {
      return NextResponse.json({ error: scheduleError.message }, { status: 500 })
    }

    // Naming a manufacturer on a schedule is how most vendors first enter the
    // system, so that is where the vendor list should learn about them —
    // rather than waiting for someone to add the same name a second time.
    for (const s of scheduleRows) {
      try {
        await ensureVendor(supabase, { name: s.manufacturer, category: s.category })
      } catch (e) {
        console.warn('[vendors] could not record schedule manufacturer:', e.message)
      }
    }
  }

  return NextResponse.json(project, { status: 201 })
}

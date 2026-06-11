import { supabase } from '@/lib/supabase'
import { slugify } from '@/lib/utils'
import { NextResponse } from 'next/server'

export async function GET() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function POST(request) {
  const body = await request.json()
  const { name, client, categories, schedules } = body

  if (!name) {
    return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
  }

  const slug = slugify(name)

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({ name, client, slug, categories })
    .select()
    .single()

  if (projectError) {
    if (projectError.code === '23505') {
      return NextResponse.json(
        { error: 'A project with this name already exists. Try adding a location or year.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: projectError.message }, { status: 500 })
  }

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
  }

  return NextResponse.json(project, { status: 201 })
}
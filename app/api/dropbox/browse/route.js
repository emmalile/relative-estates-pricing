import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth'
import { listFolders } from '@/lib/dropbox'

// GET /api/dropbox/browse?path=/Projects — folders at a path, for the picker.
//
// Folders only, non-recursive: this exists to let an admin navigate to the
// right folder, not to enumerate the whole Dropbox.
export async function GET(request) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response

  const { searchParams } = new URL(request.url)
  const path = searchParams.get('path') || ''

  try {
    const folders = await listFolders(path)
    return NextResponse.json({
      path,
      folders: folders
        .map(f => ({ name: f.name, path: f.path_display }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status === 401 ? 401 : 500 })
  }
}

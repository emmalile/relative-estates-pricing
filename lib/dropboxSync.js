import { createAdminClient } from './supabase/admin'
import { listFolderStart, listFolderContinue } from './dropbox'

// Walks a project's Dropbox folder and caches file metadata.
//
// Uses Dropbox's cursor protocol: the first sync lists everything and stores
// a cursor; later syncs ask only for what changed since. That keeps repeat
// syncs cheap on folders with thousands of files.
//
// Only metadata is stored — name, path, size, revision, timestamps. File
// content stays in Dropbox and is reached through short-lived temporary
// links, so nothing here duplicates or stales.

// Extensions worth surfacing. Dropbox folders collect a lot of incidental
// files; this keeps the list to things someone would actually open.
const KEEP_EXTENSIONS = new Set([
  'pdf', 'csv', 'xlsx', 'xls', 'doc', 'docx', 'ppt', 'pptx',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic',
  'dwg', 'dxf', 'rvt', 'skp', 'txt', 'md', 'zip',
])

function extensionOf(name) {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : null
}

function shouldKeep(entry) {
  if (entry['.tag'] !== 'file') return false
  // Dropbox and macOS scatter these through shared folders.
  if (entry.name.startsWith('.') || entry.name === 'Icon\r') return false
  const ext = extensionOf(entry.name)
  return ext ? KEEP_EXTENSIONS.has(ext) : false
}

function toRow(projectId, entry) {
  return {
    project_id: projectId,
    dropbox_id: entry.id,
    path_lower: entry.path_lower,
    path_display: entry.path_display,
    name: entry.name,
    ext: extensionOf(entry.name),
    size_bytes: entry.size ?? null,
    rev: entry.rev ?? null,
    client_modified: entry.client_modified ?? null,
    server_modified: entry.server_modified ?? null,
    updated_at: new Date().toISOString(),
  }
}

// Runs a sync for one project. Pass full=true to ignore the stored cursor and
// re-list from scratch (used when the mapped folder changes).
export async function syncProjectFiles(projectId, { full = false } = {}) {
  const admin = createAdminClient()

  const { data: mapping } = await admin
    .from('project_folders').select('*').eq('project_id', projectId).maybeSingle()

  if (!mapping) {
    return { error: 'This project has no Dropbox folder yet.', status: 400 }
  }

  const upserts = []
  const deletedPaths = []
  let cursor = full ? null : mapping.cursor
  let page

  try {
    page = cursor
      ? await listFolderContinue(cursor)
      : await listFolderStart(mapping.dropbox_path)

    while (true) {
      for (const entry of page.entries || []) {
        if (entry['.tag'] === 'deleted') {
          deletedPaths.push(entry.path_lower)
        } else if (shouldKeep(entry)) {
          upserts.push(toRow(projectId, entry))
        }
      }
      if (!page.has_more) break
      page = await listFolderContinue(page.cursor)
    }
  } catch (e) {
    // A stale or invalidated cursor is recoverable — re-list once from scratch.
    const resettable = /reset|invalid_cursor/i.test(e.message || '')
    if (!full && resettable) {
      return syncProjectFiles(projectId, { full: true })
    }
    await admin.from('project_folders')
      .update({ last_error: e.message, updated_at: new Date().toISOString() })
      .eq('project_id', projectId)
    return { error: e.message, status: 502 }
  }

  if (full) {
    // A full re-list is authoritative — drop anything not seen this pass.
    await admin.from('project_files').delete().eq('project_id', projectId)
  }

  if (upserts.length) {
    const { error } = await admin
      .from('project_files')
      .upsert(upserts, { onConflict: 'project_id,dropbox_id' })
    if (error) return { error: error.message, status: 500 }
  }

  if (deletedPaths.length) {
    await admin.from('project_files')
      .delete()
      .eq('project_id', projectId)
      .in('path_lower', deletedPaths)
  }

  await admin.from('project_folders').update({
    cursor: page.cursor,
    last_synced_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('project_id', projectId)

  const { count } = await admin
    .from('project_files')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)

  return {
    success: true,
    added: upserts.length,
    removed: deletedPaths.length,
    total: count ?? null,
  }
}

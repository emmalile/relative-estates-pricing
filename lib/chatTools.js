import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema'
import { buildSnapshot } from './projectContext'

// The tools chat can use.
//
// Every one is read-only, and every one is bound to a single project id that
// the route resolved from the signed-in user's access — the model is never
// given a project to choose. It cannot reach another project's pricing by
// asking for it, and it cannot write anything.
//
// Documents are indexed here but not read: this is chat over project data.
// File contents reach a model through extraction, which has a review step.

export function buildChatTools({ admin, projectId }) {
  const used = []

  const project_data = betaTool({
    name: 'project_data',
    description:
      'The project\'s line items with their quantities, costs, client prices and ' +
      'approval status, grouped by category. This is the authoritative source for ' +
      'anything about what the project is buying, how much of it, and what it costs. ' +
      'Call it before answering any question about quantities, prices or totals. ' +
      'Omit category to get everything; pass one to get just that category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category id, e.g. "stone" or "doors". Omit for all.',
        },
      },
      additionalProperties: false,
    },
    run: async ({ category }) => {
      used.push(category ? `project_data(${category})` : 'project_data')

      const [{ data: project }, { data: schedules }, { data: submissions }, { data: approvals }] =
        await Promise.all([
          admin.from('projects').select('id, name, client, slug, categories').eq('id', projectId).single(),
          admin.from('schedules').select('*').eq('project_id', projectId),
          admin.from('submissions').select('*').eq('project_id', projectId),
          admin.from('approvals').select('*').eq('project_id', projectId),
        ])

      if (!project) return 'That project could not be loaded.'

      const snapshot = buildSnapshot({ project, schedules, submissions, approvals })
      if (category) {
        const one = snapshot.categories.find(c => c.category === category)
        if (!one) {
          return `No ${category} schedule exists on this project. Categories present: ` +
            (snapshot.categories.map(c => c.category).join(', ') || 'none')
        }
        return JSON.stringify({ project: snapshot.project, categories: [one] })
      }
      return JSON.stringify(snapshot)
    },
  })

  const list_documents = betaTool({
    name: 'list_documents',
    description:
      "The project's Dropbox files — names, types, sizes and dates. This is an " +
      'index only; it does not read what is inside them. Use it to say what ' +
      'documents exist, or to point at the file someone should look at.',
    inputSchema: {
      type: 'object',
      properties: {
        nameContains: {
          type: 'string',
          description: 'Optional case-insensitive filter on the file name.',
        },
      },
      additionalProperties: false,
    },
    run: async ({ nameContains }) => {
      used.push(nameContains ? `list_documents(${nameContains})` : 'list_documents')

      let query = admin
        .from('project_files')
        .select('name, ext, size_bytes, server_modified, path_display')
        .eq('project_id', projectId)
        .order('server_modified', { ascending: false })
        .limit(300)
      if (nameContains) query = query.ilike('name', `%${nameContains}%`)

      const { data } = await query
      if (!data?.length) {
        return nameContains
          ? `No files match "${nameContains}".`
          : 'No files are indexed for this project. A Dropbox folder may not be linked yet.'
      }
      return JSON.stringify(data.map(f => ({
        name: f.name,
        type: f.ext,
        sizeMB: f.size_bytes ? +(f.size_bytes / 1024 / 1024).toFixed(2) : null,
        modified: f.server_modified,
        path: f.path_display,
      })))
    },
  })

  const extractions = betaTool({
    name: 'extraction_history',
    description:
      'Documents that have been read into line items, what came of each, and any ' +
      'concerns raised while reading. Use it to answer where a line item came from, ' +
      'or whether a document has been processed yet.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      used.push('extraction_history')
      const { data } = await admin
        .from('extractions')
        .select('category, source_name, status, notes, error, items, created_at, applied_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!data?.length) return 'No documents have been read into line items yet.'
      return JSON.stringify(data.map(x => ({
        document: x.source_name,
        category: x.category,
        status: x.status,
        proposedItems: Array.isArray(x.items) ? x.items.length : 0,
        approvedItems: Array.isArray(x.items) ? x.items.filter(i => i.status === 'approved').length : 0,
        concernsRaised: x.notes || null,
        error: x.error || null,
        readAt: x.created_at,
        appliedAt: x.applied_at,
      })))
    },
  })

  return { tools: [project_data, list_documents, extractions], used }
}

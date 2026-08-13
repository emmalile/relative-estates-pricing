import { normalizePrice, pricingFor } from './pricing'

// Keeping the vendor list and the product repository fed from what actually
// happens, rather than from someone remembering to type it in twice.
//
// Two moments feed them:
//   • a manufacturer is named on a schedule or submits pricing → vendor
//   • a line item is approved → that item, at each vendor's quoted price
//
// Everything here is a side effect of an action that has already succeeded.
// None of it may fail that action: a vendor list that missed a name is a
// nuisance, a submission that was refused because bookkeeping failed is a
// lost quote. Callers wrap these in try/catch for that reason.

// The price a manufacturer quoted, in the unit they quoted it in.
//
// normalizePrice covers the categories priced by area, unit or linear foot.
// Doors are quoted per door on their own field, and fall back to the cheapest
// design option when no single price is given — the same rule the dashboard
// uses to decide what a door costs.
export function quotedPrice(categoryId, data) {
  if (!data) return null

  if (categoryId === 'doors') {
    let best = parseFloat(data.unitPrice || 0) || null
    ;(data.designOptions || []).forEach(opt => {
      const p = parseFloat(opt.unitPrice || 0)
      if (p > 0 && (best === null || p < best)) best = p
    })
    return best ? { price: best, unit: 'unit' } : null
  }

  return normalizePrice(data)
}

// ilike treats these as wildcards, so a vendor called "50% Co_" would match
// names it should not.
function escapeLike(s) {
  return s.replace(/[\\%_]/g, c => `\\${c}`)
}

// Finds the vendor with this name, or creates it. Matching is case- and
// whitespace-insensitive, because "Vendor #1" arriving from a schedule and
// " vendor #1" from a form are the same company.
//
// A vendor that has been archived is reused rather than un-archived. Someone
// archived it deliberately, and a new quote is not a reason to overrule that.
export async function ensureVendor(admin, { name, category }) {
  const clean = String(name || '').trim()
  if (!clean) return null

  const { data: existing } = await admin
    .from('vendors')
    .select('id, name, categories')
    .ilike('name', escapeLike(clean))
    .maybeSingle()

  if (existing) {
    // Keep the category list honest as a vendor starts quoting new trades.
    const categories = Array.isArray(existing.categories) ? existing.categories : []
    if (category && !categories.includes(category)) {
      await admin
        .from('vendors')
        .update({ categories: [...categories, category], updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return existing
  }

  const { data, error } = await admin
    .from('vendors')
    .insert({
      name: clean,
      categories: category ? [category] : [],
      auto_added: true,
      notes: 'Added automatically the first time this manufacturer appeared on a project.',
    })
    .select('id, name, categories')
    .single()

  // A race with another request that inserted the same name first: the unique
  // index rejects the second, and the winner is the row we wanted anyway.
  if (error) {
    const { data: raced } = await admin
      .from('vendors').select('id, name, categories').ilike('name', escapeLike(clean)).maybeSingle()
    return raced || null
  }
  return data
}

// How a schedule item is described in the catalog. The identifying fields
// differ by category — stone is a name, finish and cut; a door is a number
// and a description — so the item's own fields are used rather than a shape
// assumed to be shared.
function describeItem(categoryId, item) {
  if (categoryId === 'doors') {
    return {
      name: item.description || item.type || `Door ${item.no || ''}`.trim(),
      sku: item.no || null,
      description: [item.type, item.location].filter(Boolean).join(' — ') || null,
    }
  }
  return {
    name: item.name || item.key,
    sku: null,
    description: [item.finish, item.cut].filter(Boolean).join(' — ') || null,
  }
}

// Adds an approved line item to the repository, once per vendor that quoted
// it, each at that vendor's own price.
//
// Every quote is recorded, not only the cheapest: the value of a repository
// is knowing what each supplier charges for a thing, and the losing quote is
// half of that picture.
//
// Re-approving updates in place rather than duplicating, keyed on the vendor,
// category and item. A later quote replaces an earlier one; the project and
// date it came from travel with it so the figure can be traced.
export async function recordApprovedProduct(admin, { projectId, category, itemKey }) {
  const [{ data: schedule }, { data: submissions }] = await Promise.all([
    admin.from('schedules').select('items').eq('project_id', projectId).eq('category', category).maybeSingle(),
    admin.from('submissions').select('*').eq('project_id', projectId).eq('category', category),
  ])

  const items = schedule?.items || []
  const index = items.findIndex(i => i.key === itemKey)
  if (index === -1) return { added: 0, reason: 'item not on the schedule' }
  const item = items[index]

  // Latest submission per manufacturer, matching how the dashboard decides
  // which of a vendor's quotes counts.
  const latest = {}
  ;(submissions || []).forEach(s => {
    const k = String(s.manufacturer_name || '').trim().toLowerCase()
    if (!k) return
    if (!latest[k] || new Date(s.submitted_at) > new Date(latest[k].submitted_at)) latest[k] = s
  })

  const described = describeItem(category, item)
  let added = 0

  for (const submission of Object.values(latest)) {
    const priced = quotedPrice(category, pricingFor(submission, item, index))
    if (!priced) continue

    const vendor = await ensureVendor(admin, { name: submission.manufacturer_name, category })
    if (!vendor) continue

    const { error } = await admin.from('repository_products').upsert({
      vendor_id: vendor.id,
      category,
      ...described,
      unit: priced.unit,
      unit_cost: priced.price,
      // The item's own fields, so what identifies it is not flattened away.
      specs: item,
      source_project_id: projectId,
      source_item_key: itemKey,
      quoted_at: submission.submitted_at,
      auto_added: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'vendor_id,category,source_item_key' })

    if (!error) added++
  }

  return { added }
}

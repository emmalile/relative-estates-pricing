import { getCategory } from './categories'

// ═══════════════════════════════════════════════════════
// MANUFACTURER PRICING CSV
// ═══════════════════════════════════════════════════════
// One builder for the CSV a manufacturer gets, used by both places it is
// produced: the Export CSV button on the form, and the copy emailed back
// on submission. Sharing it is the point — a receipt that disagreed with
// the download would be worse than no receipt at all.
//
// Takes the same merged rows the form submits (schedule item fields and
// the manufacturer's pricing fields on one object).
//
// Calculated fields are deliberately excluded. The per-sqft conversion is
// ours to work in, not something the manufacturer quoted, and it is not
// shown on their form either. Room locations are excluded for the same
// reason they were taken off the form: the manufacturer prices the
// material, not the rooms it lands in.
// ═══════════════════════════════════════════════════════

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

// Only the fields the manufacturer is actually asked for. The doors form
// collects a price per design option rather than the category's generic
// pricing fields, so those are handled separately below — and `margin` in
// particular is ours, and has no business on a vendor's copy.
export function pricingCsvColumns(categoryId) {
  const category = getCategory(categoryId)
  if (!category) return []
  if (categoryId === 'doors') return category.formFields.filter(f => f.id === 'notes')
  return category.formFields.filter(f => f.type !== 'calculated' && f.type !== 'images')
}

export function buildPricingCsv(categoryId, rows) {
  const category = getCategory(categoryId)
  if (!category) return ''

  const priceFields = pricingCsvColumns(categoryId)
  const isDoors = categoryId === 'doors'

  // Doors are quoted per design option, so the widest row decides how many
  // price columns there are.
  const maxDesigns = isDoors
    ? Math.max(0, ...(rows || []).map(r => (r.designOptions || []).length))
    : 0

  const headers = isDoors
    ? [
        'Door No', 'Location', 'Description', 'Door Type',
        ...Array.from({ length: maxDesigns }, (_, i) => `Design Option ${i + 1} — Unit Price (USD)`),
        ...priceFields.map(f => f.label),
      ]
    : ['Material', 'Finish / Detail', ...priceFields.map(f => f.label)]

  const lines = [headers.map(csvCell).join(',')]

  ;(rows || []).forEach(row => {
    const values = isDoors
      ? [
          row.no, row.location, row.description, row.type,
          ...Array.from({ length: maxDesigns }, (_, i) => (row.designOptions || [])[i]?.unitPrice ?? ''),
        ]
      : [
          row.name,
          [row.finish, row.cut, row.style, row.material].filter(Boolean).join(' / '),
        ]
    lines.push([...values, ...priceFields.map(f => row[f.id] ?? '')].map(csvCell).join(','))
  })

  return lines.join('\n')
}

export function pricingCsvFilename(manufacturerName, categoryId) {
  const safe = (manufacturerName || 'pricing').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `${safe}-${categoryId}-pricing.csv`
}

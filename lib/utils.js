// ─────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────

// Convert a project name to a URL-safe slug
// "Residence at Oak Hill" → "residence-at-oak-hill"
export function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// Format a number as USD currency
export function formatCurrency(amount) {
  if (!amount || isNaN(amount)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

// Convert price per sqm to price per sqft
export function sqmToSqft(priceSqm) {
  if (!priceSqm) return null
  return parseFloat((priceSqm / 10.7639).toFixed(2))
}

// Format a date nicely
export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

// Format a date as a short relative time string, e.g. "2h ago", "1d ago"
export function formatRelativeTime(dateStr) {
  if (!dateStr) return '—'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  const diffMonth = Math.floor(diffDay / 30)
  if (diffMonth < 12) return `${diffMonth}mo ago`
  const diffYear = Math.floor(diffMonth / 12)
  return `${diffYear}y ago`
}

// Get the lowest price from multiple manufacturer submissions
export function getLowestPrice(submissions, itemIndex) {
  let lowest = null
  submissions.forEach(sub => {
    const item = sub.pricing_data?.[itemIndex]
    if (!item) return
    const price = parseFloat(item.priceSqm || item.pricePerUnit || item.pricePerLinFt || 0)
    if (price > 0 && (!lowest || price < lowest.price)) {
      lowest = { price, manufacturer: sub.manufacturer_name, data: item }
    }
  })
  return lowest
}

// Build the unique item key from an item object
export function buildItemKey(item, keyFields) {
  return keyFields.map(f => item[f] || '').join('|||')
}

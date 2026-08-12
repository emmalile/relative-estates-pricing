export const SQM_TO_SQFT = 10.7639
export const MARKUP_RATE = 1.2        // non-doors: multiplier on (material + ddp)
export const DOORS_MARGIN_PCT = 0.20  // doors: default margin when no override

// ── Units ──────────────────────────────────────────────────
// Not every category is priced by area. Only priceSqm is, and only it may
// be divided by SQM_TO_SQFT:
//
//   stone, flooring, tile   priceSqm       → converted to a per-sqft price
//   lighting, plumbing      pricePerUnit   → already per unit, no conversion
//   cabinetry               pricePerLinFt  → per linear foot, no conversion
//   doors                   unitPrice      → handled by the doors path
//
// Dividing a $100/unit light fixture by 10.7639 would quote it at $9.29,
// so the unit has to travel with the number rather than being assumed.
export const UNITS = {
  sqft:  { key: 'sqft',  suffix: '/sqft',   qtyLabel: 'Qty (sqft)'   },
  unit:  { key: 'unit',  suffix: '/unit',   qtyLabel: 'Qty (units)'  },
  linft: { key: 'linft', suffix: '/lin ft', qtyLabel: 'Qty (lin ft)' },
}

export function unitSuffix(unit) {
  return UNITS[unit]?.suffix || ''
}

export function unitQtyLabel(unit) {
  return UNITS[unit]?.qtyLabel || 'Qty'
}

// Reads one pricing_data row and returns what it actually costs, in the unit
// it was actually quoted in. Returns null when no price has been submitted.
export function normalizePrice(data) {
  if (!data) return null

  const sqm = parseFloat(data.priceSqm || 0)
  if (sqm > 0) {
    return { price: parseFloat((sqm / SQM_TO_SQFT).toFixed(2)), unit: 'sqft', priceSqm: sqm }
  }

  const perUnit = parseFloat(data.pricePerUnit || 0)
  if (perUnit > 0) return { price: perUnit, unit: 'unit' }

  const linFt = parseFloat(data.pricePerLinFt || 0)
  if (linFt > 0) return { price: linFt, unit: 'linft' }

  return null
}

// ── Matching a schedule item to its submitted price ────────
// schedules.items and submissions.pricing_data are parallel arrays, and the
// app used to pair them by position. Nothing keeps that alignment: adding,
// removing or reordering a schedule item shifts every later row, silently
// pairing one material with another material's price.
//
// pricing_data rows are built by spreading the schedule item, so they carry
// its key. Match on that, and fall back to position only for rows written
// before keys were present.
export function pricingFor(submission, item, index) {
  const rows = submission?.pricing_data
  if (!Array.isArray(rows)) return null

  if (item?.key) {
    const byKey = rows.find(r => r && r.key === item.key)
    if (byKey) return byKey
    // A keyed schedule item with no keyed match means this submission
    // predates the item, or the manufacturer never priced it. Falling back
    // to position here would pair it with an unrelated row.
    if (rows.some(r => r && r.key)) return null
  }

  return rows[index] ?? null
}

import { MARKUP_RATE, DOORS_MARGIN_PCT, pricingFor, normalizePrice } from './pricing'

// The client-facing price math, extracted so it can run on the SERVER.
//
// It used to run in the client's browser, which meant the browser had to be
// sent the inputs — raw manufacturer pricing (your cost), shipping_ddp and
// markup_override. Anyone on the client page could read all of it in
// devtools. Computing here means the browser receives only the finished
// number.
//
// markup_override carries two different meanings by category, which is the
// trap in this file:
//   • non-doors — an absolute dollars-per-sqft CLIENT price (e.g. 54.60)
//   • doors     — an integer percentage margin (e.g. 20 meaning 20%)
// shipping_ddp is per-sqft, applied pre-markup, and ignored for doors.

function hasOverride(ap) {
  return ap?.markup_override !== null && ap?.markup_override !== undefined && ap?.markup_override !== ''
}

// Cheapest submitted price, in the unit it was quoted in. Only priceSqm is
// converted; a per-unit or per-linear-foot quote is returned as-is.
// Matched by item key, not array position — see pricingFor().
export function getLowestPriceSqft(catSubs, item, itemIndex) {
  let best = null
  catSubs.forEach(sub => {
    const normalized = normalizePrice(pricingFor(sub, item, itemIndex))
    if (!normalized) return
    if (!best || normalized.price < best.price) best = normalized
  })
  if (!best) return null
  return { ...best, priceSqft: best.price }
}

// Non-doors: markup on (material + ddp), unless overridden with an absolute
// client price. Both are per whatever unit the category is priced in.
export function clientPriceSqft(low, ap) {
  const materialSqft = low ? low.priceSqft : null
  const ddpSqft = parseFloat(ap?.shipping_ddp || 0)
  const totalCostSqft = materialSqft != null ? parseFloat((materialSqft + ddpSqft).toFixed(2)) : null
  const autoMarkupSqft = totalCostSqft != null ? parseFloat((totalCostSqft * MARKUP_RATE).toFixed(2)) : null
  return hasOverride(ap) ? parseFloat(ap.markup_override) : autoMarkupSqft
}

// Doors: margin on the selected design's unit price, falling back to the
// cheapest submitted option so a client always sees a real price rather than
// a blank while a design is still being chosen.
export function clientPricePerUnit(catSubs, item, itemIndex, ap) {
  let bestPrice = null
  catSubs.forEach(sub => {
    const d = pricingFor(sub, item, itemIndex)
    if (!d) return
    const oldPrice = parseFloat(d.unitPrice || 0)
    if (oldPrice > 0 && (!bestPrice || oldPrice < bestPrice)) bestPrice = oldPrice
    ;(d.designOptions || []).forEach(opt => {
      const p = parseFloat(opt.unitPrice || 0)
      if (p > 0 && (!bestPrice || p < bestPrice)) bestPrice = p
    })
  })
  const unitCost = ap?.design_selection?.unitPrice ? parseFloat(ap.design_selection.unitPrice) : bestPrice
  if (!unitCost) return null
  const marginPct = hasOverride(ap) ? parseFloat(ap.markup_override) / 100 : DOORS_MARGIN_PCT
  return parseFloat((unitCost * (1 + marginPct)).toFixed(2))
}

// Returns { price, unit } so the client view can label the number correctly
// instead of assuming everything is per square foot.
export function clientPrice(categoryId, catSubs, item, itemIndex, ap) {
  if (categoryId === 'doors') {
    return { price: clientPricePerUnit(catSubs, item, itemIndex, ap), unit: 'unit' }
  }
  const low = getLowestPriceSqft(catSubs, item, itemIndex)
  return { price: clientPriceSqft(low, ap), unit: low?.unit || 'sqft' }
}

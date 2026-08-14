import { pricingFor, normalizePrice } from './pricing'

// ═══════════════════════════════════════════════════════
// LINE ITEM PRICE STATE
// ═══════════════════════════════════════════════════════
// A price cell has four possible meanings and they were all rendered as
// the same em-dash, so "the vendor hasn't come back to us", "the vendor
// answered and left this one blank" and "this line was never going to be
// priced" were indistinguishable — on the internal view and on the
// client's.
//
// This is the one place that decides which it is. Everything that renders
// a price, counts a priced item, or enables an approval control asks here
// rather than testing for null itself.
//
// The states are derived rather than stored. Storing one would be more
// explicit still, but it would need a column that something has to keep
// truthful on every submission, import and extraction; deriving keeps a
// single definition that cannot drift from the data. `not_applicable` is
// the one state that genuinely cannot be derived — nothing in the data
// says "never price this" — so it is defined here and returned only when
// a line is explicitly marked, ready for that flag to exist.
// ═══════════════════════════════════════════════════════

export const PRICE_STATES = {
  priced:          'priced',
  awaiting_vendor: 'awaiting_vendor',
  awaiting_entry:  'awaiting_entry',
  not_applicable:  'not_applicable',
}

// Has this vendor sent anything back for this category at all?
function categoryHasSubmission(catSubs) {
  return (catSubs || []).length > 0
}

// The submitted price for one item, in whatever unit it was quoted in.
// Doors carry their price on the design options instead.
function submittedPrice(categoryId, catSubs, item, itemIndex) {
  if (categoryId === 'doors') {
    let best = null
    ;(catSubs || []).forEach(sub => {
      const d = pricingFor(sub, item, itemIndex)
      if (!d) return
      const flat = parseFloat(d.unitPrice || 0)
      if (flat > 0 && (!best || flat < best)) best = flat
      ;(d.designOptions || []).forEach(opt => {
        const p = parseFloat(opt.unitPrice || 0)
        if (p > 0 && (!best || p < best)) best = p
      })
    })
    return best
  }
  let best = null
  ;(catSubs || []).forEach(sub => {
    const n = normalizePrice(pricingFor(sub, item, itemIndex))
    if (n && (!best || n.price < best)) best = n.price
  })
  return best
}

// The state of one line. `ap` is its approvals row, if any.
export function priceState(categoryId, catSubs, item, itemIndex, ap) {
  if (ap?.price_state === PRICE_STATES.not_applicable) return PRICE_STATES.not_applicable
  if (submittedPrice(categoryId, catSubs, item, itemIndex) != null) return PRICE_STATES.priced
  // The vendor has answered for this category but not for this line.
  if (categoryHasSubmission(catSubs)) return PRICE_STATES.awaiting_entry
  return PRICE_STATES.awaiting_vendor
}

export function isPriced(categoryId, catSubs, item, itemIndex, ap) {
  return priceState(categoryId, catSubs, item, itemIndex, ap) === PRICE_STATES.priced
}

// ── Labels ────────────────────────────────────────────────
// Internal sees who it is waiting on and for how long. The client sees
// that it is in hand, without the internal chase detail.
export function internalPriceLabel(state, daysWaiting) {
  switch (state) {
    case PRICE_STATES.awaiting_vendor:
      return daysWaiting != null ? `Awaiting vendor · ${daysWaiting}d` : 'Awaiting vendor'
    case PRICE_STATES.awaiting_entry:
      return daysWaiting != null ? `Not yet priced · ${daysWaiting}d` : 'Not yet priced'
    case PRICE_STATES.not_applicable:
      return 'Not applicable'
    default:
      return null // priced — the caller renders the number
  }
}

export function clientPriceLabel(state) {
  switch (state) {
    case PRICE_STATES.not_applicable:
      return 'Not applicable'
    case PRICE_STATES.priced:
      return null // the caller renders the number
    default:
      return 'Pricing in progress'
  }
}

// Whole days since `since`, floored at 0. Used for the chase counter.
export function daysSince(since) {
  if (!since) return null
  const then = new Date(since)
  if (Number.isNaN(then.getTime())) return null
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000))
}

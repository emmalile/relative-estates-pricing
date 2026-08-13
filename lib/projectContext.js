import { getCategory } from './categories'
import { clientPrice, getLowestPriceSqft } from './clientPricing'
import { pricingFor } from './pricing'

// A project, flattened into something a model can reason over.
//
// Every number here comes from lib/clientPricing.js — the same functions the
// client page and the dashboard use. Chat must not be a second implementation
// of the pricing rules: a chat that computes its own totals will eventually
// disagree with the screens, and there would be no way to tell which was
// right.
//
// This is internal-only, so unlike the client view it does include cost and
// margin. The access check lives in the route.

function costFor(categoryId, catSubs, item, index, approval) {
  if (categoryId === 'doors') {
    // The selected design if there is one, otherwise the cheapest option
    // offered — the same fallback the price uses.
    if (approval?.design_selection?.unitPrice) {
      return { cost: parseFloat(approval.design_selection.unitPrice), unit: 'unit' }
    }
    let best = null
    catSubs.forEach(sub => {
      const d = pricingFor(sub, item, index)
      if (!d) return
      const p = parseFloat(d.unitPrice || 0)
      if (p > 0 && (best === null || p < best)) best = p
      ;(d.designOptions || []).forEach(opt => {
        const o = parseFloat(opt.unitPrice || 0)
        if (o > 0 && (best === null || o < best)) best = o
      })
    })
    return { cost: best, unit: 'unit' }
  }
  const low = getLowestPriceSqft(catSubs, item, index)
  return { cost: low ? low.priceSqft : null, unit: low?.unit || 'sqft' }
}

export function buildSnapshot({ project, schedules, submissions, approvals }) {
  // Latest submission per manufacturer per category — the same rule the
  // dashboard uses to decide which quote counts.
  const subMap = {}
  ;(submissions || []).forEach(s => {
    const k = `${s.category}|||${s.manufacturer_name}`
    if (!subMap[k] || new Date(s.submitted_at) > new Date(subMap[k].submitted_at)) subMap[k] = s
  })
  const latest = Object.values(subMap)

  const apprMap = {}
  ;(approvals || []).forEach(a => { apprMap[`${a.category}|||${a.item_key}`] = a })

  const categories = (schedules || []).map(sched => {
    const category = getCategory(sched.category)
    const catSubs = latest.filter(s => s.category === sched.category)
    const idFields = category ? Object.keys(category.csvColumns) : []

    let categoryTotal = 0
    let quantityTotal = 0

    const items = (sched.items || []).map((item, i) => {
      const ap = apprMap[`${sched.category}|||${item.key}`] || {}
      const { price, unit } = clientPrice(sched.category, catSubs, item, i, ap)
      const { cost } = costFor(sched.category, catSubs, item, i, ap)
      const quantity = parseFloat(ap.quantity || 0)
      const lineTotal = price != null && quantity ? parseFloat((price * quantity).toFixed(2)) : null

      if (ap.status !== 'rejected') {
        if (lineTotal) categoryTotal += lineTotal
        if (quantity) quantityTotal += quantity
      }

      // Only the identifying fields the category defines, so a schedule item
      // arrives described the way that category describes items.
      const fields = {}
      idFields.forEach(f => { if (item[f]) fields[f] = item[f] })

      return {
        key: item.key,
        ...fields,
        locations: item.locations || [],
        unit,
        quantity,
        costPerUnit: cost,
        clientPricePerUnit: price,
        lineTotal,
        status: ap.status || 'pending',
        hasManualOverride: ap.markup_override !== null && ap.markup_override !== undefined && ap.markup_override !== '',
        shippingDdp: ap.shipping_ddp ? parseFloat(ap.shipping_ddp) : null,
        internalNotes: ap.notes || null,
      }
    })

    // The unit a quantity is actually in is the unit its price is quoted in —
    // line totals are quantity × price, so they have to agree. The category's
    // declared quantityUnit does not: stone declares sqm while its prices are
    // converted to sqft, and reporting the declared unit would label square
    // feet as square metres. Derived from the items, and reported as mixed
    // rather than guessed when they disagree.
    const units = [...new Set(items.map(i => i.unit).filter(Boolean))]

    return {
      category: sched.category,
      label: category?.label || sched.category,
      manufacturer: sched.manufacturer,
      quantityUnit: units.length === 1 ? units[0] : units.length ? 'mixed' : null,
      quotesReceived: catSubs.map(s => s.manufacturer_name),
      itemCount: items.length,
      // Quantities only sum meaningfully within a category, because the unit
      // differs between them — sqm of stone and a count of doors are not
      // addable. Kept per category for that reason.
      totalQuantity: parseFloat(quantityTotal.toFixed(2)),
      totalClientPrice: parseFloat(categoryTotal.toFixed(2)),
      items,
    }
  })

  return {
    project: {
      name: project.name,
      client: project.client,
      slug: project.slug,
      categories: project.categories || [],
    },
    categories,
    grandTotalClientPrice: parseFloat(
      categories.reduce((sum, c) => sum + c.totalClientPrice, 0).toFixed(2)
    ),
  }
}

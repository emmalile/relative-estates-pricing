import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject } from '@/lib/projectAccess'
import { clientPrice } from '@/lib/clientPricing'
import { pricingFor } from '@/lib/pricing'
import { readShipment, hasShipment } from '@/lib/shipment'
import { priceState, clientPriceLabel, PRICE_STATES } from '@/lib/priceState'
import { clientFacingPrice } from '@/lib/clientRelease'

// GET /api/client-view/[slug] — everything the client page renders, and
// nothing else.
//
// Reads through the service-role client so it can reach submissions and
// approvals, which clients are no longer permitted to read directly. That
// makes the access check below load-bearing: RLS is not filtering here, so
// this route must refuse the request itself.
//
// What deliberately never leaves this function:
//   • submissions.pricing_data — raw manufacturer pricing, i.e. your cost
//   • approvals.markup_override, approvals.shipping_ddp — your margin
//   • approvals.notes — internal notes, marked "not visible to client"
// Only the finished price is emitted.
export async function GET(request, { params }) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth
  const { slug } = params

  const admin = createAdminClient()

  const { data: project } = await admin
    .from('projects')
    .select('id, name, client, slug, categories')
    .eq('slug', slug)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  if (!(await canAccessProject(user, project.id))) {
    return NextResponse.json({ error: 'Not authorized for this project' }, { status: 403 })
  }

  const [{ data: schedules }, { data: subs }, { data: apprs }] = await Promise.all([
    admin.from('schedules').select('*').eq('project_id', project.id),
    admin.from('submissions').select('*').eq('project_id', project.id),
    admin.from('approvals').select('*').eq('project_id', project.id),
  ])

  // Latest submission per manufacturer per category, matching how the
  // dashboard picks which quote counts.
  const subMap = {}
  ;(subs || []).forEach(s => {
    const k = s.category + '|||' + s.manufacturer_name
    if (!subMap[k] || new Date(s.submitted_at) > new Date(subMap[k].submitted_at)) subMap[k] = s
  })
  const submissions = Object.values(subMap)

  const apprMap = {}
  ;(apprs || []).forEach(a => { apprMap[`${a.category}|||${a.item_key}`] = a })

  let totalItems = 0, approved = 0, rejected = 0, total = 0, pricedItems = 0

  // How current the figures are. Approval timestamps are internal activity,
  // but "when did this last change" is exactly what a client needs to trust
  // a total, and it reveals nothing about what changed.
  let updatedAt = null
  ;[...(subs || []).map(s => s.submitted_at), ...(apprs || []).map(a => a.updated_at)]
    .forEach(ts => { if (ts && (!updatedAt || new Date(ts) > new Date(updatedAt))) updatedAt = ts })

  const categories = (schedules || []).map(sched => {
    const catSubs = submissions.filter(s => s.category === sched.category)
    const isDoors = sched.category === 'doors'

    const items = (sched.items || []).map((item, i) => {
      const ap = apprMap[`${sched.category}|||${item.key}`] || {}
      totalItems++
      if (ap.status === 'approved') approved++
      if (ap.status === 'rejected') rejected++

      const { price: livePrice, unit } = clientPrice(sched.category, catSubs, item, i, ap)
      // The gate. A quote that has landed but not been released is not a
      // price as far as this page is concerned — the number does not leave
      // the server, so it cannot be read out of the network response
      // either. Released lines carry the snapshot taken at release, so a
      // re-quote overnight does not move a number a client was given.
      const unitPrice = clientFacingPrice(ap, livePrice)
      // The internal state distinguishes "vendor hasn't replied" from
      // "vendor replied and left this blank". The client has no use for
      // that distinction and it is not theirs to see, so it collapses to a
      // single label here rather than being sent and hidden in the browser.
      // A held line collapses into the same label: from the client's side
      // "still being quoted" and "quoted, not yet released" are the same
      // sentence, which is that the price is not settled.
      const state = priceState(sched.category, catSubs, item, i, ap)
      const priced = state === PRICE_STATES.priced && unitPrice != null
      if (priced) pricedItems++
      // "Never going to be priced" is a fact about the line and stays.
      // Everything else the client sees as one state — not settled yet —
      // whether that is because no vendor has answered or because the
      // answer has not been released.
      const clientState = state === PRICE_STATES.not_applicable ? state
        : priced ? PRICE_STATES.priced : PRICE_STATES.awaiting_vendor
      const quantity = parseFloat(ap.quantity || 0)
      const lineTotal = unitPrice != null && quantity ? unitPrice * quantity : null
      if (ap.status !== 'rejected' && lineTotal) total += lineTotal

      const images = isDoors
        ? (ap.design_selection?.url ? [{ url: ap.design_selection.url }] : [])
        : catSubs.flatMap(s => pricingFor(s, item, i)?.images || []).filter(img => img?.url)

      return {
        key: item.key,
        // Display fields only — whatever the client page puts on screen.
        name: item.name || null,
        finish: item.finish || null,
        cut: item.cut || null,
        locations: item.locations || [],
        no: item.no || null,
        description: item.description || null,
        location: item.location || null,
        type: item.type || null,
        widthInches: item.widthInches || null,
        heightInches: item.heightInches || null,

        unitPrice,
        unit,
        quantity,
        total: lineTotal,
        priced,
        priceLabel: clientPriceLabel(clientState),
        status: ap.status || 'pending',
        clientNotes: ap.client_notes || '',
        images,
        // Two shipments per item: the product, and the sample sent for it.
        // Both are client-facing — a client chasing a stone sample wants the
        // same tracking link you do — and both route through the same
        // stage mapping on the page so internal-only stages stay internal.
        shipment: readShipment(ap, 'product'),
        sample: hasShipment(ap, 'sample') ? readShipment(ap, 'sample') : null,
      }
    })

    return { id: sched.category, items }
  })

  return NextResponse.json({
    project: {
      name: project.name,
      client: project.client,
      slug: project.slug,
      categories: project.categories || [],
    },
    categories,
    totals: { totalItems, approved, rejected, total, pricedItems, updatedAt },
  })
}

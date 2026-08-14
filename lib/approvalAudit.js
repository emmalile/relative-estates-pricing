import { clientPrice } from './clientPricing'

// ═══════════════════════════════════════════════════════
// APPROVAL AUDIT LOG
// ═══════════════════════════════════════════════════════
// approvals holds current state: it can say a line is approved, but not who
// approved it, when, at what price, or that it was rejected twice first.
// In procurement that record is what settles a dispute — a decision without
// a timestamp and a name is a rumour.
//
// Two rules this file follows:
//
//   1. Logging must never cost a decision. If the append fails — the table
//      is missing, the database is briefly unhappy — the approval has
//      already been written and stands. A failure here is logged and
//      swallowed, exactly like the repository bookkeeping alongside it.
//
//   2. The price is snapshotted, not joined. The point of the record is
//      what was true at the moment of the decision; a later re-quote must
//      not rewrite the history of an approval that has already happened.
//
// The price recorded is the client-facing one — what the approval commits
// the client to — computed with the same clientPrice() the client view and
// the dashboard use, so the log cannot disagree with either.
// ═══════════════════════════════════════════════════════

// Only a real change of decision is worth a row. Quantity edits, note
// edits and DDP changes all come through the same endpoint, and logging
// those would bury the decisions in noise.
export function isStatusChange(fromStatus, toStatus) {
  return (fromStatus || 'pending') !== (toStatus || 'pending')
}

export async function recordApprovalEvent(admin, {
  projectId, category, itemKey, fromStatus, toStatus, approval, user,
}) {
  const quantity = approval?.quantity != null ? parseFloat(approval.quantity) : null
  try {
    // Priced at the moment of the decision. Fetched only on a real status
    // change: most writes to this endpoint are quantity and note edits, and
    // they would otherwise pay for two queries they have no use for.
    let unitPrice = null
    let lineTotal = null

    const [{ data: schedule }, { data: subs }] = await Promise.all([
      admin.from('schedules').select('items').eq('project_id', projectId).eq('category', category).maybeSingle(),
      admin.from('submissions').select('*').eq('project_id', projectId).eq('category', category),
    ])

    const items = schedule?.items || []
    const index = items.findIndex(it => it.key === itemKey)
    if (index >= 0) {
      // Latest submission per manufacturer, matching how every other view
      // decides which quote counts.
      const latest = {}
      ;(subs || []).forEach(s => {
        const k = s.manufacturer_name
        if (!latest[k] || new Date(s.submitted_at) > new Date(latest[k].submitted_at)) latest[k] = s
      })
      // The whole approval row, not just the quantity: clientPrice reads
      // shipping_ddp and markup_override off it, and a snapshot computed
      // without those is not the price anyone agreed to.
      const { price } = clientPrice(category, Object.values(latest), items[index], index, approval)
      if (price != null) {
        unitPrice = price
        lineTotal = quantity ? parseFloat((price * quantity).toFixed(2)) : null
      }
    }

    await admin.from('approval_events').insert({
      project_id: projectId,
      category,
      item_key: itemKey,
      from_status: fromStatus || 'pending',
      to_status: toStatus || 'pending',
      unit_price: unitPrice,
      quantity: quantity ?? null,
      line_total: lineTotal,
      actor_id: user?.id || null,
      // Denormalised so the record survives the person's profile being
      // removed — the point of an audit trail is that it outlives the
      // account that created it.
      actor_email: user?.email || null,
    })
  } catch (e) {
    // Including "table does not exist", which is the state before
    // supabase-audit-migration.sql has been run. Approvals keep working.
    console.warn('[audit] could not record approval event:', e.message)
  }
}

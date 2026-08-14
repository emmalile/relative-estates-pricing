'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'

// The decision history for one line, in the expanded panel beside the
// provenance of its price. Fetched when the row opens rather than with the
// page, so a schedule of fifty-two costs nothing until you ask.
//
// Renders nothing at all when there is no history — a line that has never
// been actioned should not carry an empty box saying so.
export default function ApprovalHistory({ projectId, category, itemKey }) {
  const [events, setEvents] = useState(null)

  useEffect(() => {
    let live = true
    fetch(`/api/approvals/history?projectId=${encodeURIComponent(projectId)}&category=${encodeURIComponent(category)}&itemKey=${encodeURIComponent(itemKey)}`)
      .then(r => r.ok ? r.json() : { events: [] })
      .then(d => { if (live) setEvents(d.events || []) })
      .catch(() => { if (live) setEvents([]) })
    return () => { live = false }
  }, [projectId, category, itemKey])

  if (!events || events.length === 0) return null

  const word = { approved: 'Approved', rejected: 'Rejected', pending: 'Reset to pending' }

  return (
    <div style={{ marginTop:'var(--s-4)' }}>
      <div style={{ fontSize:'var(--t-xs)', fontWeight:600, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--gray)', marginBottom:'var(--s-2)' }}>
        Decision history
      </div>
      <div style={{ borderLeft:'2px solid var(--border)', paddingLeft:'var(--s-3)' }}>
        {events.map(e => (
          <div key={e.id} style={{ fontSize:'var(--t-xs)', color:'var(--gray)', padding:'var(--s-1) 0', lineHeight:'var(--lh-body)' }}>
            <span style={{ color:'var(--black)', fontWeight:500 }}>{word[e.to_status] || e.to_status}</span>
            {e.actor_email && <> by {e.actor_email}</>}
            {' · '}
            {new Date(e.created_at).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' })}
            {e.line_total != null && (
              <> · {formatCurrency(e.line_total)}{e.unit_price != null && e.quantity ? ` (${e.quantity} × ${formatCurrency(e.unit_price)})` : ''}</>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

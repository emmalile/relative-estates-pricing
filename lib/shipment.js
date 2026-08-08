// ═══════════════════════════════════════════════════════
// SHIPMENT TRACKING — single source of truth (Phase 3)
// ═══════════════════════════════════════════════════════
// The internal dashboard shows all 7 stages. The client view only ever
// sees the 4 client-facing ones, plus a generic "Processing" bucket that
// hides internal-only detail. Never render an internal stage label on a
// client-facing page — always route through toClientStage().
// ═══════════════════════════════════════════════════════

export const INTERNAL_STAGES = [
  { key: 'pending',    label: 'Pending approval', icon: 'ti-clock',              color: 'var(--s-pending)',    clientVisible: false },
  { key: 'production', label: 'In production',    icon: 'ti-tools',              color: 'var(--s-production)', clientVisible: false },
  { key: 'transit',    label: 'In transit',       icon: 'ti-plane',              color: 'var(--s-transit)',    clientVisible: true  },
  { key: 'ground',     label: 'On ground',        icon: 'ti-truck',              color: 'var(--s-ground)',     clientVisible: false },
  { key: 'warehouse',  label: 'At warehouse',     icon: 'ti-building-warehouse', color: 'var(--s-warehouse)',  clientVisible: true  },
  { key: 'checkedin',  label: 'Checked in',       icon: 'ti-circle-check',       color: 'var(--s-checkedin)',  clientVisible: true  },
  { key: 'delayed',    label: 'Delayed',          icon: 'ti-alert-triangle',     color: 'var(--s-delayed)',    clientVisible: true  },
]

export const STAGE_KEYS = INTERNAL_STAGES.map(s => s.key)

export function getStage(key) {
  return INTERNAL_STAGES.find(s => s.key === key) || null
}

// ── Client-facing stages ──────────────────────────────────
// Four real stages plus "Processing" for anything internal-only.
export const CLIENT_STAGES = {
  transit:    { label: 'In transit',   icon: 'ti-plane',              color: 'var(--s-transit)' },
  warehouse:  { label: 'At warehouse', icon: 'ti-building-warehouse', color: 'var(--s-warehouse)' },
  delivered:  { label: 'Delivered',    icon: 'ti-circle-check',       color: 'var(--s-checkedin)' },
  delayed:    { label: 'Delayed',      icon: 'ti-alert-triangle',     color: 'var(--s-delayed)' },
  processing: { label: 'Processing',   icon: 'ti-progress',           color: 'var(--s-production)' },
}

// Map an internal stage key -> what the client is allowed to see.
// NOTE: 'ground' (landed, with the local courier) maps to "In transit"
// rather than "Processing" on purpose — a client watching an item go
// from "In transit" back to "Processing" reads as the order regressing.
// Flip it to 'processing' here if you'd rather it be hidden entirely.
export function toClientStage(internalKey) {
  switch (internalKey) {
    case 'transit':   return CLIENT_STAGES.transit
    case 'ground':    return CLIENT_STAGES.transit
    case 'warehouse': return CLIENT_STAGES.warehouse
    case 'checkedin': return CLIENT_STAGES.delivered
    case 'delayed':   return CLIENT_STAGES.delayed
    case 'production':
    case 'pending':
      return CLIENT_STAGES.processing
    default:
      return null // no shipment status set yet — render nothing
  }
}

// Carrier presets for the tracking dropdown. `url` takes the tracking
// number and returns a public tracking link; null means "no auto link".
export const CARRIERS = [
  { id: 'ups',     label: 'UPS',        url: n => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}` },
  { id: 'fedex',   label: 'FedEx',      url: n => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}` },
  { id: 'dhl',     label: 'DHL',        url: n => `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(n)}` },
  { id: 'usps',    label: 'USPS',       url: n => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}` },
  { id: 'maersk',  label: 'Maersk',     url: n => `https://www.maersk.com/tracking/${encodeURIComponent(n)}` },
  { id: 'freight', label: 'Freight / other', url: null },
]

export function carrierTrackingUrl(carrierId, trackingNumber) {
  if (!carrierId || !trackingNumber) return null
  const c = CARRIERS.find(x => x.id === carrierId)
  return c && c.url ? c.url(trackingNumber) : null
}

// Format an ETA date (stored as a plain `date`) without timezone drift.
export function formatEta(eta) {
  if (!eta) return null
  const [y, m, d] = String(eta).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

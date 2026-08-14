// ═══════════════════════════════════════════════════════
// PERMISSION PREDICATES
// ═══════════════════════════════════════════════════════
// Deliberately dependency-free: middleware, server routes and client
// components all import this, and middleware cannot pull in anything that
// touches next/headers or the Supabase server client.
//
// Viewing and exporting are separate predicates even though they currently
// admit the same roles. They answer different questions — "may this person
// see cost on screen" and "may this person carry cost out of the app in a
// file" — and the second is the one that outlives the session. Keeping them
// apart means restricting exports later is a one-line change rather than an
// audit of every call site.
// ═══════════════════════════════════════════════════════

export const INTERNAL_ROLES = ['owner', 'admin', 'member']

// May see cost, margin and profit on screen.
export function canViewCosts(role) {
  return INTERNAL_ROLES.includes(role)
}

// May generate a file containing cost or margin. Checked at the moment of
// export, not inherited from having reached the page.
export function canExportCosts(role) {
  return INTERNAL_ROLES.includes(role)
}

// The internal surface: pages that render cost, margin or profit, plus the
// admin portal they hang off. Anyone without canViewCosts is turned away at
// the edge rather than handed a page that quietly renders nothing.
//
// The portal root is included because the sign-in callback already tries to
// keep clients off it, but only at the moment of sign-in — a ?next= deep
// link or any later navigation walked straight past that.
export const INTERNAL_PAGE_PATTERNS = [
  /^\/$/,
  /^\/reporting\/?$/,
  /^\/vendors\/?$/,
  /^\/repository\/?$/,
  /^\/projects\/[^/]+\/dashboard\/?$/,
  /^\/projects\/[^/]+\/files\/?$/,
  /^\/projects\/[^/]+\/chat\/?$/,
  /^\/projects\/[^/]+\/extractions\//,
]

export function isInternalPage(pathname) {
  return INTERNAL_PAGE_PATTERNS.some(p => p.test(pathname))
}

// What a recipient of a shared link or an exported file actually receives.
// Rendered next to every share and export action so the scope is on screen
// before the action can be taken.
export const CLIENT_SHARE_SCOPE =
  'Recipients see materials, shipment status and the prices you have sent them. Prices you have not released, your cost and your margin are not included.'

export const VENDOR_SHARE_SCOPE =
  'The vendor sees the material schedule and their own pricing. No cost, margin or other vendor’s pricing is included.'

export const INTERNAL_EXPORT_SCOPE =
  'Internal file — includes your cost, margin and profit. Do not send to a client or vendor.'

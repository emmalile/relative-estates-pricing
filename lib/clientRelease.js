// ═══════════════════════════════════════════════════════
// CLIENT PRICE RELEASE
// ═══════════════════════════════════════════════════════
// One definition of "is the client seeing this, and is what they are
// seeing still what we meant", used by the client view, the dashboard and
// the release endpoint, so the three cannot drift.
//
// A released price is a SNAPSHOT, not a flag on a live calculation. The
// client sees the number that was released; re-quotes and markup changes
// move the internal figure and leave theirs alone until someone releases
// again. Anything else means a vendor can change a client's price at 9pm.
//
// The one exception is a null snapshot, which the migration leaves on rows
// that predate this feature. Those were already live on clients' screens
// against the computed price, so they keep computing until the next
// release locks a number. Everything below treats null as "no snapshot
// yet", never as "free".
// ═══════════════════════════════════════════════════════

export const RELEASE_STATES = {
  held:     'held',      // the client sees no price for this line
  released: 'released',  // what they see matches what we would charge
  changed:  'changed',   // released, but the live price has moved since
}

// Held unless explicitly released. Not `!== false`: a row that has never
// been released has no column value at all, and defaulting an unknown to
// "visible" is the failure this whole file exists to prevent.
export function isReleased(ap) {
  return ap?.client_released === true
}

function snapshot(ap) {
  const v = ap?.client_price
  return v === null || v === undefined || v === '' ? null : parseFloat(v)
}

// Money compares at two decimals or not at all — 54.599999999999994 is not
// a price change.
function sameMoney(a, b) {
  if (a == null || b == null) return a == null && b == null
  return Math.abs(a - b) < 0.005
}

// `livePrice` is what clientPrice() computes from the current quotes,
// DDP and markup.
export function releaseState(ap, livePrice) {
  if (!isReleased(ap)) return RELEASE_STATES.held
  const locked = snapshot(ap)
  if (locked == null) return RELEASE_STATES.released // legacy row, tracks live
  if (livePrice == null) return RELEASE_STATES.released
  return sameMoney(locked, livePrice) ? RELEASE_STATES.released : RELEASE_STATES.changed
}

// The number to put in front of the client, and the only price-shaped
// value that should ever leave the server for a client's browser.
export function clientFacingPrice(ap, livePrice) {
  if (!isReleased(ap)) return null
  const locked = snapshot(ap)
  return locked == null ? livePrice : locked
}

// A held line is not "unpriced" internally — a quote exists and the
// dashboard shows it. It is unpriced as far as the client is concerned,
// and the client's page has one honest way to say that, which is the same
// thing it says while a vendor is still quoting: pricing in progress.
export function clientSeesPrice(ap, livePrice) {
  return clientFacingPrice(ap, livePrice) != null
}

// Lines the "send to client" action would act on: priced internally, and
// either never released or released at a price that has since moved.
export function needsRelease(ap, livePrice) {
  if (livePrice == null) return false
  const state = releaseState(ap, livePrice)
  return state === RELEASE_STATES.held || state === RELEASE_STATES.changed
}

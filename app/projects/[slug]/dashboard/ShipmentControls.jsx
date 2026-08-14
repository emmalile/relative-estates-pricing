'use client'

import { useState, useEffect } from 'react'
import { INTERNAL_STAGES, getStage, CARRIERS, formatEta, readShipment, hasShipment } from '@/lib/shipment'

// ═══════════════════════════════════════════════════════
// PHASE 3 — SHIPMENT CONTROLS (internal dashboard only)
// ═══════════════════════════════════════════════════════
// Self-contained on purpose: these components talk to /api/tracking
// directly and never touch pricing, approval status, quantities or notes.
// Dropping them into the dashboard requires no changes to saveApproval.
//
// Every control takes a `kind` — 'product' (default) or 'sample'. The
// controls are identical either way; the kind rides along to /api/tracking,
// which decides which columns it lands in, and drives the SAMPLE tag so a
// sample shipment is never mistaken on screen for the product itself.
// ═══════════════════════════════════════════════════════

async function postTracking(payload) {
  const res = await fetch('/api/tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new Error(d.error || 'Tracking update failed')
  }
  return res.json()
}

// ── SAMPLE tag ────────────────────────────────────────────
// The one visual difference between the two kinds. Anywhere a sample
// shipment is shown next to a product one, this is what tells them apart.
export function SampleTag({ size = 9 }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: size, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
      padding: '2px 6px', color: 'var(--gold)', background: 'var(--gold-pale)',
      border: '1px solid rgba(154,122,74,0.25)', whiteSpace: 'nowrap',
    }}>
      <i className="ti ti-flask" style={{ fontSize: size + 3 }} />
      Sample
    </span>
  )
}

// ── Per-item shipment cell ────────────────────────────────
export function ShipmentCell({ projectId, category, itemKey, approval, onSaved, kind = 'product' }) {
  const isSample = kind === 'sample'
  const ship = readShipment(approval, kind)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [status, setStatus] = useState(ship.status || '')
  const [carrier, setCarrier] = useState(ship.carrier || '')
  const [trackingNumber, setTrackingNumber] = useState(ship.trackingNumber || '')
  const [eta, setEta] = useState(ship.eta || '')

  // Re-seed local state if the row is refreshed from the server.
  useEffect(() => {
    setStatus(ship.status || '')
    setCarrier(ship.carrier || '')
    setTrackingNumber(ship.trackingNumber || '')
    setEta(ship.eta || '')
  }, [ship.status, ship.carrier, ship.trackingNumber, ship.eta])

  const stage = getStage(ship.status)

  // Quick status change straight from the cell, no dialog.
  async function quickSetStatus(nextStatus) {
    setSaving(true); setError('')
    try {
      const r = await postTracking({ projectId, category, itemKey, kind, shipmentStatus: nextStatus || null })
      onSaved?.(r.approvals?.[0])
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  async function saveAll() {
    setSaving(true); setError('')
    try {
      const r = await postTracking({
        projectId, category, itemKey, kind,
        shipmentStatus: status || null,
        carrier: carrier || null,
        trackingNumber: trackingNumber || null,
        eta: eta || null,
      })
      onSaved?.(r.approvals?.[0])
      setOpen(false)
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 150 }}>
      {/* Current stage */}
      {stage ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--gray)', whiteSpace: 'nowrap' }}>
          <i className={`ti ${stage.icon}`} style={{ color: stage.color, fontSize: 16 }} />
          {stage.label}
        </span>
      ) : (
        <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--gray-light)' }}>
          {isSample ? 'No sample sent' : 'Not set'}
        </span>
      )}

      {/* Tracking summary */}
      {ship.trackingNumber && (
        <div style={{ fontSize: 11, color: 'var(--gray-light)', lineHeight: 1.5 }}>
          {ship.trackingUrl ? (
            <a href={ship.trackingUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--s-transit)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
              {ship.trackingNumber}
            </a>
          ) : ship.trackingNumber}
          {ship.eta && <div>ETA {formatEta(ship.eta)}</div>}
        </div>
      )}

      {/* Quick stage picker */}
      <select
        value={ship.status || ''}
        disabled={saving}
        onChange={e => quickSetStatus(e.target.value)}
        style={{
          fontFamily: 'var(--font-body)', fontSize: 11, padding: '4px 6px',
          border: '1px solid var(--border-dark)', background: 'var(--white)',
          color: 'var(--gray)', cursor: 'pointer', maxWidth: 150,
        }}
      >
        <option value="">{isSample ? '— set sample stage —' : '— set stage —'}</option>
        {INTERNAL_STAGES.map(s => (
          <option key={s.key} value={s.key}>{s.label}{s.clientVisible ? '' : ' (internal)'}</option>
        ))}
      </select>

      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
          textTransform: 'uppercase', padding: '4px 8px', cursor: 'pointer',
          border: '1px solid var(--border-dark)', background: 'transparent', color: 'var(--gray)',
          width: 'fit-content',
        }}
      >
        {ship.trackingNumber
          ? (isSample ? 'Edit sample tracking' : 'Edit tracking')
          : (isSample ? 'Add sample tracking' : 'Add tracking')}
      </button>

      {error && <div style={{ fontSize: 10, color: 'var(--danger)' }}>{error}</div>}

      {/* Inline tracking editor */}
      {open && (
        <div style={{
          border: `1px solid ${isSample ? 'var(--gold-light)' : 'var(--border)'}`, background: 'var(--white)',
          padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
          boxShadow: '0 2px 10px rgba(0,0,0,0.08)', minWidth: 210,
        }}>
          {isSample && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <SampleTag />
              <span style={{ fontSize: 10, color: 'var(--gray-light)' }}>Tracking the sample, not the product</span>
            </div>
          )}

          <label style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray-light)' }}>
            Stage
            <select value={status} onChange={e => setStatus(e.target.value)}
              style={{ width: '100%', marginTop: 3, fontFamily: 'var(--font-body)', fontSize: 12, padding: '5px 6px', border: '1px solid var(--border-dark)' }}>
              <option value="">— none —</option>
              {INTERNAL_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>

          <label style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray-light)' }}>
            Carrier
            <select value={carrier} onChange={e => setCarrier(e.target.value)}
              style={{ width: '100%', marginTop: 3, fontFamily: 'var(--font-body)', fontSize: 12, padding: '5px 6px', border: '1px solid var(--border-dark)' }}>
              <option value="">— none —</option>
              {CARRIERS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>

          <label style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray-light)' }}>
            Tracking number
            <input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} placeholder="e.g. 1Z999AA10123456784"
              style={{ width: '100%', marginTop: 3, fontFamily: 'var(--font-body)', fontSize: 12, padding: '5px 6px', border: '1px solid var(--border-dark)' }} />
          </label>

          <label style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray-light)' }}>
            ETA
            <input type="date" value={eta || ''} onChange={e => setEta(e.target.value)}
              style={{ width: '100%', marginTop: 3, fontFamily: 'var(--font-body)', fontSize: 12, padding: '5px 6px', border: '1px solid var(--border-dark)' }} />
          </label>

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setOpen(false)}
              style={{ fontFamily: 'var(--font-body)', fontSize: 10, padding: '5px 10px', cursor: 'pointer', border: '1px solid var(--border-dark)', background: 'transparent', color: 'var(--gray)' }}>
              Cancel
            </button>
            <button onClick={saveAll} disabled={saving}
              style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600, padding: '5px 10px', cursor: 'pointer', border: '1px solid var(--black)', background: 'var(--black)', color: 'var(--white)' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Bulk tracking (button + modal) ────────────────────────
// Selection lives inside the modal, so the dashboard table needs no
// checkbox column and no extra state.
export function BulkTrackingButton({ projectId, category, items, approvals, onSaved }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('product')
  const [selected, setSelected] = useState(new Set())
  const [status, setStatus] = useState('')
  const [carrier, setCarrier] = useState('')
  const [trackingNumber, setTrackingNumber] = useState('')
  const [eta, setEta] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function selectAll() {
    setSelected(prev => prev.size === items.length ? new Set() : new Set(items.map(i => i.key)))
  }

  async function apply() {
    if (selected.size === 0) { setError('Select at least one item'); return }
    if (!status && !carrier && !trackingNumber && !eta) { setError('Set at least one field to apply'); return }

    setSaving(true); setError('')
    const payload = { projectId, category, kind, itemKeys: Array.from(selected) }
    // Only send fields that were actually filled in, so a bulk stage change
    // doesn't wipe tracking numbers already set on individual items.
    if (status) payload.shipmentStatus = status
    if (carrier) payload.carrier = carrier
    if (trackingNumber) payload.trackingNumber = trackingNumber
    if (eta) payload.eta = eta

    try {
      await postTracking(payload)
      onSaved?.()
      setOpen(false)
      setSelected(new Set())
      setStatus(''); setCarrier(''); setTrackingNumber(''); setEta('')
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  const isSample = kind === 'sample'
  const labelStyle = { fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gray-light)', display: 'block' }
  const inputStyle = { width: '100%', marginTop: 4, fontFamily: 'var(--font-body)', fontSize: 13, padding: '7px 8px', border: '1px solid var(--border-dark)' }

  return (
    <>
      {/* Styled as a plain toolbar button so it sits with the others rather
          than announcing itself. */}
      <button className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        Bulk tracking
      </button>

      {open && (
        <div
          onClick={e => e.target === e.currentTarget && setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div style={{ background: 'var(--white)', width: '100%', maxWidth: 620, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 600 }}>Bulk shipment update</span>
                  {isSample && <SampleTag />}
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>
                  {isSample
                    ? 'Tracking for samples sent — the product’s own shipment is left alone.'
                    : 'Applies to every selected item. Blank fields are left untouched.'}
                </div>
              </div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--gray-light)' }}>✕</button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto' }}>
              {error && (
                <div style={{ padding: '8px 12px', background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 12, marginBottom: 16 }}>
                  {error}
                </div>
              )}

              {/* What's being shipped. One box of stone samples covering ten
                  materials is the case this exists for: pick Samples, select
                  the ten, paste the one tracking number. */}
              <div style={{ marginBottom: 20 }}>
                <span style={labelStyle}>Tracking for</span>
                <div style={{ display: 'flex', marginTop: 6 }}>
                  {[
                    { k: 'product', label: 'The product', icon: 'ti-package' },
                    { k: 'sample',  label: 'Samples sent', icon: 'ti-flask' },
                  ].map(opt => {
                    const on = kind === opt.k
                    return (
                      <button key={opt.k} onClick={() => setKind(opt.k)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
                          letterSpacing: '0.08em', textTransform: 'uppercase',
                          padding: '8px 16px', cursor: 'pointer',
                          border: `1px solid ${on ? 'var(--black)' : 'var(--border-dark)'}`,
                          background: on ? 'var(--black)' : 'transparent',
                          color: on ? 'var(--white)' : 'var(--gray)',
                          marginRight: -1,
                        }}>
                        <i className={`ti ${opt.icon}`} style={{ fontSize: 15 }} />
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                <label style={labelStyle}>
                  Stage
                  <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                    <option value="">— leave unchanged —</option>
                    {INTERNAL_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  Carrier
                  <select value={carrier} onChange={e => setCarrier(e.target.value)} style={inputStyle}>
                    <option value="">— leave unchanged —</option>
                    {CARRIERS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  {isSample ? 'Sample tracking number' : 'Tracking number'}
                  <input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} placeholder="Shared across selected items" style={inputStyle} />
                </label>
                <label style={labelStyle}>
                  ETA
                  <input type="date" value={eta} onChange={e => setEta(e.target.value)} style={inputStyle} />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Items <span style={{ color: 'var(--gray-light)', fontWeight: 400 }}>({selected.size} of {items.length} selected)</span>
                </div>
                <button onClick={selectAll}
                  style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '4px 10px', cursor: 'pointer', border: '1px solid var(--border-dark)', background: 'transparent', color: 'var(--gray)' }}>
                  {selected.size === items.length ? 'Clear all' : 'Select all'}
                </button>
              </div>

              <div style={{ border: '1px solid var(--border)', maxHeight: 260, overflowY: 'auto' }}>
                {items.map(item => {
                  const ap = approvals?.[`${category}|||${item.key}`] || {}
                  // Show the stage for whichever kind is being edited, so the
                  // list reflects the sample run you're updating, not the product.
                  const stage = getStage(readShipment(ap, kind).status)
                  const isSel = selected.has(item.key)
                  const name = item.name || item.description || (item.no ? `Door ${item.no}` : item.key)
                  return (
                    <label key={item.key}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isSel ? 'var(--cream)' : 'transparent' }}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(item.key)} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                      {stage && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--gray)', whiteSpace: 'nowrap' }}>
                          <i className={`ti ${stage.icon}`} style={{ color: stage.color, fontSize: 14 }} />
                          {stage.label}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setOpen(false)}
                style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 18px', cursor: 'pointer', border: '1px solid var(--border-dark)', background: 'transparent', color: 'var(--gray)' }}>
                Cancel
              </button>
              <button onClick={apply} disabled={saving}
                style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 18px', cursor: 'pointer', border: '1px solid var(--black)', background: 'var(--black)', color: 'var(--white)' }}>
                {saving ? 'Applying…' : `Apply to ${selected.size || ''} item${selected.size === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
// Icon-only stage indicator for collapsed rows — no label, no controls,
// so rows stay a single line tall. Full editing lives in the expanded panel.
// The sample rides along as a small flask beside the product icon, and only
// when a sample has actually been tracked, so untouched rows look unchanged.
export function ShipmentIcon({ approval }) {
  const stage = getStage(readShipment(approval, 'product').status)
  const sample = readShipment(approval, 'sample')
  const sampleStage = getStage(sample.status)
  const showSample = hasShipment(approval, 'sample')

  if (!stage && !showSample) return <span style={{ color: 'var(--border-dark)', fontSize: 16 }}>—</span>

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {stage
        ? <i className={`ti ${stage.icon}`} style={{ fontSize: 22, color: stage.color }} title={stage.label} />
        : <span style={{ color: 'var(--border-dark)', fontSize: 16 }}>—</span>}
      {showSample && (
        <span
          title={`Sample${sampleStage ? ` — ${sampleStage.label}` : ''}${sample.trackingNumber ? ` · ${sample.trackingNumber}` : ''}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            fontSize: 8, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '2px 5px', color: 'var(--gold)', background: 'var(--gold-pale)',
            border: '1px solid rgba(154,122,74,0.25)', whiteSpace: 'nowrap',
          }}>
          <i className={`ti ${sampleStage?.icon || 'ti-flask'}`} style={{ fontSize: 13, color: sampleStage?.color || 'var(--gold)' }} />
          Sample
        </span>
      )}
    </span>
  )
}

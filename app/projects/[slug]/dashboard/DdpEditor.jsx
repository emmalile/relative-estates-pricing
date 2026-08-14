'use client'

import { useState } from 'react'
import { unitSuffix } from '@/lib/pricing'

// ═══════════════════════════════════════════════════════
// DDP / SHIPPING EDITOR
// ═══════════════════════════════════════════════════════
// Freight is quoted per shipment, not per material: a container of stone
// lands with one cost that applies to every slab on it. The only place to
// enter it was inside an expanded row, one line at a time, which for a
// fifty-two line schedule is fifty-two expansions to type the same number.
//
// So: one field that fills every line, and a list underneath where any
// line that is different gets corrected. Both at once, because that is how
// the real number arrives — a rate for the container, and two slabs that
// came separately.
//
// Nothing is written until Save, and only the lines that actually changed
// are sent. A screen that silently rewrites fifty-two rows because it was
// opened is not a screen anyone can trust with a freight rate.
// ═══════════════════════════════════════════════════════

export default function DdpEditor({ projectId, category, categoryLabel, items, approvals, priceUnit, onClose, onSaved }) {
  // Seeded from what is stored, as strings: '' and '0' are different
  // answers here — one is "not entered", the other is "no freight".
  const [values, setValues] = useState(() => {
    const seed = {}
    ;(items || []).forEach(it => {
      const ap = approvals[`${category}|||${it.key}`]
      const v = ap?.shipping_ddp
      seed[it.key] = v === null || v === undefined || v === 0 || v === '0' ? '' : String(v)
    })
    return seed
  })
  const [applyAll, setApplyAll] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Whatever this category was actually quoted in — a stone schedule is
  // per square foot, a run of trim is per linear foot, and freight entered
  // against the wrong one is a wrong price, not a wrong label.
  const unit = unitSuffix(priceUnit || 'sqft')

  function fillAll() {
    const v = applyAll.trim()
    if (v === '') return
    const next = {}
    ;(items || []).forEach(it => { next[it.key] = v })
    setValues(next)
  }

  function changedEntries() {
    const out = {}
    ;(items || []).forEach(it => {
      const ap = approvals[`${category}|||${it.key}`]
      const before = ap?.shipping_ddp ? parseFloat(ap.shipping_ddp) : 0
      const raw = (values[it.key] ?? '').trim()
      const after = raw === '' ? 0 : parseFloat(raw)
      if (!Number.isFinite(after) || after < 0) return
      if (Math.abs(after - before) > 0.0001) out[it.key] = after
    })
    return out
  }

  async function save() {
    const changed = changedEntries()
    if (!Object.keys(changed).length) { onClose?.(); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/approvals/ddp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, category, values: changed }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Could not save the shipping rates.')
        return
      }
      await onSaved?.()
      onClose?.()
    } finally {
      setSaving(false)
    }
  }

  const changedCount = Object.keys(changedEntries()).length

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: 'var(--s-6) var(--s-6) var(--s-4)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 'var(--t-xl)', fontWeight: 500, letterSpacing: '-0.01em' }}>
            DDP / shipping
          </div>
          <div style={{ fontSize: 'var(--t-xs)', color: 'var(--gray)', marginTop: 'var(--s-1)' }}>
            {categoryLabel} · per {unit.replace('/', '')}, added to your cost before markup.
            Changing this does not change what the client already sees — release the price again for that.
          </div>
        </div>

        <div style={{ padding: 'var(--s-4) var(--s-6)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-end', gap: 'var(--s-3)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--t-xs)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gray)', marginBottom: 'var(--s-1)' }}>
              Set every line to
            </div>
            <input
              type="number" min="0" step="0.01" placeholder="0.00"
              value={applyAll}
              onChange={e => setApplyAll(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') fillAll() }}
              style={{ width: '100%', padding: 'var(--s-2) var(--s-3)', fontFamily: 'var(--font)', fontSize: 'var(--t-base)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--white)', color: 'var(--black)' }}
            />
          </div>
          <button className="btn btn-outline btn-sm" onClick={fillAll} disabled={applyAll.trim() === ''}>
            Apply to all {items?.length || 0}
          </button>
        </div>

        <div style={{ maxHeight: '46vh', overflowY: 'auto', padding: 'var(--s-2) var(--s-6)' }}>
          {(items || []).map(it => (
            <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--g100)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--t-sm)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.name || it.description || it.no}
                </div>
                {it.finish && <div style={{ fontSize: 'var(--t-xs)', color: 'var(--gray)' }}>{it.finish}</div>}
              </div>
              <input
                type="number" min="0" step="0.01" placeholder="0.00"
                value={values[it.key] ?? ''}
                onChange={e => setValues(v => ({ ...v, [it.key]: e.target.value }))}
                aria-label={`DDP for ${it.name || it.no}`}
                style={{ width: 110, padding: 'var(--s-1) var(--s-2)', fontFamily: 'var(--font)', fontSize: 'var(--t-base)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--white)', color: 'var(--black)' }}
              />
            </div>
          ))}
        </div>

        {error && (
          <div style={{ padding: 'var(--s-3) var(--s-6)', color: 'var(--danger)', fontSize: 'var(--t-sm)' }}>{error}</div>
        )}

        <div style={{ padding: 'var(--s-4) var(--s-6)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
          <div style={{ fontSize: 'var(--t-xs)', color: 'var(--gray)' }}>
            {changedCount === 0 ? 'No changes' : `${changedCount} line${changedCount === 1 ? '' : 's'} changed`}
          </div>
          <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
            <button className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-black btn-sm" onClick={save} disabled={saving || changedCount === 0}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

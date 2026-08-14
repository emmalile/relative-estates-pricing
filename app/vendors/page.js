'use client'

import { useState, useEffect, useMemo } from 'react'
import { allCategories } from '@/lib/categories'
import { formatRelativeTime } from '@/lib/utils'

// ═══════════════════════════════════════════════════════
// VENDORS — vendor repository
// ═══════════════════════════════════════════════════════
// Vendors are never hard-deleted. "Deactivate" sets deleted_at,
// which hides the vendor from active lists but preserves its
// products and any quote history that references it.

function categoryLabel(id) {
  return allCategories.find(c => c.id === id)?.label || id
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState([])
  const [inactiveVendors, setInactiveVendors] = useState([])
  const [productCounts, setProductCounts] = useState({})
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [openMenuId, setOpenMenuId] = useState(null)

  const [showNewModal, setShowNewModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  async function loadAll() {
    setLoading(true)
    const [activeRes, inactiveRes, productsRes] = await Promise.all([
      fetch('/api/vendors'),
      fetch('/api/vendors?archived_only=true'),
      fetch('/api/repository-products'),
    ])
    const active = activeRes.ok ? await activeRes.json() : []
    const inactive = inactiveRes.ok ? await inactiveRes.json() : []
    const products = productsRes.ok ? await productsRes.json() : []

    const counts = {}
    ;(products || []).forEach(p => {
      counts[p.vendor_id] = (counts[p.vendor_id] || 0) + 1
    })

    setVendors(active)
    setInactiveVendors(inactive)
    setProductCounts(counts)
    setLoading(false)
  }

  async function deactivateVendor(vendor) {
    const count = productCounts[vendor.id] || 0
    const warning = count > 0
      ? `\n\n${count} product${count === 1 ? '' : 's'} from this vendor will be hidden too. Nothing is deleted.`
      : ''
    if (!confirm(`Deactivate "${vendor.name}"?${warning}`)) return

    const res = await fetch(`/api/vendors/delete?id=${vendor.id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Failed to deactivate vendor. Please try again.'); return }
    setVendors(prev => prev.filter(v => v.id !== vendor.id))
    setInactiveVendors(prev => [{ ...vendor, deleted_at: new Date().toISOString() }, ...prev])
  }

  async function restoreVendor(vendor) {
    const res = await fetch(`/api/vendors/restore?id=${vendor.id}`, { method: 'POST' })
    if (!res.ok) { alert('Failed to reactivate vendor. Please try again.'); return }
    setInactiveVendors(prev => prev.filter(v => v.id !== vendor.id))
    setVendors(prev => [{ ...vendor, deleted_at: null }, ...prev])
  }

  const q = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!q) return vendors
    return vendors.filter(v =>
      v.name.toLowerCase().includes(q) ||
      (v.contact_name || '').toLowerCase().includes(q) ||
      (v.contact_email || '').toLowerCase().includes(q)
    )
  }, [vendors, q])

  const filteredInactive = useMemo(() => {
    if (!q) return inactiveVendors
    return inactiveVendors.filter(v => v.name.toLowerCase().includes(q))
  }, [inactiveVendors, q])

  return (
    <div className="shell">
      {/* ── SIDEBAR ── */}
      <aside className="side">
        <button className="side-new" onClick={() => setShowNewModal(true)}>
          <i className="ti ti-plus" /> <span>New vendor</span>
        </button>

        <ul className="side-nav">
          <li onClick={() => { window.location.href = '/' }}>
            <i className="ti ti-home" /> <span>Home</span>
          </li>
          <li onClick={() => { window.location.href = '/' }}>
            <i className="ti ti-building" /> <span>All projects</span>
          </li>
        </ul>

        <div className="side-sep" />
        <ul className="side-nav">
          <li className="active">
            <i className="ti ti-users" /> <span>Vendors</span>
          </li>
          <li onClick={() => { window.location.href = '/repository' }}>
            <i className="ti ti-package" /> <span>Repository</span>
          </li>
        </ul>

        <div className="side-storage">
          <span>{vendors.length} active vendor{vendors.length === 1 ? '' : 's'}</span>
          <div className="side-storage-bar">
            <div className="side-storage-fill" style={{ width: `${Math.min(100, vendors.length * 8 || 4)}%` }} />
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="main">
        <div className="topbar">
          <div className="topbar-logo">Relative <span>Estates</span></div>
          <div className="searchbar">
            <i className="ti ti-search" />
            <input
              type="text"
              placeholder="Search vendors by name, contact, or email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="topbar-right">
            <div className="avatar">E</div>
          </div>
        </div>

        <div className="content">
          <div className="file-controls">
            <div className="file-section">Vendors</div>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setShowInactive(s => !s)}
            >
              {showInactive ? 'Hide deactivated' : `Show deactivated (${inactiveVendors.length})`}
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '24px 0' }}><span className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 0 40px' }}>
              <div className="empty-state-title">
                {search ? `No vendors match "${search}"` : 'No vendors yet'}
              </div>
              <div className="empty-state-sub">
                {search
                  ? 'Try a different name, contact, or email'
                  : 'Add the manufacturers and suppliers you source from. Products and saved quotes attach to them.'}
              </div>
              {!search && (
                <button className="btn btn-black" onClick={() => setShowNewModal(true)}>Add Vendor</button>
              )}
            </div>
          ) : (
            <table className="ftable">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>Name</th>
                  <th>Categories</th>
                  <th>Contact</th>
                  <th style={{ textAlign: 'right' }}>Products</th>
                  <th>Added</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <VendorRow
                    key={v.id}
                    vendor={v}
                    productCount={productCounts[v.id] || 0}
                    menuOpen={openMenuId === v.id}
                    onToggleMenu={() => setOpenMenuId(openMenuId === v.id ? null : v.id)}
                    onEdit={() => { setEditTarget(v); setOpenMenuId(null) }}
                    onDeactivate={() => deactivateVendor(v)}
                  />
                ))}
              </tbody>
            </table>
          )}

          {showInactive && (
            <>
              <div className="section-header" style={{ marginTop: 32 }}>
                <i className="ti ti-archive" /> Deactivated vendors
              </div>
              {filteredInactive.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-title">No deactivated vendors</div>
                  <div className="empty-state-sub">
                    Vendors you deactivate show up here and can be reactivated anytime.
                  </div>
                </div>
              ) : (
                <table className="ftable">
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>Name</th>
                      <th>Categories</th>
                      <th style={{ textAlign: 'right' }}>Products</th>
                      <th>Deactivated</th>
                      <th style={{ width: 100 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInactive.map(v => (
                      <tr key={v.id} className="frow" style={{ cursor: 'default', opacity: 0.65 }}>
                        <td><span style={{ fontWeight: 500 }}>{v.name}</span></td>
                        <td className="fcat">
                          {(v.categories || []).length
                            ? (v.categories || []).map(categoryLabel).join(', ')
                            : '—'}
                        </td>
                        <td className="fprice" style={{ textAlign: 'right' }}>{productCounts[v.id] || 0}</td>
                        <td className="fcat">{formatRelativeTime(v.deleted_at)}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <button className="btn btn-outline btn-sm" onClick={() => restoreVendor(v)}>
                            Reactivate
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>

      {showNewModal && (
        <VendorModal
          onClose={() => setShowNewModal(false)}
          onSaved={(v) => { setVendors(prev => [v, ...prev]); setShowNewModal(false) }}
        />
      )}

      {editTarget && (
        <VendorModal
          vendor={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(v) => {
            setVendors(prev => prev.map(x => (x.id === v.id ? v : x)))
            setEditTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ── Vendor Row ────────────────────────────────────────────
function VendorRow({ vendor, productCount, menuOpen, onToggleMenu, onEdit, onDeactivate }) {
  const cats = vendor.categories || []
  const contact = vendor.contact_name || vendor.contact_email || vendor.contact_phone || '—'

  return (
    <tr className="frow" style={{ cursor: 'default' }}>
      <td>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <i className="ti ti-users" style={{ fontSize: 18, color: 'var(--g600)' }} />
          <span style={{ fontWeight: 500 }}>{vendor.name}</span>
        </span>
      </td>
      <td className="fcat">{cats.length ? cats.map(categoryLabel).join(', ') : '—'}</td>
      <td className="fcat">{contact}</td>
      <td className="fprice" style={{ textAlign: 'right' }}>{productCount}</td>
      <td className="fcat">{formatRelativeTime(vendor.created_at)}</td>
      <td onClick={e => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
          <button className="folder-menu" onClick={e => { e.stopPropagation(); onToggleMenu() }}>
            <i className="ti ti-dots-vertical" />
          </button>
          {menuOpen && (
            <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
              <button onClick={onEdit}>Edit vendor</button>
              {vendor.website && (
                <button onClick={() => window.open(vendor.website, '_blank', 'noopener')}>
                  Open website
                </button>
              )}
              <div className="menu-sep" />
              <button className="menu-danger" onClick={onDeactivate}>Deactivate vendor</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Vendor Modal (create + edit) ──────────────────────────
function VendorModal({ vendor, onClose, onSaved }) {
  const isEdit = Boolean(vendor)

  const [name, setName] = useState(vendor?.name || '')
  const [selectedCats, setSelectedCats] = useState(vendor?.categories || [])
  const [contactName, setContactName] = useState(vendor?.contact_name || '')
  const [contactEmail, setContactEmail] = useState(vendor?.contact_email || '')
  const [contactPhone, setContactPhone] = useState(vendor?.contact_phone || '')
  const [website, setWebsite] = useState(vendor?.website || '')
  const [notes, setNotes] = useState(vendor?.notes || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleCat(catId) {
    setSelectedCats(prev =>
      prev.includes(catId) ? prev.filter(c => c !== catId) : [...prev, catId]
    )
  }

  async function save() {
    if (!name.trim()) { setError('Vendor name is required'); return }

    setSaving(true)
    setError('')

    const payload = {
      name: name.trim(),
      categories: selectedCats,
      contactName: contactName.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim(),
      website: website.trim(),
      notes: notes.trim(),
    }

    const res = isEdit
      ? await fetch('/api/vendors/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: vendor.id, ...payload }),
        })
      : await fetch('/api/vendors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return
    }

    onSaved(data)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">{isEdit ? 'Edit Vendor' : 'New Vendor'}</div>
            <div style={{ fontSize: 12, color: 'var(--g600)', marginTop: 4 }}>
              {isEdit ? vendor.name : 'Manufacturer or supplier you source from'}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{
              padding: '10px 14px', background: 'var(--danger-bg)',
              border: '1px solid var(--danger)', borderRadius: 8, fontSize: 13,
              color: 'var(--danger)', marginBottom: 20,
            }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <label className="field-label">Vendor Name *</label>
            <input
              className="field-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Stone Source International"
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="field-label">Categories They Supply</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
              {allCategories.map(cat => {
                const selected = selectedCats.includes(cat.id)
                return (
                  <div
                    key={cat.id}
                    onClick={() => toggleCat(cat.id)}
                    style={{
                      padding: '10px 14px', borderRadius: 8,
                      border: `1px solid ${selected ? 'var(--black)' : 'var(--g200)'}`,
                      background: selected ? 'var(--black)' : 'var(--white)',
                      color: selected ? 'var(--white)' : 'var(--black)',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      fontSize: 13,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{ color: selected ? 'var(--white)' : 'var(--g500)' }}>{cat.icon}</span>
                    {cat.label}
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            <div>
              <label className="field-label">Contact Name</label>
              <input
                className="field-input"
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                placeholder="e.g. Marco Rossi"
              />
            </div>
            <div>
              <label className="field-label">Contact Phone</label>
              <input
                className="field-input"
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                placeholder="e.g. +39 055 123 4567"
              />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="field-label">Contact Email</label>
            <input
              className="field-input"
              value={contactEmail}
              onChange={e => setContactEmail(e.target.value)}
              placeholder="e.g. marco@stonesource.com"
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="field-label">Website</label>
            <input
              className="field-input"
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder="e.g. https://stonesource.com"
            />
          </div>

          <div>
            <label className="field-label">Notes</label>
            <textarea
              className="field-input"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Lead times, shipping terms, minimums, who to ask for…"
              rows={3}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-black btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Vendor'}
          </button>
        </div>
      </div>
    </div>
  )
}

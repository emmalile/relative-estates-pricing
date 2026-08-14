'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import ActionMenu from '@/app/components/ActionMenu'
import { allCategories } from '@/lib/categories'
import { formatCurrency, formatRelativeTime } from '@/lib/utils'

// ═══════════════════════════════════════════════════════
// REPOSITORY — product catalog
// ═══════════════════════════════════════════════════════
// Products belong to a vendor and are never hard-deleted.
// "Hide" sets deleted_at, which removes the product from
// active lists but preserves any saved quotes referencing it
// (quotes snapshot their own vendor/product name and cost).

function categoryLabel(id) {
  return allCategories.find(c => c.id === id)?.label || id
}

function categoryIcon(id) {
  return allCategories.find(c => c.id === id)?.icon || '◇'
}

export default function RepositoryPage() {
  const [products, setProducts] = useState([])
  const [hiddenProducts, setHiddenProducts] = useState([])
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState(null)
  const [activeVendor, setActiveVendor] = useState(null)
  const [showHidden, setShowHidden] = useState(false)
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
    const [activeRes, hiddenRes, vendorsRes] = await Promise.all([
      fetch('/api/repository-products'),
      fetch('/api/repository-products?archived_only=true'),
      fetch('/api/vendors'),
    ])
    setProducts(activeRes.ok ? await activeRes.json() : [])
    setHiddenProducts(hiddenRes.ok ? await hiddenRes.json() : [])
    setVendors(vendorsRes.ok ? await vendorsRes.json() : [])
    setLoading(false)
  }

  async function hideProduct(product) {
    if (!confirm(`Hide "${product.name}"?\n\nIt will be removed from active lists. Saved quotes that used it keep their own copy of the price, so nothing changes retroactively.`)) return
    const res = await fetch(`/api/repository-products/delete?id=${product.id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Failed to hide product. Please try again.'); return }
    setProducts(prev => prev.filter(p => p.id !== product.id))
    setHiddenProducts(prev => [{ ...product, deleted_at: new Date().toISOString() }, ...prev])
  }

  async function restoreProduct(product) {
    const res = await fetch(`/api/repository-products/restore?id=${product.id}`, { method: 'POST' })
    if (!res.ok) { alert('Failed to restore product. Please try again.'); return }
    const data = await res.json()
    setHiddenProducts(prev => prev.filter(p => p.id !== product.id))
    setProducts(prev => [data.product || { ...product, deleted_at: null }, ...prev])
  }

  const q = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    return products.filter(p => {
      if (activeCategory && p.category !== activeCategory) return false
      if (activeVendor && p.vendor_id !== activeVendor) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.vendor?.name || '').toLowerCase().includes(q)
      )
    })
  }, [products, activeCategory, activeVendor, q])

  // Categories that actually have products, for the sidebar filter
  const categoryCounts = useMemo(() => {
    const counts = {}
    products.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1 })
    return counts
  }, [products])

  const noVendors = !loading && vendors.length === 0

  return (
    <div className="shell">
      {/* ── SIDEBAR ── */}
      <aside className="side">
        <button
          className="side-new"
          onClick={() => setShowNewModal(true)}
          disabled={noVendors}
          title={noVendors ? 'Add a vendor first' : undefined}
        >
          <i className="ti ti-plus" /> <span>New product</span>
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
          <li onClick={() => { window.location.href = '/vendors' }}>
            <i className="ti ti-users" /> <span>Vendors</span>
          </li>
          <li className="active">
            <i className="ti ti-package" /> <span>Repository</span>
          </li>
        </ul>

        <div className="side-sep" />
        <div className="sidebar-cat-label">Categories</div>
        <ul className="side-nav sidebar-cat">
          <li className={!activeCategory ? 'active' : ''} onClick={() => setActiveCategory(null)}>
            <span className="cat-dot"><i className="ti ti-apps" /></span> <span>All categories</span>
          </li>
          {allCategories.filter(c => categoryCounts[c.id]).map(c => (
            <li key={c.id} className={activeCategory === c.id ? 'active' : ''} onClick={() => setActiveCategory(c.id)}>
              <span className="cat-dot">{c.icon}</span> <span>{c.label}</span>
              <span className="cat-count">{categoryCounts[c.id]}</span>
            </li>
          ))}
        </ul>

        <div className="side-storage">
          <span>{products.length} product{products.length === 1 ? '' : 's'}</span>
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
              placeholder="Search products by name, SKU, or vendor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="topbar-right">
            <ActionMenu
              trigger="avatar"
              initials="E"
              label="Account and settings"
              items={[
                { label: 'Dropbox settings', icon: 'ti-brand-dropbox', onClick: () => { window.location.href = '/settings/dropbox' } },
                { sep: true },
                { label: 'Sign out', onClick: async () => { await supabase.auth.signOut(); window.location.href = '/login' } },
              ]}
            />
          </div>
        </div>

        <div className="content">
          <div className="file-controls">
            <div className="file-section">
              {activeCategory ? `${categoryLabel(activeCategory)} products` : 'All products'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select
                className="field-input"
                style={{ width: 'auto', minWidth: 160, padding: '6px 10px', fontSize: 13 }}
                value={activeVendor || ''}
                onChange={e => setActiveVendor(e.target.value || null)}
              >
                <option value="">All vendors</option>
                {vendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              <button className="btn btn-outline btn-sm" onClick={() => setShowHidden(s => !s)}>
                {showHidden ? 'Hide hidden' : `Show hidden (${hiddenProducts.length})`}
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '24px 0' }}><span className="spinner" /></div>
          ) : noVendors ? (
            <div className="empty-state" style={{ padding: '32px 0 40px' }}>
              <div className="empty-state-title">Add a vendor first</div>
              <div className="empty-state-sub">
                Every product belongs to a vendor, so there's nothing to attach a product to yet.
              </div>
              <button className="btn btn-black" onClick={() => { window.location.href = '/vendors' }}>
                Go to Vendors
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 0 40px' }}>
              <div className="empty-state-title">
                {search ? `No products match "${search}"`
                  : activeCategory ? `No ${categoryLabel(activeCategory)} products`
                  : activeVendor ? 'No products from this vendor'
                  : 'No products yet'}
              </div>
              <div className="empty-state-sub">
                {search || activeCategory || activeVendor
                  ? 'Try clearing the filters or searching for something else.'
                  : 'Add the materials you source repeatedly. Saved quotes pull their pricing from here.'}
              </div>
              {!search && !activeCategory && !activeVendor && (
                <button className="btn btn-black" onClick={() => setShowNewModal(true)}>Add Product</button>
              )}
            </div>
          ) : (
            <table className="ftable">
              <thead>
                <tr>
                  <th style={{ width: '28%' }}>Product</th>
                  <th>Vendor</th>
                  <th>Category</th>
                  <th>SKU</th>
                  <th style={{ textAlign: 'right' }}>Unit cost</th>
                  <th>Updated</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    menuOpen={openMenuId === p.id}
                    onToggleMenu={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
                    onEdit={() => { setEditTarget(p); setOpenMenuId(null) }}
                    onHide={() => hideProduct(p)}
                  />
                ))}
              </tbody>
            </table>
          )}

          {showHidden && (
            <>
              <div className="section-header" style={{ marginTop: 32 }}>
                <i className="ti ti-archive" /> Hidden products
              </div>
              {hiddenProducts.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-title">No hidden products</div>
                  <div className="empty-state-sub">
                    Products you hide show up here and can be restored anytime.
                  </div>
                </div>
              ) : (
                <table className="ftable">
                  <thead>
                    <tr>
                      <th style={{ width: '28%' }}>Product</th>
                      <th>Vendor</th>
                      <th>Category</th>
                      <th style={{ textAlign: 'right' }}>Unit cost</th>
                      <th>Hidden</th>
                      <th style={{ width: 100 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {hiddenProducts.map(p => (
                      <tr key={p.id} className="frow" style={{ cursor: 'default', opacity: 0.65 }}>
                        <td><span style={{ fontWeight: 500 }}>{p.name}</span></td>
                        <td className="fcat">{p.vendor?.name || '—'}</td>
                        <td className="fcat">{categoryLabel(p.category)}</td>
                        <td className="fprice" style={{ textAlign: 'right' }}>
                          {formatCurrency(p.unit_cost)}<span className="fcat"> / {p.unit}</span>
                        </td>
                        <td className="fcat">{formatRelativeTime(p.deleted_at)}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <button className="btn btn-outline btn-sm" onClick={() => restoreProduct(p)}>
                            Restore
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
        <ProductModal
          vendors={vendors}
          onClose={() => setShowNewModal(false)}
          onSaved={(p) => { setProducts(prev => [p, ...prev]); setShowNewModal(false) }}
        />
      )}

      {editTarget && (
        <ProductModal
          product={editTarget}
          vendors={vendors}
          onClose={() => setEditTarget(null)}
          onSaved={(p) => {
            setProducts(prev => prev.map(x => (x.id === p.id ? p : x)))
            setEditTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ── Product Row ───────────────────────────────────────────
function ProductRow({ product, menuOpen, onToggleMenu, onEdit, onHide }) {
  const vendorHidden = Boolean(product.vendor?.deleted_at)

  return (
    <tr className="frow" style={{ cursor: 'default' }}>
      <td>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, color: 'var(--g600)' }}>{categoryIcon(product.category)}</span>
          <span style={{ fontWeight: 500 }}>{product.name}</span>
        </span>
      </td>
      <td className="fcat">
        {product.vendor?.name || '—'}
        {vendorHidden && (
          <span style={{ fontSize:12, color: 'var(--g500)' }}> (deactivated)</span>
        )}
      </td>
      <td className="fcat">{categoryLabel(product.category)}</td>
      <td className="fcat">{product.sku || '—'}</td>
      <td className="fprice" style={{ textAlign: 'right' }}>
        {formatCurrency(product.unit_cost)}<span className="fcat"> / {product.unit}</span>
      </td>
      <td className="fcat">{formatRelativeTime(product.updated_at)}</td>
      <td onClick={e => e.stopPropagation()}>
        <div style={{ position: 'relative' }}>
          <button className="folder-menu" onClick={e => { e.stopPropagation(); onToggleMenu() }}>
            <i className="ti ti-dots-vertical" />
          </button>
          {menuOpen && (
            <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
              <button onClick={onEdit}>Edit product</button>
              <div className="menu-sep" />
              <button className="menu-danger" onClick={onHide}>Hide product</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Product Modal (create + edit) ─────────────────────────
function ProductModal({ product, vendors, onClose, onSaved }) {
  const isEdit = Boolean(product)

  const [vendorId, setVendorId] = useState(product?.vendor_id || vendors[0]?.id || '')
  const [category, setCategory] = useState(product?.category || '')
  const [name, setName] = useState(product?.name || '')
  const [sku, setSku] = useState(product?.sku || '')
  const [description, setDescription] = useState(product?.description || '')
  const [unit, setUnit] = useState(product?.unit || 'sqft')
  const [unitCost, setUnitCost] = useState(product?.unit_cost ?? '')
  const [specs, setSpecs] = useState(() => {
    const entries = Object.entries(product?.specs || {})
    return entries.length ? entries.map(([k, v]) => ({ key: k, value: String(v) })) : [{ key: '', value: '' }]
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // The vendor's own categories are the sensible default list, but any
  // category is allowed — a vendor may supply something you didn't tag.
  const selectedVendor = vendors.find(v => v.id === vendorId)
  const vendorCats = selectedVendor?.categories || []
  const suggested = allCategories.filter(c => vendorCats.includes(c.id))
  const others = allCategories.filter(c => !vendorCats.includes(c.id))

  function setSpec(i, field, value) {
    setSpecs(prev => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)))
  }
  function addSpec() {
    setSpecs(prev => [...prev, { key: '', value: '' }])
  }
  function removeSpec(i) {
    setSpecs(prev => (prev.length === 1 ? [{ key: '', value: '' }] : prev.filter((_, idx) => idx !== i)))
  }

  // When the category changes on a NEW product, default the unit to that
  // category's natural quantity unit (sqm for stone, units for doors…).
  function pickCategory(catId) {
    setCategory(catId)
    if (!isEdit) {
      const def = allCategories.find(c => c.id === catId)
      if (def?.quantityUnit) setUnit(def.quantityUnit)
    }
  }

  async function save() {
    if (!vendorId) { setError('Pick a vendor'); return }
    if (!category) { setError('Pick a category'); return }
    if (!name.trim()) { setError('Product name is required'); return }

    setSaving(true)
    setError('')

    const specsObj = {}
    specs.forEach(s => {
      if (s.key.trim()) specsObj[s.key.trim()] = s.value.trim()
    })

    const payload = {
      vendorId,
      category,
      name: name.trim(),
      sku: sku.trim(),
      description: description.trim(),
      unit: unit.trim() || 'sqft',
      unitCost: parseFloat(unitCost) || 0,
      specs: specsObj,
    }

    const res = isEdit
      ? await fetch('/api/repository-products/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: product.id, ...payload }),
        })
      : await fetch('/api/repository-products', {
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
            <div className="modal-title">{isEdit ? 'Edit Product' : 'New Product'}</div>
            <div style={{ fontSize: 12, color: 'var(--g600)', marginTop: 4 }}>
              {isEdit ? product.name : 'A material you source repeatedly'}
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
            <label className="field-label">Vendor *</label>
            <select
              className="field-input"
              value={vendorId}
              onChange={e => setVendorId(e.target.value)}
            >
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="field-label">Category *</label>
            <select
              className="field-input"
              value={category}
              onChange={e => pickCategory(e.target.value)}
            >
              <option value="">Select a category…</option>
              {suggested.length > 0 && (
                <optgroup label="This vendor's categories">
                  {suggested.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label={suggested.length > 0 ? 'Other categories' : 'All categories'}>
                {others.map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="field-label">Product Name *</label>
            <input
              className="field-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Calacatta Gold — Honed"
              autoFocus
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 20 }}>
            <div>
              <label className="field-label">SKU</label>
              <input
                className="field-input"
                value={sku}
                onChange={e => setSku(e.target.value)}
                placeholder="e.g. CG-H-3CM"
              />
            </div>
            <div>
              <label className="field-label">Unit Cost (USD)</label>
              <input
                className="field-input"
                type="number"
                step="0.01"
                value={unitCost}
                onChange={e => setUnitCost(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="field-label">Unit</label>
              <input
                className="field-input"
                value={unit}
                onChange={e => setUnit(e.target.value)}
                placeholder="sqft"
              />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="field-label">Description</label>
            <textarea
              className="field-input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What this material is, where it's typically used…"
              rows={2}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          <div>
            <label className="field-label">Specs</label>
            <div style={{ fontSize: 12, color: 'var(--g600)', marginBottom: 10 }}>
              Optional detail pairs — finish, cut, thickness, lead time, whatever matters for this material.
            </div>
            {specs.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input
                  className="field-input"
                  style={{ flex: '0 0 34%' }}
                  value={s.key}
                  onChange={e => setSpec(i, 'key', e.target.value)}
                  placeholder="Finish"
                />
                <input
                  className="field-input"
                  style={{ flex: 1 }}
                  value={s.value}
                  onChange={e => setSpec(i, 'value', e.target.value)}
                  placeholder="Honed"
                />
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => removeSpec(i)}
                  title="Remove"
                  style={{ flex: '0 0 auto' }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button className="btn btn-outline btn-sm" onClick={addSpec}>+ Add spec</button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-black btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
          </button>
        </div>
      </div>
    </div>
  )
}

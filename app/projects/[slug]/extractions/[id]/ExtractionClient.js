'use client'

import { useState, useEffect } from 'react'
import { getCategory } from '@/lib/categories'
import SignOutButton from '@/app/components/SignOutButton'

// Reviewing what Claude read out of a supplier document.
//
// Every row starts pending. Nothing reaches the schedule until it is approved
// and the extraction is applied, and the values stay editable up to that
// point — the model's reading is a first draft, and the reviewer's copy is
// the one that counts.

export default function ExtractionClient({ slug, id }) {
  const [extraction, setExtraction] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dirty, setDirty] = useState(false)
  const [manufacturer, setManufacturer] = useState('')
  const [needsManufacturer, setNeedsManufacturer] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/extractions/${encodeURIComponent(id)}`)
    const d = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { setError(d.error || 'Could not load this extraction.'); return }
    setExtraction(d.extraction)
    setItems(d.extraction.items || [])
  }

  const category = extraction ? getCategory(extraction.category) : null
  const fields = category ? Object.keys(category.csvColumns) : []
  const editable = extraction?.status === 'reviewing'

  const approved = items.filter(i => i.status === 'approved').length
  const rejected = items.filter(i => i.status === 'rejected').length
  const pending = items.length - approved - rejected

  function setStatus(itemId, status) {
    setItems(prev => prev.map(i => (i.id === itemId ? { ...i, status } : i)))
    setDirty(true)
  }

  function setAll(status) {
    setItems(prev => prev.map(i => ({ ...i, status })))
    setDirty(true)
  }

  function editField(itemId, field, value) {
    setItems(prev => prev.map(i =>
      i.id === itemId ? { ...i, fields: { ...i.fields, [field]: value } } : i
    ))
    setDirty(true)
  }

  async function save() {
    setBusy(true); setError(''); setNotice('')
    const res = await fetch(`/api/extractions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error || 'Could not save.'); return false }
    setDirty(false)
    setNotice('Review saved.')
    return true
  }

  async function apply() {
    if (!approved) { setError('Approve at least one item first.'); return }
    // Apply reads the stored copy, so unsaved edits have to land first or the
    // schedule would get the values as Claude read them, not as reviewed.
    if (dirty && !(await save())) return

    setBusy(true); setError(''); setNotice('')
    const res = await fetch(`/api/extractions/${encodeURIComponent(id)}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manufacturer }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      if (d.needsManufacturer) setNeedsManufacturer(true)
      setError(d.error || 'Could not add these to the schedule.')
      return
    }
    setNotice(
      `Added ${d.added} item${d.added === 1 ? '' : 's'} to the ${category.label} schedule` +
      (d.skipped ? `, skipped ${d.skipped} already on it` : '') + '.'
    )
    load()
  }

  async function discard() {
    if (!confirm('Discard this extraction?\n\nThe proposed items are dropped. The document in Dropbox is untouched, and you can extract it again.')) return
    setBusy(true)
    await fetch(`/api/extractions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'discarded' }),
    })
    setBusy(false)
    load()
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div className="app-header" style={{ height:64, borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 40px', background:'var(--white)', gap:20 }}>
        <button onClick={() => window.location.href = `/projects/${slug}/files`}
          style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:12, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase' }}>Files</span>
        </button>
        <div style={{ fontSize:'var(--t-lg)', fontWeight:500, letterSpacing:'-0.01em', flex:1 }}>
          Relative <span style={{ color:'var(--g600)', fontWeight:400 }}>Estates</span>
        </div>
        <SignOutButton compact />
      </div>

      <div className="page-body" style={{ padding:'40px 48px 100px' }}>
        {loading ? <div className="spinner" /> : !extraction ? (
          <div className="empty-state"><div className="empty-state-title">{error || 'Not found'}</div></div>
        ) : (
          <>
            <div className="page-eyebrow">Extraction · {category?.label || extraction.category}</div>
            <div className="page-title" style={{ marginBottom:8 }}>{extraction.source_name}</div>
            <div style={{ fontSize:12, color:'var(--gray)', marginBottom:24, lineHeight:1.7, maxWidth:720 }}>
              Read from <code style={{ wordBreak:'break-all' }}>{extraction.source_path}</code>.
              Check each row against the document before approving it — nothing here changes
              the schedule until you add the approved rows.
            </div>

            {extraction.status !== 'reviewing' && (
              <div style={{ padding:'12px 16px', border:'1px solid var(--border)', background:'var(--white)', fontSize:12, marginBottom:20 }}>
                This extraction is <strong>{extraction.status}</strong>
                {extraction.applied_at ? ` — added to the schedule ${new Date(extraction.applied_at).toLocaleString()}` : ''}.
                It is read-only now.
              </div>
            )}

            {extraction.error && (
              <div style={{ padding:'12px 16px', background:'var(--danger-bg)', border:'1px solid var(--danger)', color:'var(--danger)', fontSize:12, marginBottom:20, lineHeight:1.6 }}>
                {extraction.error}
              </div>
            )}

            {extraction.notes && (
              <div style={{ padding:'14px 16px', border:'1px solid var(--black)', background:'var(--white)', fontSize:12, marginBottom:20, lineHeight:1.7 }}>
                <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:6 }}>
                  Flagged while reading
                </div>
                {extraction.notes}
              </div>
            )}

            {error && (
              <div style={{ padding:'12px 16px', background:'var(--danger-bg)', border:'1px solid var(--danger)', color:'var(--danger)', fontSize:12, marginBottom:20 }}>{error}</div>
            )}
            {notice && (
              <div style={{ padding:'12px 16px', background:'var(--success-bg)', border:'1px solid var(--success)', color:'var(--success)', fontSize:12, marginBottom:20 }}>{notice}</div>
            )}

            {items.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No line items found</div>
                <div className="empty-state-sub">Claude did not find any {category?.label.toLowerCase()} items in this document.</div>
              </div>
            ) : (
              <>
                <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', marginBottom:14 }}>
                  <span style={{ fontSize:12, color:'var(--gray)' }}>
                    {items.length} proposed · <strong style={{ color:'var(--success)' }}>{approved} approved</strong>
                    {' · '}{pending} pending{rejected ? ` · ${rejected} rejected` : ''}
                  </span>
                  {editable && (
                    <>
                      <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setAll('approved')}>Approve all</button>
                      <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setAll('rejected')}>Reject all</button>
                      <button className="btn btn-outline btn-sm" disabled={busy || !dirty} onClick={save}>Save review</button>
                    </>
                  )}
                </div>

                <div className="table-scroll" style={{ overflowX:'auto', border:'1px solid var(--border)', background:'var(--white)' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ ...th, width:150 }}>Decision</th>
                        {fields.map(f => <th key={f} style={th}>{f}</th>)}
                        <th style={th}>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.id} style={{
                          background: item.status === 'approved' ? 'var(--success-bg)'
                            : item.status === 'rejected' ? 'var(--off-white)' : 'transparent',
                          opacity: item.status === 'rejected' ? 0.55 : 1,
                        }}>
                          <td style={{ ...td, whiteSpace:'nowrap' }}>
                            {editable ? (
                              <div style={{ display:'flex', gap:6 }}>
                                <button className="btn btn-sm"
                                  onClick={() => setStatus(item.id, item.status === 'approved' ? 'pending' : 'approved')}
                                  style={{
                                    padding:'4px 10px', fontSize:12,
                                    background: item.status === 'approved' ? 'var(--success)' : 'transparent',
                                    color: item.status === 'approved' ? 'var(--white)' : 'var(--success)',
                                    border:'1px solid var(--success)',
                                  }}>Keep</button>
                                <button className="btn btn-sm"
                                  onClick={() => setStatus(item.id, item.status === 'rejected' ? 'pending' : 'rejected')}
                                  style={{
                                    padding:'4px 10px', fontSize:12,
                                    background: item.status === 'rejected' ? 'var(--danger)' : 'transparent',
                                    color: item.status === 'rejected' ? 'var(--white)' : 'var(--danger)',
                                    border:'1px solid var(--danger)',
                                  }}>Drop</button>
                              </div>
                            ) : (
                              <span style={{ fontSize:12, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--gray-light)' }}>
                                {item.status}
                              </span>
                            )}
                          </td>
                          {fields.map(f => (
                            <td key={f} style={{ ...td, padding:'6px 8px' }}>
                              {editable ? (
                                <input
                                  className="field-input"
                                  value={item.fields?.[f] ?? ''}
                                  onChange={e => editField(item.id, f, e.target.value)}
                                  style={{ minWidth:110, fontSize:12, padding:'6px 8px' }}
                                />
                              ) : (
                                <span style={{ fontSize:12 }}>{item.fields?.[f] || '—'}</span>
                              )}
                            </td>
                          ))}
                          <td style={{ ...td, fontSize:12, color:'var(--gray-light)', whiteSpace:'nowrap' }}>
                            {item.sourceLocation || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {editable && (
                  <div style={{ marginTop:24, paddingTop:20, borderTop:'1px solid var(--border)', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                    {needsManufacturer && (
                      <input className="field-input" value={manufacturer}
                        onChange={e => setManufacturer(e.target.value)}
                        placeholder="Manufacturer name"
                        style={{ maxWidth:240 }} />
                    )}
                    <button className="btn btn-black btn-sm" disabled={busy || !approved} onClick={apply}>
                      Add {approved} approved item{approved === 1 ? '' : 's'} to the {category?.label} schedule
                    </button>
                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={discard}
                      style={{ color:'var(--danger)', borderColor:'var(--danger)' }}>Discard</button>
                    {dirty && <span style={{ fontSize:12, color:'var(--gray-light)' }}>Unsaved changes</span>}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const th = {
  padding:'11px 12px', textAlign:'left', fontSize:12, fontWeight:600,
  letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)',
  borderBottom:'1px solid var(--border)', whiteSpace:'nowrap',
}
const td = { padding:'10px 12px', borderBottom:'1px solid var(--border)', verticalAlign:'middle', fontSize:13 }

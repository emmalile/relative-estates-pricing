'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
import { getCategory } from '@/lib/categories'
import { formatCurrency } from '@/lib/utils'
import { toClientStage, formatEta, CARRIERS } from '@/lib/shipment'
import SignOutButton from '@/app/components/SignOutButton'

// Client-facing view of the material schedule.
//
// This page deliberately does NOT query Supabase. It used to, which meant
// the browser was sent raw manufacturer pricing and approval rows in order
// to compute prices locally — your cost, your margin and your internal
// notes all sat in the network response, whether or not they were rendered.
//
// Everything now comes from /api/client-view/[slug], which does that math on
// the server and returns finished prices only. The client's own notes are
// still writable; nothing else is.
export default function ClientDashboard({ params }) {
  const { slug } = params
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeCategory, setActiveCategory] = useState(null)
  const [lightbox, setLightbox] = useState(null) // { images: [], index: 0 }

  useEffect(() => { loadAll() }, [slug])

  async function loadAll() {
    setLoading(true)
    const res = await fetch(`/api/client-view/${encodeURIComponent(slug)}`)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not load this project.')
      setLoading(false)
      return
    }
    const payload = await res.json()
    setData(payload)
    setActiveCategory(prev => prev || payload.categories[0]?.id || null)
    setLoading(false)
  }

  async function saveClientNote(category, itemKey, clientNotes) {
    // Optimistic — the note is the one thing on this page a client owns.
    setData(prev => !prev ? prev : {
      ...prev,
      categories: prev.categories.map(c => c.id !== category ? c : {
        ...c,
        items: c.items.map(it => it.key === itemKey ? { ...it, clientNotes } : it),
      }),
    })
    await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug: slug, category, itemKey, clientNotes }),
    })
  }

  if (loading) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}><div className="spinner" /></div>
  if (error) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:40 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:32, marginBottom:10 }}>Not available</div>
        <div style={{ fontSize:13, color:'var(--gray)' }}>{error}</div>
      </div>
    </div>
  )
  if (!data) return null

  const { project, categories, totals: t } = data
  const pct = t.totalItems > 0 ? Math.round((t.approved / t.totalItems) * 100) : 0
  const activeCat = categories.find(c => c.id === activeCategory)
  const activeCatDef = getCategory(activeCategory)

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      {/* TOP BAR */}
      <div style={{ position:'sticky', top:0, zIndex:200, background:'rgba(247,245,240,0.97)', backdropFilter:'blur(12px)', borderBottom:'1px solid var(--border)', height:64, display:'flex', alignItems:'center', padding:'0 40px' }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, letterSpacing:'0.06em', flexShrink:0, marginRight:24 }}>
          Relative <span style={{ color:'var(--gold)' }}>Estates</span>
        </div>
        <div style={{ width:1, height:24, background:'var(--border)', marginRight:20, flexShrink:0 }} />
        <div style={{ fontSize:13, fontWeight:500, color:'var(--gray)', flex:1 }}>{project.name}</div>
        <div style={{ marginRight:24, flexShrink:0, textAlign:'right' }}>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:1 }}>Total</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:300, color:'var(--gold)', lineHeight:1 }}>{t.total > 0 ? formatCurrency(t.total) : '—'}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0, marginRight:20 }}>
          <div style={{ width:100, height:2, background:'var(--border)', borderRadius:1, overflow:'hidden' }}>
            <div style={{ height:'100%', background:'var(--black)', width:`${pct}%`, borderRadius:1, transition:'width 0.5s' }} />
          </div>
          <div style={{ fontSize:11, fontWeight:500, color:'var(--gray)', whiteSpace:'nowrap' }}>{t.approved} / {t.totalItems} approved</div>
        </div>
        <SignOutButton compact />
      </div>

      {/* HERO */}
      <div style={{ padding:'48px 56px 36px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:32 }}>
        <div>
          <div className="page-eyebrow">Material Selection</div>
          <div className="page-title">{project.name.split(' ').slice(0,2).join(' ')}<br/><em>{project.name.split(' ').slice(2).join(' ') || project.client}</em></div>
          <div style={{ fontSize:13, fontWeight:400, color:'var(--gray)', marginTop:12, lineHeight:1.6 }}>
            {t.totalItems} total line items · {categories.length} categories
          </div>
        </div>
        <div style={{ display:'flex', border:'1px solid var(--border)', flexWrap:'wrap' }}>
          {[
            { val:t.totalItems, label:'Total Items' },
            { val:t.approved, label:'Approved', color:'var(--success)' },
            { val:t.rejected, label:'Rejected', color:'var(--danger)' },
            { val:t.total > 0 ? formatCurrency(t.total) : '—', label:'Total', color:'var(--gold)', sm:true },
          ].map((s,i,arr) => (
            <div key={i} style={{ padding:'16px 24px', textAlign:'center', borderRight:i<arr.length-1?'1px solid var(--border)':'none' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:s.sm?22:32, fontWeight:200, color:s.color||'var(--black)', lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginTop:5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CATEGORY TABS */}
      <div style={{ position:'sticky', top:64, zIndex:100, background:'var(--white)', borderBottom:'1px solid var(--border)', overflowX:'auto' }}>
        <div style={{ display:'flex', minWidth:'max-content' }}>
          {categories.map(cat => {
            const catDef = getCategory(cat.id)
            let catApproved = 0, catTotal = 0
            cat.items.forEach(it => {
              if (it.status === 'approved') catApproved++
              if (it.status !== 'rejected' && it.total) catTotal += it.total
            })
            const isActive = activeCategory === cat.id
            return (
              <div key={cat.id} onClick={() => setActiveCategory(cat.id)} style={{ padding:'14px 28px', cursor:'pointer', borderBottom:isActive?'2px solid var(--black)':'2px solid transparent', background:isActive?'var(--off-white)':'transparent', transition:'all 0.15s', minWidth:160 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                  <span style={{ fontSize:14, color:isActive?'var(--gold)':'var(--gray-light)' }}>{catDef?.icon}</span>
                  <span style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:isActive?'var(--black)':'var(--gray)' }}>{catDef?.label || cat.id}</span>
                </div>
                <div style={{ fontSize:11, fontWeight:400, color:'var(--gray-light)' }}>
                  {catApproved}/{cat.items.length} approved{catTotal > 0 ? ` · ${formatCurrency(catTotal)}` : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* CATEGORY DETAIL */}
      <div style={{ padding:'0 40px 80px' }}>
        {activeCat && activeCatDef ? (
          <ClientCategoryDetail
            category={activeCatDef}
            items={activeCat.items}
            onNoteChange={(itemKey, notes) => saveClientNote(activeCat.id, itemKey, notes)}
            onOpenLightbox={(images, index) => setLightbox({ images, index })}
          />
        ) : (
          <div className="empty-state"><div className="empty-state-title">No materials yet</div><div className="empty-state-sub">Check back once your team has uploaded a schedule for this category.</div></div>
        )}
      </div>

      {/* LIGHTBOX */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div onClick={e => e.stopPropagation()} style={{ position:'relative', maxWidth:900, width:'100%' }}>
            <img src={lightbox.images[lightbox.index].url} alt="" style={{ width:'100%', maxHeight:'80vh', objectFit:'contain', display:'block' }}/>
            <div style={{ position:'absolute', top:-40, right:0, display:'flex', gap:12, alignItems:'center' }}>
              <span style={{ fontSize:11, color:'rgba(255,255,255,0.5)' }}>{lightbox.index+1} / {lightbox.images.length}</span>
              <button onClick={() => setLightbox(null)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:24, cursor:'pointer', lineHeight:1 }}>✕</button>
            </div>
            {lightbox.images.length > 1 && (
              <>
                <button onClick={() => setLightbox(l => ({ ...l, index: (l.index - 1 + l.images.length) % l.images.length }))}
                  style={{ position:'absolute', left:-48, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:28, cursor:'pointer' }}>‹</button>
                <button onClick={() => setLightbox(l => ({ ...l, index: (l.index + 1) % l.images.length }))}
                  style={{ position:'absolute', right:-48, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:28, cursor:'pointer' }}>›</button>
              </>
            )}
            <div style={{ display:'flex', gap:6, marginTop:10, justifyContent:'center', flexWrap:'wrap' }}>
              {lightbox.images.map((img, idx) => (
                <img key={idx} src={img.url} alt="" onClick={() => setLightbox(l => ({ ...l, index: idx }))}
                  style={{ width:48, height:48, objectFit:'cover', cursor:'pointer', border:`2px solid ${idx===lightbox.index?'white':'transparent'}`, opacity:idx===lightbox.index?1:0.5, transition:'all 0.15s' }}/>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <div style={{ borderTop:'2px solid var(--black)', padding:'40px 56px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:24, background:'var(--off-white)' }}>
        <div style={{ display:'flex', gap:0, flexWrap:'wrap' }}>
          {[
            { val:t.totalItems, label:'Total Materials' },
            { val:t.approved, label:'Approved', color:'var(--success)' },
            { val:t.rejected, label:'Rejected', color:'var(--danger)' },
            { val:t.total > 0 ? formatCurrency(t.total) : '—', label:'Total', color:'var(--gold)' },
          ].map((s,i,arr) => (
            <div key={i} style={{ paddingRight:40, marginRight:40, borderRight:i<arr.length-1?'1px solid var(--border)':'none' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:36, fontWeight:200, color:s.color||'var(--black)', lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginTop:5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Client Category Detail Table ───────────────────────────
// Collapsed rows show only: material, shipment, approval, total.
// Everything else lives in the expanded panel.
function ClientCategoryDetail({ category, items, onNoteChange, onOpenLightbox }) {
  const isDoors = category.id === 'doors'
  const [expanded, setExpanded] = useState(new Set())

  function toggle(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const allExpanded = expanded.size === items.length && items.length > 0
  function toggleAll() {
    setExpanded(allExpanded ? new Set() : new Set(items.map(it => it.key)))
  }

  function displayName(item) {
    if (isDoors) return item.description || item.location || (item.no ? `Door ${item.no}` : item.key)
    return item.name || item.key
  }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'24px 0 16px', borderBottom:'2px solid var(--black)', flexWrap:'wrap', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:13, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' }}>{category.label} Schedule</span>
          <span style={{ fontSize:12, fontWeight:400, color:'var(--gray-light)' }}>{items.length} items</span>
        </div>
        <button onClick={toggleAll}
          style={{ fontFamily:'var(--font-body)', fontSize:10, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', padding:'7px 16px', cursor:'pointer', border:'1px solid var(--border-dark)', background:'transparent', color:'var(--gray)' }}>
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={th('280px')}>Material</th>
              <th style={th('150px')}>Shipment</th>
              <th style={th('110px')}>Approval</th>
              <th style={th('130px')}>Total</th>
              <th style={th('40px')}></th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => {
              const isOpen = expanded.has(item.key)
              const rowBg = item.status==='approved' ? 'var(--success-bg)'
                          : item.status==='rejected' ? 'var(--danger-bg)' : 'transparent'

              return (
                <Fragment key={item.key}>
                  {/* ── Collapsed summary row ── */}
                  <tr onClick={() => toggle(item.key)}
                    style={{ background:rowBg, opacity:item.status==='rejected'?0.6:1, cursor:'pointer' }}>
                    <td style={td()}>
                      <div style={{ fontSize:14, fontWeight:600, color:'var(--black)' }}>{displayName(item)}</div>
                      {!isDoors && item.finish && (
                        <div style={{ fontFamily:'var(--font-display)', fontSize:12, fontStyle:'italic', color:'var(--gold)', marginTop:2 }}>{item.finish}</div>
                      )}
                    </td>
                    <td style={td()}><ClientShipmentBadge shipment={item.shipment} compact /></td>
                    <td style={td()}><ApprovalMark status={item.status} /></td>
                    <td style={td()}>
                      <div style={{ fontSize:16, fontWeight:600, color:'var(--gold)', whiteSpace:'nowrap' }}>{item.total ? formatCurrency(item.total) : '—'}</div>
                    </td>
                    <td style={td()}>
                      <span style={{ fontSize:14, color:'var(--gray-light)', display:'inline-block', transform:isOpen?'rotate(180deg)':'none', transition:'transform 0.2s' }}>▾</span>
                    </td>
                  </tr>

                  {/* ── Expanded detail ── */}
                  {isOpen && (
                    <tr style={{ background:'var(--cream)' }}>
                      <td colSpan={5} style={{ padding:'0 14px 18px' }}>
                        <div style={{ background:'var(--white)', border:'1px solid var(--border)', padding:'18px 20px' }}>
                          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:18 }}>
                            {isDoors ? (
                              <>
                                <Field label="Door No" value={item.no || '—'} />
                                <Field label="Location" value={item.location || (item.locations||[])[0] || '—'} />
                                <Field label="Size" value={item.widthInches && item.heightInches ? `${item.widthInches}" × ${item.heightInches}"` : '—'} />
                                <Field label="Door Type" value={item.type || '—'} />
                                <Field label="Unit Price" value={item.unitPrice != null ? formatCurrency(item.unitPrice) : '—'} />
                              </>
                            ) : (
                              <>
                                <Field label="Finish" value={item.finish || '—'} />
                                <Field label="Cut" value={item.cut || '—'} />
                                <Field label="Locations" value={(item.locations||[]).join(', ') || '—'} />
                                <Field label="Price / sqft" value={item.unitPrice != null ? `$${item.unitPrice.toFixed(2)}` : '—'} />
                              </>
                            )}

                            <Field label={`Qty ${isDoors ? '' : '(sqft)'}`} value={String(item.quantity || 0)} />
                            <Field label="Total" value={item.total ? formatCurrency(item.total) : '—'} />
                          </div>

                          {/* Shipment detail — full badge with carrier, tracking link, ETA */}
                          <div style={{ marginTop:16 }}>
                            <div style={fdLabel}>Shipment</div>
                            <ClientShipmentBadge shipment={item.shipment} />
                          </div>

                          {/* Images */}
                          {item.images?.length > 0 && (
                            <div style={{ marginTop:16 }}>
                              <div style={fdLabel}>Images</div>
                              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                                {item.images.map((img, idx) => (
                                  <img key={idx} src={img.url} alt=""
                                    onClick={e => { e.stopPropagation(); onOpenLightbox(item.images, idx) }}
                                    style={{ width:56, height:56, objectFit:'cover', border:'1px solid var(--border)', cursor:'pointer' }} />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Notes */}
                          <div style={{ marginTop:16 }} onClick={e => e.stopPropagation()}>
                            <div style={fdLabel}>Your notes</div>
                            <ClientNoteInput itemKey={item.key} initialValue={item.clientNotes || ''} onSave={onNoteChange} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const fdLabel = { fontSize:9, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:4 }

function Field({ label, value }) {
  return (
    <div>
      <div style={fdLabel}>{label}</div>
      <div style={{ fontSize:13, color:'var(--black)' }}>{value}</div>
    </div>
  )
}

// Green check when approved, red X when rejected, neutral dot while under review.
// Deliberately not a red X for "under review" — that would read to a client as
// though you'd rejected their material when it simply hasn't been actioned yet.
function ApprovalMark({ status }) {
  if (status === 'approved') return <i className="ti ti-circle-check" style={{ fontSize:22, color:'var(--success)' }} title="Approved" />
  if (status === 'rejected') return <i className="ti ti-circle-x" style={{ fontSize:22, color:'var(--danger)' }} title="Rejected" />
  return <i className="ti ti-circle-dashed" style={{ fontSize:22, color:'var(--gray-light)' }} title="Under review" />
}

// Client-facing shipment stage. Routes through toClientStage() so internal-only
// stages ("In production", "Pending approval") can never leak — they collapse
// to "Processing". Carrier and tracking number ARE shown to the client.
function ClientShipmentBadge({ shipment, compact }) {
  const stage = toClientStage(shipment?.status)
  if (!stage) return <span style={{ fontSize:12, color:'var(--gray-light)' }}>—</span>

  if (compact) return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:'var(--gray)', whiteSpace:'nowrap' }}>
      <i className={`ti ${stage.icon}`} style={{ color:stage.color, fontSize:18 }} />
      {stage.label}
    </span>
  )

  const carrierLabel = shipment?.carrier
    ? (CARRIERS.find(c => c.id === shipment.carrier)?.label || shipment.carrier)
    : null

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
      <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12, color:'var(--gray)', whiteSpace:'nowrap' }}>
        <i className={`ti ${stage.icon}`} style={{ color:stage.color, fontSize:16 }} />
        {stage.label}
      </span>
      {carrierLabel && <span style={{ fontSize:11, color:'var(--gray-light)' }}>{carrierLabel}</span>}
      {shipment?.trackingNumber && (
        shipment?.trackingUrl ? (
          <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize:11, color:'var(--s-transit)', textDecoration:'underline', textUnderlineOffset:2, wordBreak:'break-all' }}>
            {shipment.trackingNumber}
          </a>
        ) : (
          <span style={{ fontSize:11, color:'var(--gray-light)', wordBreak:'break-all' }}>{shipment.trackingNumber}</span>
        )
      )}
      {shipment?.eta && <span style={{ fontSize:11, color:'var(--gray-light)' }}>ETA {formatEta(shipment.eta)}</span>}
    </div>
  )
}

// Debounced note input
function ClientNoteInput({ itemKey, initialValue, onSave }) {
  const [value, setValue] = useState(initialValue)
  const timer = useRef(null)

  useEffect(() => { setValue(initialValue) }, [initialValue])

  function handleChange(e) {
    const v = e.target.value
    setValue(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onSave(itemKey, v), 900)
  }

  function handleBlur(e) {
    e.target.style.borderBottomColor = 'transparent'
    clearTimeout(timer.current)
    onSave(itemKey, value)
  }

  return (
    <textarea
      value={value}
      onChange={handleChange}
      onFocus={e => e.target.style.borderBottomColor = 'var(--border)'}
      onBlur={handleBlur}
      placeholder="Leave a note for the team…"
      rows={2}
      style={{ width:'100%', padding:'5px 0', fontFamily:'var(--font-body)', fontSize:12, fontWeight:400, background:'transparent', border:'none', borderBottom:'1px solid transparent', color:'var(--gray)', resize:'none', transition:'border-color 0.2s' }}
    />
  )
}

function th(minWidth) {
  return {
    padding:'11px 14px', textAlign:'left', fontSize:9, fontWeight:600,
    letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)',
    background:'var(--off-white)', borderBottom:'2px solid var(--border)',
    borderTop:'1px solid var(--border)',
    whiteSpace:'nowrap', minWidth,
  }
}
function td() {
  return { padding:'14px 14px', borderBottom:'1px solid var(--border)', verticalAlign:'middle', fontWeight:400, fontSize:13 }
}

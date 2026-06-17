'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { getCategory } from '@/lib/categories'
import { formatCurrency } from '@/lib/utils'

const SQM_TO_SQFT = 10.7639
const MARKUP_RATE = 1.2

// Client-facing view of the material schedule. Same shape as the internal
// owner dashboard, but it never surfaces material cost, shipping, your-cost,
// or profit — only the marked-up price the client pays. There's no
// passcode gate here; access is via a private link only the team shares.
export default function ClientDashboard({ params }) {
  const { slug } = params
  const [project, setProject] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [approvals, setApprovals] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState(null)
  const [lightbox, setLightbox] = useState(null) // { images: [], index: 0 }

  useEffect(() => { loadAll() }, [slug])

  async function loadAll() {
    const { data: proj } = await supabase
      .from('projects').select('*').eq('slug', slug).single()
    if (!proj) { setLoading(false); return }
    setProject(proj)
    const [{ data: scheds }, { data: subs }, { data: apprs }] = await Promise.all([
      supabase.from('schedules').select('*').eq('project_id', proj.id),
      supabase.from('submissions').select('*').eq('project_id', proj.id),
      supabase.from('approvals').select('*').eq('project_id', proj.id),
    ])
    setSchedules(scheds || [])
    const allSubs = subs || []
    const subMap = {}
    allSubs.forEach(s => {
      const k = s.category + '|||' + s.manufacturer_name
      if (!subMap[k] || new Date(s.submitted_at) > new Date(subMap[k].submitted_at)) subMap[k] = s
    })
    setSubmissions(Object.values(subMap))
    const apprMap = {}
    ;(apprs || []).forEach(a => { apprMap[`${a.category}|||${a.item_key}`] = a })
    setApprovals(apprMap)
    const firstCat = (proj.categories || [])[0]
    if (firstCat) setActiveCategory(firstCat)
    setLoading(false)
  }

  // Client notes are stored separately from the internal team's notes
  // (approvals.client_notes vs approvals.notes) so the two never collide.
  // The API route merges with whatever's already on the row, so this only
  // ever touches the client_notes field.
  async function saveClientNote(category, itemKey, clientNotes) {
    const k = `${category}|||${itemKey}`
    setApprovals(prev => ({ ...prev, [k]: { ...prev[k], client_notes: clientNotes } }))
    await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, category, itemKey, clientNotes }),
    })
  }

  function getLowestPrice(catSubs, itemIndex) {
    let best = null
    catSubs.forEach(sub => {
      const item = sub.pricing_data?.[itemIndex]
      if (!item) return
      const price = parseFloat(item.priceSqm || item.pricePerUnit || item.pricePerLinFt || 0)
      if (price > 0 && (!best || price < best.price)) best = { price, data: item }
    })
    return best
  }

  function getLowestPriceSqft(catSubs, itemIndex) {
    const low = getLowestPrice(catSubs, itemIndex)
    if (!low) return null
    return { ...low, priceSqft: parseFloat((low.price / SQM_TO_SQFT).toFixed(2)) }
  }

  // The only cost figure this page ever computes or displays: the price
  // the client pays per sqft. Material cost and shipping feed into it but
  // are never returned or rendered anywhere on this page.
  function getClientPrice(low, ap) {
    const materialSqft = low ? low.priceSqft : null
    const ddpSqft = parseFloat(ap?.shipping_ddp || 0)
    const totalCostSqft = materialSqft != null ? parseFloat((materialSqft + ddpSqft).toFixed(2)) : null
    const autoMarkupSqft = totalCostSqft != null ? parseFloat((totalCostSqft * MARKUP_RATE).toFixed(2)) : null
    const hasOverride = ap?.markup_override !== null && ap?.markup_override !== undefined && ap?.markup_override !== ''
    return hasOverride ? parseFloat(ap.markup_override) : autoMarkupSqft
  }

  const totals = useCallback(() => {
    let totalItems = 0, approved = 0, rejected = 0, total = 0
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      sched.items.forEach((item, i) => {
        totalItems++
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k]
        if (ap?.status === 'approved') approved++
        if (ap?.status === 'rejected') rejected++
        if (ap?.status !== 'rejected') {
          const qty = parseFloat(ap?.quantity || 0)
          const low = getLowestPriceSqft(catSubs, i)
          const priceSqft = getClientPrice(low, ap)
          if (priceSqft != null && qty) total += priceSqft * qty
        }
      })
    })
    return { totalItems, approved, rejected, total }
  }, [schedules, submissions, approvals])

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>
  if (!project) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}><div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 32 }}>Project Not Found</div></div>

  const t = totals()
  const pct = t.totalItems > 0 ? Math.round((t.approved / t.totalItems) * 100) : 0
  const activeSched = schedules.find(s => s.category === activeCategory)
  const activeCatSubs = submissions.filter(s => s.category === activeCategory)
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
        <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
          <div style={{ width:100, height:2, background:'var(--border)', borderRadius:1, overflow:'hidden' }}>
            <div style={{ height:'100%', background:'var(--black)', width:`${pct}%`, borderRadius:1, transition:'width 0.5s' }} />
          </div>
          <div style={{ fontSize:11, fontWeight:500, color:'var(--gray)', whiteSpace:'nowrap' }}>{t.approved} / {t.totalItems} approved</div>
        </div>
      </div>

      {/* HERO */}
      <div style={{ padding:'48px 56px 36px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:32 }}>
        <div>
          <div className="page-eyebrow">Material Selection</div>
          <div className="page-title">{project.name.split(' ').slice(0,2).join(' ')}<br/><em>{project.name.split(' ').slice(2).join(' ') || project.client}</em></div>
          <div style={{ fontSize:13, fontWeight:400, color:'var(--gray)', marginTop:12, lineHeight:1.6 }}>
            {schedules.reduce((a,s)=>a+(s.items?.length||0),0)} total line items · {project.categories?.length} categories · Prices shown per square foot
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
          {project.categories?.map(catId => {
            const sched = schedules.find(s => s.category === catId)
            const catDef = getCategory(catId)
            const catSubs = submissions.filter(s => s.category === catId)
            const items = sched?.items || []
            let catApproved = 0, catTotal = 0
            items.forEach((item, i) => {
              const k = `${catId}|||${item.key}`
              const ap = approvals[k]
              if (ap?.status === 'approved') catApproved++
              if (ap?.status !== 'rejected') {
                const qty = parseFloat(ap?.quantity || 0)
                const low = getLowestPriceSqft(catSubs, i)
                const priceSqft = getClientPrice(low, ap)
                if (priceSqft != null && qty) catTotal += priceSqft * qty
              }
            })
            const isActive = activeCategory === catId
            return (
              <div key={catId} onClick={() => setActiveCategory(catId)} style={{ padding:'14px 28px', cursor:'pointer', borderBottom:isActive?'2px solid var(--black)':'2px solid transparent', background:isActive?'var(--off-white)':'transparent', transition:'all 0.15s', minWidth:160 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                  <span style={{ fontSize:14, color:isActive?'var(--gold)':'var(--gray-light)' }}>{catDef?.icon}</span>
                  <span style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:isActive?'var(--black)':'var(--gray)' }}>{catDef?.label || catId}</span>
                </div>
                <div style={{ fontSize:11, fontWeight:400, color:'var(--gray-light)' }}>
                  {catApproved}/{items.length} approved{catTotal > 0 ? ` · ${formatCurrency(catTotal)}` : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* CATEGORY DETAIL */}
      <div style={{ padding:'0 40px 80px' }}>
        {activeSched && activeCatDef ? (
          <ClientCategoryDetail
            schedule={activeSched}
            category={activeCatDef}
            submissions={activeCatSubs}
            approvals={approvals}
            getLowestPriceSqft={getLowestPriceSqft}
            getClientPrice={getClientPrice}
            onNoteChange={(itemKey, notes) => saveClientNote(activeCategory, itemKey, notes)}
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
function ClientCategoryDetail({ schedule, category, submissions, approvals, getLowestPriceSqft, getClientPrice, onNoteChange, onOpenLightbox }) {
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'24px 0 16px', borderBottom:'2px solid var(--black)', flexWrap:'wrap', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:13, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' }}>{category.label} Schedule</span>
          <span style={{ fontSize:12, fontWeight:400, color:'var(--gray-light)' }}>{schedule.items.length} items</span>
        </div>
      </div>

      <div style={{ overflowX:'auto', marginTop:0 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr>
              <th style={th('240px')}>Material</th>
              <th style={th('80px')}>Images</th>
              <th style={th('90px')}>Qty (sqft)</th>
              <th style={th('110px')}>Price / sqft</th>
              <th style={th('120px')}>Total</th>
              <th style={th('120px')}>Status</th>
              <th style={th('220px')}>Your Notes</th>
            </tr>
          </thead>
          <tbody>
            {schedule.items.map((item, i) => {
              const k = `${schedule.category}|||${item.key}`
              const ap = approvals[k] || { status:'pending' }
              const qty = parseFloat(ap.quantity || 0)
              const low = getLowestPriceSqft(submissions, i)
              const priceSqft = getClientPrice(low, ap)
              const total = priceSqft != null && qty ? priceSqft * qty : null
              return (
                <tr key={i} style={{ background: ap.status==='approved'?'var(--success-bg)': ap.status==='rejected'?'var(--danger-bg)':'transparent', opacity:ap.status==='rejected'?0.6:1 }}>
                  <td style={td()}><ClientMaterialCell item={item} /></td>
                  <td style={td()}>
                    {(() => {
                      const allImgs = submissions.flatMap(sub => sub.pricing_data?.[i]?.images || []).filter(img => img?.url)
                      if (!allImgs.length) return (
                        <div style={{ width:44, height:44, background:'var(--cream)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gray-light)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        </div>
                      )
                      return (
                        <div style={{ display:'flex', gap:3, flexWrap:'wrap', maxWidth:100 }}>
                          {allImgs.slice(0,3).map((img, idx) => (
                            <img key={idx} src={img.url} alt="" onClick={() => onOpenLightbox(allImgs, idx)}
                              style={{ width:44, height:44, objectFit:'cover', border:'1px solid var(--border)', cursor:'pointer', transition:'opacity 0.15s' }}
                              onMouseEnter={e=>e.target.style.opacity='0.75'} onMouseLeave={e=>e.target.style.opacity='1'}
                            />
                          ))}
                          {allImgs.length > 3 && (
                            <div onClick={() => onOpenLightbox(allImgs, 3)}
                              style={{ width:44, height:44, background:'var(--cream)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:10, fontWeight:600, color:'var(--gray)' }}>
                              +{allImgs.length-3}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  <td style={td()}>
                    <div style={{ fontSize:14, fontWeight:500 }}>{qty || '—'}</div>
                  </td>
                  <td style={td()}>
                    <div style={{ fontSize:14, fontWeight:600 }}>{priceSqft != null ? `$${priceSqft.toFixed(2)}` : '—'}</div>
                  </td>
                  <td style={td()}>
                    <div style={{ fontSize:16, fontWeight:600, color:'var(--gold)', whiteSpace:'nowrap' }}>{total ? formatCurrency(total) : '—'}</div>
                  </td>
                  <td style={td()}>
                    <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', padding:'3px 8px', border:'1px solid', display:'inline-block', width:'fit-content', ...(ap.status==='approved'?{borderColor:'var(--success)',color:'var(--success)',background:'var(--success-bg)'}:ap.status==='rejected'?{borderColor:'var(--danger)',color:'var(--danger)',background:'var(--danger-bg)'}:{borderColor:'var(--border-dark)',color:'var(--gray-light)'}) }}>
                      {ap.status === 'approved' ? 'Approved' : ap.status === 'rejected' ? 'Rejected' : 'Under Review'}
                    </div>
                  </td>
                  <td style={td()}>
                    <ClientNoteInput itemKey={item.key} initialValue={ap.client_notes || ''} onSave={onNoteChange} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Debounced note input — auto-saves a couple seconds after typing stops,
// and flushes immediately on blur so a note is never lost.
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

function ClientMaterialCell({ item }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div style={{ fontSize:14, fontWeight:600, color:'var(--black)', lineHeight:1.2 }}>{item.name}</div>
      {item.finish && <div style={{ fontFamily:'var(--font-display)', fontSize:12, fontStyle:'italic', color:'var(--gold)', marginTop:2 }}>{item.finish}</div>}
      {item.cut && <div style={{ fontSize:11, fontWeight:400, color:'var(--gray-light)', marginTop:1 }}>{item.cut}</div>}
      {(item.locations||[]).length > 0 && (
        <>
          <button onClick={()=>setOpen(!open)} style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10, fontWeight:500, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-light)', background:'none', border:'none', cursor:'pointer', padding:0, marginTop:5, transition:'color 0.15s' }}>
            <span style={{ transform:open?'rotate(180deg)':'none', transition:'transform 0.2s', display:'inline-block' }}>▾</span>
            {item.locations.length} location{item.locations.length!==1?'s':''}
          </button>
          {open && (
            <div style={{ fontSize:11, fontWeight:400, color:'var(--gray)', lineHeight:1.9, padding:'8px 12px', background:'var(--cream)', borderLeft:'2px solid var(--gold-light)', marginTop:5 }}>
              {item.locations.map((loc,i) => <div key={i}>· {loc}</div>)}
            </div>
          )}
        </>
      )}
    </div>
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

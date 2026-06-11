'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { allCategories, getCategory } from '@/lib/categories'
import { formatCurrency, formatDate } from '@/lib/utils'

const SQM_TO_SQFT = 10.7639

export default function Dashboard({ params }) {
  const { slug } = params
  const [project, setProject] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [approvals, setApprovals] = useState({})
  const [quantities, setQuantities] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState(null)
  const [showIntro, setShowIntro] = useState(true)

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
    // Deduplicate — keep only the latest submission per manufacturer per category
    const allSubs = subs || []
    const subMap = {}
    allSubs.forEach(s => {
      const k = s.category + '|||' + s.manufacturer_name
      if (!subMap[k] || new Date(s.submitted_at) > new Date(subMap[k].submitted_at)) {
        subMap[k] = s
      }
    })
    setSubmissions(Object.values(subMap))
    const apprMap = {}
    ;(apprs || []).forEach(a => { apprMap[`${a.category}|||${a.item_key}`] = a })
    setApprovals(apprMap)
    const firstCat = (proj.categories || [])[0]
    if (firstCat) setActiveCategory(firstCat)
    setLoading(false)
  }

  async function saveApproval(category, itemKey, status, quantity, notes) {
    const k = `${category}|||${itemKey}`
    setApprovals(prev => ({ ...prev, [k]: { ...prev[k], category, item_key: itemKey, status, quantity, notes } }))
    await fetch('/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id, category, itemKey, status, quantity: quantity || 0, notes: notes || '' }),
    })
  }

  function getLowestPrice(catSubs, itemIndex) {
    let best = null
    catSubs.forEach(sub => {
      const item = sub.pricing_data?.[itemIndex]
      if (!item) return
      const price = parseFloat(item.priceSqm || item.pricePerUnit || item.pricePerLinFt || 0)
      if (price > 0 && (!best || price < best.price)) best = { price, manufacturer: sub.manufacturer_name, data: item }
    })
    return best
  }

  // Convert lowest price to sqft
  function getLowestPriceSqft(catSubs, itemIndex) {
    const low = getLowestPrice(catSubs, itemIndex)
    if (!low) return null
    return { ...low, priceSqft: parseFloat((low.price / SQM_TO_SQFT).toFixed(2)) }
  }

  const totals = useCallback(() => {
    let totalItems = 0, approved = 0, rejected = 0, projectedCost = 0
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      sched.items.forEach((item, i) => {
        totalItems++
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k]
        if (ap?.status === 'approved') approved++
        if (ap?.status === 'rejected') rejected++
        if (ap?.status !== 'rejected') {
          const qty = parseFloat(quantities[k] || ap?.quantity || 0)
          const low = getLowestPriceSqft(catSubs, i)
          if (low && qty) projectedCost += low.priceSqft * qty
        }
      })
    })
    return { totalItems, approved, rejected, projectedCost }
  }, [schedules, submissions, approvals, quantities])

  function exportCSV() {
    const lines = ['Category,Material,Finish,Cut,Best Price (sqft),Manufacturer,Status,Quantity (sqft),Total Cost,Notes']
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      sched.items.forEach((item, i) => {
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k] || {}
        const qty = parseFloat(quantities[k] || ap.quantity || 0)
        const low = getLowestPriceSqft(catSubs, i)
        const total = low && qty ? (low.priceSqft * qty).toFixed(2) : ''
        lines.push([
          sched.category, `"${item.name}"`, `"${item.finish || ''}"`, `"${item.cut || ''}"`,
          low ? `$${low.priceSqft}/sqft` : '',
          low ? `"${low.manufacturer}"` : '',
          ap.status || 'pending', qty, total ? `$${total}` : '',
          `"${(ap.notes || '').replace(/"/g, '""')}"`,
        ].join(','))
      })
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${slug}-approval-summary.csv`
    a.click()
  }

  function exportPDF() {
    const t = totals()
    const win = window.open('', '_blank')
    const now = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    let rows = ''
    schedules.forEach(sched => {
      const catSubs = submissions.filter(s => s.category === sched.category)
      const catDef = getCategory(sched.category)
      if (!sched.items?.length) return
      rows += `<tr style="background:#f2ead8;"><td colspan="8" style="padding:8px 12px;font-weight:600;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#9a7a4a;">${catDef?.label || sched.category} — ${sched.manufacturer || ''}</td></tr>`
      sched.items.forEach((item, i) => {
        const k = `${sched.category}|||${item.key}`
        const ap = approvals[k] || {}
        const qty = parseFloat(quantities[k] || ap.quantity || 0)
        const low = getLowestPriceSqft(catSubs, i)
        const total = low && qty ? formatCurrency(low.priceSqft * qty) : '—'
        const statusColor = ap.status === 'approved' ? '#2d5a3d' : ap.status === 'rejected' ? '#7a1f1f' : '#8a8880'
        rows += `<tr>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:12px;font-weight:500;">${item.name}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:11px;color:#6a6760;">${item.finish || ''}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:11px;color:#6a6760;">${item.cut || ''}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:12px;">${low ? `$${low.priceSqft}/sqft` : '—'}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:11px;color:#6a6760;">${low?.manufacturer || '—'}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:12px;text-align:right;">${qty || '—'}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:12px;font-weight:600;color:#9a7a4a;text-align:right;">${total}</td>
          <td style="padding:7px 12px;border-bottom:1px solid #ede9e0;font-size:10px;font-weight:600;color:${statusColor};text-transform:uppercase;letter-spacing:0.08em;">${ap.status || 'pending'}</td>
        </tr>`
        if (ap.notes) rows += `<tr><td colspan="8" style="padding:3px 12px 8px 28px;font-size:11px;color:#8a8880;font-style:italic;border-bottom:1px solid #ede9e0;">↳ ${ap.notes}</td></tr>`
      })
    })
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet"/>
    <title>Material Approval Summary — ${project?.name}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Montserrat', sans-serif; font-size: 12px; color: #0d0d0b; background: white; padding: 40px; }
      .header { border-bottom: 2px solid #0d0d0b; padding-bottom: 20px; margin-bottom: 28px; display: flex; justify-content: space-between; align-items: flex-end; }
      .co { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #9a7a4a; margin-bottom: 6px; }
      .title { font-size: 24px; font-weight: 300; color: #0d0d0b; letter-spacing: -0.01em; }
      .meta { font-size: 11px; color: #6a6760; text-align: right; line-height: 1.6; }
      .summary { display: flex; gap: 32px; margin-bottom: 28px; padding: 16px 20px; background: #f7f5f0; border: 1px solid #dedad2; }
      .s-item { text-align: center; }
      .s-val { font-size: 22px; font-weight: 300; color: #0d0d0b; }
      .s-val.gold { color: #9a7a4a; }
      .s-val.green { color: #2d5a3d; }
      .s-label { font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #8a8880; margin-top: 3px; }
      table { width: 100%; border-collapse: collapse; }
      th { padding: 8px 12px; text-align: left; font-size: 9px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #8a8880; border-bottom: 2px solid #0d0d0b; background: white; }
      .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #dedad2; display: flex; justify-content: space-between; font-size: 10px; color: #8a8880; }
      @media print { body { padding: 20px; } }
    </style></head><body>
    <div class="header">
      <div>
        <div class="co">Relative Estates LLC — Material Pricing System</div>
        <div class="title">Material Approval Summary</div>
        <div style="font-size:13px;color:#6a6760;margin-top:4px;font-style:italic;">${project?.name}</div>
      </div>
      <div class="meta">
        Generated ${now}<br/>
        ${project?.client || ''}<br/>
        Confidential
      </div>
    </div>
    <div class="summary">
      <div class="s-item"><div class="s-val">${t.totalItems}</div><div class="s-label">Total Items</div></div>
      <div class="s-item"><div class="s-val green">${t.approved}</div><div class="s-label">Approved</div></div>
      <div class="s-item"><div class="s-val" style="color:#7a1f1f">${t.rejected}</div><div class="s-label">Rejected</div></div>
      <div class="s-item"><div class="s-val gold">${t.projectedCost > 0 ? formatCurrency(t.projectedCost) : '—'}</div><div class="s-label">Projected Cost</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Material</th><th>Finish</th><th>Cut</th>
        <th>Price / sqft</th><th>Manufacturer</th>
        <th style="text-align:right">Qty (sqft)</th>
        <th style="text-align:right">Total</th>
        <th>Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">
      <span>Relative Estates LLC · Kansas City, MO</span>
      <span>${project?.name} · ${now}</span>
    </div>
    <script>window.onload = () => { window.print(); }</script>
    </body></html>`)
    win.document.close()
  }

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>
  if (!project) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}><div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 32 }}>Project Not Found</div></div>

  const t = totals()
  const pct = t.totalItems > 0 ? Math.round((t.approved / t.totalItems) * 100) : 0

  if (showIntro) return (
    <div style={{ minHeight: '100vh', background: 'var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
      <style>{`@keyframes riseIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }`}</style>
      {[20,80].map(p => <div key={`h${p}`} style={{ position:'absolute', height:1, width:'100%', background:'rgba(255,255,255,0.04)', top:`${p}%` }} />)}
      {[15,85].map(p => <div key={`v${p}`} style={{ position:'absolute', width:1, height:'100%', background:'rgba(255,255,255,0.04)', left:`${p}%` }} />)}
      {[
        { pos:{top:36,left:48}, text:'Relative Estates LLC' },
        { pos:{top:36,right:48}, text:`Material Review · ${new Date().getFullYear()}` },
        { pos:{bottom:36,left:48}, text:'Confidential · Owner Copy' },
        { pos:{bottom:36,right:48}, text:'Kansas City, MO' },
      ].map((c,i) => <div key={i} style={{ position:'absolute', ...c.pos, fontSize:9, fontWeight:500, letterSpacing:'0.16em', color:'rgba(255,255,255,0.12)', textTransform:'uppercase', fontFamily:'var(--font-body)' }}>{c.text}</div>)}
      <div style={{ textAlign:'center', position:'relative', zIndex:2, padding:'0 24px', animation:'riseIn 1.8s cubic-bezier(0.16,1,0.3,1) 0.3s both' }}>
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.28em', textTransform:'uppercase', color:'var(--gold-light)', marginBottom:24 }}>Owner Review — Material Pricing Schedule</div>
        <div style={{ fontFamily:'var(--font-display)', fontSize:'clamp(48px,8vw,100px)', fontWeight:200, lineHeight:0.95, color:'#f7f5f0' }}>Material<br/><em style={{color:'rgba(247,245,240,0.5)'}}>Selection</em></div>
        <div style={{ fontFamily:'var(--font-display)', fontSize:'clamp(16px,2.5vw,24px)', fontWeight:300, fontStyle:'italic', color:'var(--gold-light)', marginTop:20 }}>{project.name}</div>
        <div style={{ width:40, height:1, background:'rgba(201,169,110,0.5)', margin:'28px auto' }} />
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:32, marginBottom:40 }}>
          {[
            { val:schedules.reduce((a,s)=>a+(s.items?.length||0),0), label:'Materials' },
            { val:project.categories?.length||0, label:'Categories' },
            { val:[...new Set(submissions.map(s=>s.manufacturer_name))].length, label:'Manufacturers' },
          ].map((stat,i,arr) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:32 }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:300, color:'#f7f5f0', lineHeight:1 }}>{stat.val}</div>
                <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.18em', textTransform:'uppercase', color:'rgba(247,245,240,0.3)', marginTop:4 }}>{stat.label}</div>
              </div>
              {i < arr.length-1 && <div style={{ width:1, height:32, background:'rgba(255,255,255,0.08)' }} />}
            </div>
          ))}
        </div>
        <button onClick={() => setShowIntro(false)} style={{ display:'inline-flex', alignItems:'center', gap:14, padding:'16px 44px', fontSize:10, fontWeight:600, letterSpacing:'0.2em', textTransform:'uppercase', background:'#f7f5f0', color:'var(--black)', border:'none', cursor:'pointer', transition:'background 0.3s' }} onMouseEnter={e=>e.currentTarget.style.background='var(--gold-light)'} onMouseLeave={e=>e.currentTarget.style.background='#f7f5f0'}>
          Begin Review →
        </button>
      </div>
    </div>
  )

  const activeSched = schedules.find(s => s.category === activeCategory)
  const activeCatSubs = submissions.filter(s => s.category === activeCategory)
  const activeCatDef = getCategory(activeCategory)

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      {/* TOP BAR — z-index 200 */}
      <div style={{ position:'sticky', top:0, zIndex:200, background:'rgba(247,245,240,0.97)', backdropFilter:'blur(12px)', borderBottom:'1px solid var(--border)', height:64, display:'flex', alignItems:'center', padding:'0 40px', gap:0 }}>
        {/* Home button */}
        <button onClick={() => window.location.href = '/'} style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)', marginRight:20, flexShrink:0, transition:'opacity 0.2s' }} onMouseEnter={e=>e.currentTarget.style.opacity='0.6'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--black)' }}>All Projects</span>
        </button>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, letterSpacing:'0.06em', flexShrink:0, marginRight:24 }}>
          Relative <span style={{ color:'var(--gold)' }}>Estates</span>
        </div>
        <div style={{ width:1, height:24, background:'var(--border)', marginRight:20, flexShrink:0 }} />
        <div style={{ fontSize:13, fontWeight:500, color:'var(--gray)', flex:1 }}>{project.name}</div>
        <div style={{ marginRight:24, flexShrink:0, textAlign:'right' }}>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:1 }}>Total Projected Cost</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:300, color:'var(--gold)', lineHeight:1 }}>{t.projectedCost > 0 ? formatCurrency(t.projectedCost) : '—'}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0, marginRight:20 }}>
          <div style={{ width:100, height:2, background:'var(--border)', borderRadius:1, overflow:'hidden' }}>
            <div style={{ height:'100%', background:'var(--black)', width:`${pct}%`, borderRadius:1, transition:'width 0.5s' }} />
          </div>
          <div style={{ fontSize:11, fontWeight:500, color:'var(--gray)', whiteSpace:'nowrap' }}>{t.approved} / {t.totalItems} approved</div>
        </div>
        {/* Export buttons */}
        <div style={{ display:'flex', gap:8, flexShrink:0 }}>
          <button className="btn btn-outline btn-sm" onClick={exportCSV}>Export CSV</button>
          <button className="btn btn-black btn-sm" onClick={exportPDF}>Export PDF</button>
        </div>
      </div>

      {/* HERO */}
      <div style={{ padding:'48px 56px 36px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-end', justifyContent:'space-between', flexWrap:'wrap', gap:32 }}>
        <div>
          <div className="page-eyebrow">Material Pricing Review</div>
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
            { val:t.projectedCost > 0 ? formatCurrency(t.projectedCost) : '—', label:'Est. Cost', color:'var(--gold)', sm:true },
          ].map((s,i,arr) => (
            <div key={i} style={{ padding:'16px 24px', textAlign:'center', borderRight:i<arr.length-1?'1px solid var(--border)':'none' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:s.sm?22:32, fontWeight:200, color:s.color||'var(--black)', lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginTop:5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* BULK APPROVE STRIP */}
      <div style={{ background:'var(--white)', borderBottom:'1px solid var(--border)', padding:'10px 56px', display:'flex', alignItems:'center', gap:16 }}>
        <span style={{ fontSize:11, fontWeight:600, color:'var(--gray-light)', letterSpacing:'0.06em' }}>Quick actions:</span>
        <button className="btn btn-outline btn-sm" onClick={() => {
          if (!activeSched) return
          activeSched.items.forEach(item => {
            const k = `${activeCategory}|||${item.key}`
            const ap = approvals[k] || {}
            saveApproval(activeCategory, item.key, 'approved', parseFloat(quantities[k] || ap.quantity || 0), ap.notes || '')
          })
        }}>Approve All Visible</button>
        <button className="btn btn-outline btn-sm" onClick={() => {
          if (!activeSched) return
          activeSched.items.forEach(item => {
            const k = `${activeCategory}|||${item.key}`
            const ap = approvals[k] || {}
            saveApproval(activeCategory, item.key, 'pending', parseFloat(quantities[k] || ap.quantity || 0), ap.notes || '')
          })
        }}>Reset All</button>
        <div style={{ marginLeft:'auto', fontSize:11, fontWeight:400, color:'var(--gray-light)' }}>
          Tab through rows · Space to approve · X to reject
        </div>
      </div>

      {/* CATEGORY TABS — sticky below top bar */}
      <div style={{ position:'sticky', top:64, zIndex:100, background:'var(--white)', borderBottom:'1px solid var(--border)', overflowX:'auto' }}>
        <div style={{ display:'flex', minWidth:'max-content' }}>
          {project.categories?.map(catId => {
            const sched = schedules.find(s => s.category === catId)
            const catDef = getCategory(catId)
            const catSubs = submissions.filter(s => s.category === catId)
            const items = sched?.items || []
            let catApproved = 0, catCost = 0
            items.forEach((item, i) => {
              const k = `${catId}|||${item.key}`
              const ap = approvals[k]
              if (ap?.status === 'approved') catApproved++
              if (ap?.status !== 'rejected') {
                const qty = parseFloat(quantities[k] || ap?.quantity || 0)
                const low = getLowestPriceSqft(catSubs, i)
                if (low && qty) catCost += low.priceSqft * qty
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
                  {catApproved}/{items.length} approved{catCost > 0 ? ` · ${formatCurrency(catCost)}` : ''}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* CATEGORY DETAIL — top offset accounts for both sticky bars */}
      <div style={{ padding:'0 40px 80px' }}>
        {activeSched && activeCatDef ? (
          <CategoryDetail
            schedule={activeSched}
            category={activeCatDef}
            submissions={activeCatSubs}
            approvals={approvals}
            quantities={quantities}
            onApprove={(itemKey, status, notes) => {
              const k = `${activeCategory}|||${itemKey}`
              const qty = parseFloat(quantities[k] || approvals[k]?.quantity || 0)
              saveApproval(activeCategory, itemKey, status, qty, notes)
            }}
            onQtyChange={(itemKey, qty) => {
              const k = `${activeCategory}|||${itemKey}`
              setQuantities(prev => ({ ...prev, [k]: qty }))
              const ap = approvals[k] || {}
              saveApproval(activeCategory, itemKey, ap.status || 'pending', qty, ap.notes || '')
            }}
            onNoteChange={(itemKey, notes) => {
              const k = `${activeCategory}|||${itemKey}`
              const ap = approvals[k] || {}
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              saveApproval(activeCategory, itemKey, ap.status || 'pending', qty, notes)
            }}
            getLowestPriceSqft={getLowestPriceSqft}
            projectSlug={slug}
            activeCategory={activeCategory}
          />
        ) : (
          <div className="empty-state"><div className="empty-state-title">No schedule uploaded</div><div className="empty-state-sub">Upload a CSV for this category in the admin.</div></div>
        )}
      </div>

      {/* FOOTER */}
      <div style={{ borderTop:'2px solid var(--black)', padding:'40px 56px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:24, background:'var(--off-white)' }}>
        <div style={{ display:'flex', gap:0, flexWrap:'wrap' }}>
          {[
            { val:t.totalItems, label:'Total Materials' },
            { val:t.approved, label:'Approved', color:'var(--success)' },
            { val:t.rejected, label:'Rejected', color:'var(--danger)' },
            { val:t.projectedCost > 0 ? formatCurrency(t.projectedCost) : '—', label:'Projected Cost', color:'var(--gold)' },
          ].map((s,i) => (
            <div key={i} style={{ paddingRight:40, marginRight:40, borderRight:i<3?'1px solid var(--border)':'none' }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:36, fontWeight:200, color:s.color||'var(--black)', lineHeight:1 }}>{s.val}</div>
              <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginTop:5 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button className="btn btn-outline btn-lg" onClick={exportCSV}>Export CSV</button>
          <button className="btn btn-black btn-lg" onClick={exportPDF}>Export PDF →</button>
        </div>
      </div>
    </div>
  )
}

// ── Category Detail Table ──────────────────────────────────
function CategoryDetail({ schedule, category, submissions, approvals, quantities, onApprove, onQtyChange, onNoteChange, getLowestPriceSqft, projectSlug, activeCategory }) {
  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'24px 0 16px', borderBottom:'2px solid var(--black)', flexWrap:'wrap', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:13, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' }}>{category.label} Schedule</span>
          <span style={{ fontSize:12, fontWeight:400, color:'var(--gray-light)' }}>{schedule.items.length} items</span>
          {schedule.manufacturer && (
            <div style={{ padding:'3px 10px', fontSize:9, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', background:'var(--gold-pale)', color:'var(--gold)', border:'1px solid rgba(154,122,74,0.2)' }}>
              {schedule.manufacturer}
            </div>
          )}
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => {
          const realSlug = window.location.pathname.split('/').filter(Boolean)[1]
          const url = `${window.location.origin}/projects/${realSlug}/form/${activeCategory}`
          navigator.clipboard?.writeText(url)
          alert('Form link copied to clipboard:\n\n' + url)
        }}>Copy Form Link</button>
      </div>

      {submissions.length === 0 && (
        <div style={{ padding:'16px 20px', background:'var(--gold-pale)', border:'1px solid rgba(154,122,74,0.2)', marginTop:16, marginBottom:0, fontSize:12, fontWeight:400, color:'var(--gray)' }}>
          No pricing received yet. Copy the form link above and send it to {schedule.manufacturer || 'your manufacturer'}.
        </div>
      )}

      <div style={{ overflowX:'auto', marginTop:0 }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            {/* Table header — sticky below both top bars (64 + 48 category tabs) */}
            <tr>
              <th style={th('220px')}>Material</th>
              <th style={th('72px')}>Images</th>
              {submissions.map(sub => (
                <th key={sub.id} style={{ ...th('160px'), color:'var(--gold)', background:'var(--gold-pale)', borderLeft:'1px solid var(--border)' }}>
                  {sub.manufacturer_name}<br/>
                  <span style={{ fontSize:9, fontWeight:400, color:'var(--gold-light)' }}>
                    {new Date(sub.submitted_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                  </span>
                </th>
              ))}
              <th style={th('100px')}>Qty (sqft)</th>
              <th style={th('130px')}>Total Cost</th>
              <th style={th('140px')}>Approval</th>
              <th style={th('180px')}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {schedule.items.map((item, i) => {
              const k = `${schedule.category}|||${item.key}`
              const ap = approvals[k] || { status:'pending', notes:'' }
              const qty = parseFloat(quantities[k] || ap.quantity || 0)
              const low = getLowestPriceSqft(submissions, i)
              const total = low && qty ? low.priceSqft * qty : null
              return (
                <tr key={i} style={{ background: ap.status==='approved'?'var(--success-bg)': ap.status==='rejected'?'var(--danger-bg)':'transparent', opacity:ap.status==='rejected'?0.6:1 }}>
                  <td style={td()}><MaterialCell item={item} /></td>
                  <td style={td()}>
                    <div style={{ width:44, height:44, background:'var(--cream)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:9, color:'var(--gray-light)' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </div>
                  </td>
                  {submissions.map(sub => {
                    const d = sub.pricing_data?.[i]
                    const pd = category.dashboardPriceDisplay(d || {})
                    const isLow = low && sub.manufacturer_name === low.manufacturer
                    const sqftPrice = d?.priceSqm ? (parseFloat(d.priceSqm) / SQM_TO_SQFT).toFixed(2) : null
                    return (
                      <td key={sub.id} style={{ ...td(), borderLeft:'1px solid var(--border)', background:'rgba(242,234,216,0.25)' }}>
                        {d && (d.priceSqm || d.pricePerUnit) ? (
                          <div>
                            <div style={{ fontSize:15, fontWeight:600, color:isLow?'var(--black)':'var(--gray)', lineHeight:1.3 }}>
                              {sqftPrice ? `$${sqftPrice}/sqft` : pd.primary || '—'}
                            </div>
                            {d.priceSqm && <div style={{ fontSize:10, color:'var(--gray-light)', marginTop:2 }}>${parseFloat(d.priceSqm).toFixed(2)}/sqm</div>}
                            {pd.volume && <div style={{ fontSize:10, color:'var(--gold)', marginTop:2 }}>{pd.volume}</div>}
                            {pd.moq && <div style={{ fontSize:10, color:'var(--gray-light)', marginTop:1 }}>{pd.moq}</div>}
                          </div>
                        ) : (
                          <span style={{ fontSize:12, fontStyle:'italic', color:'rgba(0,0,0,0.2)' }}>Awaiting quote</span>
                        )}
                      </td>
                    )
                  })}
                  <td style={td()}>
                    <input type="number" min="0" placeholder="0" value={quantities[k] || ap.quantity || ''} onChange={e => onQtyChange(item.key, parseFloat(e.target.value)||0)}
                      style={{ width:72, padding:'6px 0', fontFamily:'var(--font-body)', fontSize:16, fontWeight:500, background:'transparent', border:'none', borderBottom:'1px solid var(--border)', color:'var(--black)', textAlign:'left', transition:'border-color 0.2s' }}
                      onFocus={e=>e.target.style.borderBottomColor='var(--gold)'}
                      onBlur={e=>e.target.style.borderBottomColor='var(--border)'}
                    />
                  </td>
                  <td style={td()}>
                    <div style={{ fontSize:16, fontWeight:600, color:'var(--gold)', whiteSpace:'nowrap' }}>
                      {total ? formatCurrency(total) : '—'}
                    </div>
                  </td>
                  <td style={td()}>
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', padding:'3px 8px', border:'1px solid', display:'inline-block', width:'fit-content', ...(ap.status==='approved'?{borderColor:'var(--success)',color:'var(--success)',background:'var(--success-bg)'}:ap.status==='rejected'?{borderColor:'var(--danger)',color:'var(--danger)',background:'var(--danger-bg)'}:{borderColor:'var(--border-dark)',color:'var(--gray-light)'}) }}>
                        {ap.status}
                      </div>
                      <div style={{ display:'flex', gap:4 }}>
                        {['approved','rejected'].map(s => (
                          <button key={s} onClick={() => onApprove(item.key, ap.status===s?'pending':s, ap.notes)}
                            style={{ padding:'5px 10px', fontSize:9, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', cursor:'pointer', border:'1px solid', transition:'all 0.15s', ...(ap.status===s ? s==='approved'?{background:'var(--black)',color:'var(--off-white)',borderColor:'var(--black)'}:{background:'var(--danger)',color:'white',borderColor:'var(--danger)'}:{background:'transparent',color:'var(--gray)',borderColor:'var(--border-dark)'}) }}>
                            {s==='approved'?'✓':'✕'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </td>
                  <td style={td()}>
                    <textarea value={ap.notes||''} onChange={e=>onNoteChange(item.key,e.target.value)} placeholder="Add a note…" rows={2}
                      style={{ width:'100%', padding:'5px 0', fontFamily:'var(--font-body)', fontSize:12, fontWeight:400, background:'transparent', border:'none', borderBottom:'1px solid transparent', color:'var(--gray)', resize:'none', transition:'border-color 0.2s' }}
                      onFocus={e=>e.target.style.borderBottomColor='var(--border)'}
                      onBlur={e=>e.target.style.borderBottomColor='transparent'}
                    />
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

function MaterialCell({ item }) {
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

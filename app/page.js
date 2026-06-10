'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { getCategory } from '@/lib/categories'
import { sqmToSqft } from '@/lib/utils'

const SQM_TO_SQFT = 10.7639

export default function ManufacturerForm({ params }) {
  const { slug, category: categoryId } = params
  const [project, setProject] = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [category, setCategory] = useState(null)
  const [formData, setFormData] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [error, setError] = useState('')
  const saveTimer = useRef(null)

  useEffect(() => { loadData() }, [slug, categoryId])

  async function loadData() {
    const { data: proj } = await supabase.from('projects').select('*').eq('slug', slug).single()
    if (!proj) { setError('Project not found'); setLoading(false); return }
    setProject(proj)

    const { data: sched } = await supabase.from('schedules').select('*').eq('project_id', proj.id).eq('category', categoryId).single()
    if (!sched) { setError('Schedule not found for this category'); setLoading(false); return }
    setSchedule(sched)

    const cat = getCategory(categoryId)
    if (!cat) { setError('Unknown category'); setLoading(false); return }
    setCategory(cat)

    // Check for existing draft submission (allows returning to form)
    const { data: existingSub } = await supabase
      .from('submissions')
      .select('*')
      .eq('project_id', proj.id)
      .eq('category', categoryId)
      .eq('manufacturer_name', sched.manufacturer)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single()

    // Initialize form data — pre-fill from existing draft if found
    const initial = {}
    sched.items.forEach((item, i) => {
      const existing = existingSub?.pricing_data?.[i]
      initial[i] = {}
      cat.formFields.forEach(field => {
        if (field.type !== 'calculated') {
          initial[i][field.id] = existing?.[field.id] || ''
        }
      })
    })
    setFormData(initial)
    if (existingSub) setLastSaved(new Date(existingSub.submitted_at))
    setLoading(false)
  }

  function updateField(itemIndex, fieldId, value) {
    const updated = { ...formData, [itemIndex]: { ...formData[itemIndex], [fieldId]: value } }
    setFormData(updated)
    // Auto-save draft after 2 seconds of no typing
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveDraft(updated), 2000)
  }

  async function saveDraft(data) {
    if (!project || !schedule) return
    setSaving(true)
    const pricingData = buildPricingData(data)
    await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectSlug: slug, category: categoryId,
        manufacturerName: schedule.manufacturer || 'Manufacturer',
        pricingData, isDraft: true,
      }),
    })
    setSaving(false)
    setLastSaved(new Date())
  }

  function buildPricingData(data) {
    return (schedule?.items || []).map((item, i) => {
      const d = data[i] || {}
      if (d.priceSqm) d.priceSqft = parseFloat((parseFloat(d.priceSqm) / SQM_TO_SQFT).toFixed(2))
      if (d.volBreakPrice) d.volBreakPriceSqft = parseFloat((parseFloat(d.volBreakPrice) / SQM_TO_SQFT).toFixed(2))
      return { ...item, ...d }
    })
  }

  async function submit() {
    setSubmitting(true)
    setError('')
    const pricingData = buildPricingData(formData)
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectSlug: slug, category: categoryId,
        manufacturerName: schedule.manufacturer || 'Manufacturer',
        pricingData,
      }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Submission failed.'); return }
    setSubmitted(true)
  }

  // Count filled items
  const filledCount = Object.values(formData).filter(d => {
    const priceField = Object.keys(d).find(k => k.toLowerCase().includes('price'))
    return priceField && d[priceField]
  }).length
  const totalCount = schedule?.items?.length || 0

  if (loading) return <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center' }}><div className="spinner"/></div>
  if (error && !project) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:40 }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:300, marginBottom:8 }}>Not Found</div>
        <div style={{ fontSize:13, color:'var(--gray)' }}>{error}</div>
      </div>
    </div>
  )

  if (submitted) return (
    <div style={{ minHeight:'100vh', background:'var(--black)', display:'flex', alignItems:'center', justifyContent:'center', padding:40 }}>
      <div style={{ textAlign:'center', maxWidth:480 }}>
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.22em', textTransform:'uppercase', color:'var(--gold-light)', marginBottom:24 }}>Submission Received</div>
        <div style={{ fontFamily:'var(--font-display)', fontSize:56, fontWeight:200, color:'#f7f5f0', lineHeight:1, marginBottom:16 }}>Thank you.</div>
        <div style={{ fontSize:13, fontWeight:400, color:'rgba(247,245,240,0.5)', lineHeight:1.7 }}>
          Your pricing has been submitted to the Relative Estates team. You can return to this link at any time to update your submission.
        </div>
        <button onClick={() => setSubmitted(false)} style={{ marginTop:32, padding:'12px 28px', fontSize:10, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', background:'transparent', border:'1px solid rgba(247,245,240,0.2)', color:'rgba(247,245,240,0.6)', cursor:'pointer' }}>
          Return & Edit
        </button>
      </div>
    </div>
  )

  const catLabel = category?.label || categoryId

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      {/* Header */}
      <div style={{ background:'var(--black)', padding:'0 40px', height:60, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, color:'#f7f5f0', letterSpacing:'0.06em' }}>
          Relative <span style={{ color:'var(--gold-light)' }}>Estates</span>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'rgba(255,255,255,0.35)' }}>
            {catLabel} Pricing Request
          </div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:14, fontStyle:'italic', color:'var(--gold-light)', marginTop:1 }}>
            {project?.name}
          </div>
        </div>
      </div>

      {/* Progress + save bar */}
      <div style={{ background:'var(--white)', borderBottom:'1px solid var(--border)', padding:'10px 40px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, position:'sticky', top:60, zIndex:99 }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ width:160, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
            <div style={{ height:'100%', background:'var(--gold)', width:`${totalCount>0?Math.round((filledCount/totalCount)*100):0}%`, borderRadius:2, transition:'width 0.3s' }} />
          </div>
          <span style={{ fontSize:12, fontWeight:500, color:'var(--gray)' }}>{filledCount} of {totalCount} items priced</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          {saving && <span style={{ fontSize:11, color:'var(--gray-light)' }}>Saving…</span>}
          {!saving && lastSaved && <span style={{ fontSize:11, color:'var(--gray-light)' }}>Last saved {lastSaved.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</span>}
          <button className="btn btn-black btn-sm" onClick={submit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Pricing →'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:'0 auto', padding:'32px 32px 80px' }}>
        {/* Instructions */}
        <div style={{ background:'var(--gold-pale)', border:'1px solid rgba(154,122,74,0.2)', padding:'14px 18px', marginBottom:24, display:'flex', gap:14, alignItems:'flex-start' }}>
          <div style={{ fontSize:16, color:'var(--gold)', flexShrink:0 }}>ℹ</div>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--black)', marginBottom:3 }}>Instructions</div>
            <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)', lineHeight:1.6 }}>
              Enter pricing for each material below. Your progress saves automatically — you can return to this link at any time to complete or update your submission. Price per sqm will auto-convert to sqft. Submit when ready.
            </div>
          </div>
        </div>

        {error && <div style={{ padding:'10px 14px', background:'var(--danger-bg)', border:'1px solid var(--danger)', fontSize:12, color:'var(--danger)', marginBottom:20 }}>{error}</div>}

        {/* COMPACT TABLE FORM */}
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                <th style={fth('180px')}>Material</th>
                <th style={fth('110px')}>Price / sqm ($)</th>
                <th style={fth('110px')}>= Per sqft</th>
                <th style={fth('90px')}>Min Order (sqm)</th>
                <th style={fth('100px')}>Vol Break (sqm)</th>
                <th style={fth('110px')}>Vol Price / sqm ($)</th>
                <th style={fth('220px')}>Notes</th>
                <th style={fth('80px')}>Images</th>
              </tr>
            </thead>
            <tbody>
              {schedule?.items?.map((item, i) => {
                const d = formData[i] || {}
                const sqftCalc = d.priceSqm ? `$${(parseFloat(d.priceSqm)/SQM_TO_SQFT).toFixed(2)}` : '—'
                const hasPrice = !!d.priceSqm
                return (
                  <tr key={i} style={{ background:hasPrice?'var(--success-bg)':'var(--white)', transition:'background 0.2s' }}>
                    <td style={ftd()}>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--black)' }}>{item.name}</div>
                      <div style={{ fontFamily:'var(--font-display)', fontSize:11, fontStyle:'italic', color:'var(--gold)', marginTop:1 }}>{item.finish}</div>
                      {item.cut && <div style={{ fontSize:10, color:'var(--gray-light)' }}>{item.cut}</div>}
                      {(item.locations||[]).length > 0 && (
                        <div style={{ fontSize:10, color:'var(--gray-light)', marginTop:2 }}>
                          {item.locations.slice(0,2).join(' · ')}{item.locations.length>2?` +${item.locations.length-2}`:''}
                        </div>
                      )}
                    </td>
                    <td style={ftd()}>
                      <input type="number" value={d.priceSqm||''} onChange={e=>updateField(i,'priceSqm',e.target.value)}
                        placeholder="0.00" min="0" step="0.01"
                        style={inp(hasPrice)}
                      />
                    </td>
                    <td style={{ ...ftd(), background:'var(--cream)', fontSize:13, fontWeight:hasPrice?600:400, color:hasPrice?'var(--gold)':'var(--gray-light)' }}>
                      {sqftCalc}
                    </td>
                    <td style={ftd()}>
                      <input type="number" value={d.moq||''} onChange={e=>updateField(i,'moq',e.target.value)}
                        placeholder="0" min="0" style={inp(false)} />
                    </td>
                    <td style={ftd()}>
                      <input type="number" value={d.volBreakQty||''} onChange={e=>updateField(i,'volBreakQty',e.target.value)}
                        placeholder="0" min="0" style={inp(false)} />
                    </td>
                    <td style={ftd()}>
                      <input type="number" value={d.volBreakPrice||''} onChange={e=>updateField(i,'volBreakPrice',e.target.value)}
                        placeholder="0.00" min="0" step="0.01" style={inp(false)} />
                    </td>
                    <td style={ftd()}>
                      <input type="text" value={d.notes||''} onChange={e=>updateField(i,'notes',e.target.value)}
                        placeholder="Lead time, availability, notes…"
                        style={{ ...inp(false), width:'100%' }} />
                    </td>
                    <td style={ftd()}>
                      <label style={{ display:'flex', alignItems:'center', justifyContent:'center', width:36, height:36, background:'var(--cream)', border:'1px dashed var(--border-dark)', cursor:'pointer', fontSize:9, color:'var(--gray-light)', transition:'background 0.15s' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        <input type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e => {
                          // In production: upload to Supabase Storage
                          // For now just update the note with image count
                          if (e.target.files.length > 0) {
                            updateField(i, 'imageCount', (parseInt(d.imageCount||0) + e.target.files.length).toString())
                          }
                        }}/>
                      </label>
                      {d.imageCount && parseInt(d.imageCount) > 0 && (
                        <div style={{ fontSize:9, color:'var(--gold)', marginTop:2, textAlign:'center' }}>
                          {d.imageCount} photo{d.imageCount>1?'s':''}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Bottom submit */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:16, paddingTop:24, borderTop:'1px solid var(--border)', marginTop:24 }}>
          <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)' }}>
            {filledCount} of {totalCount} items priced · Results sent to emma@relativeestates.com
          </div>
          <button className="btn btn-black btn-lg" onClick={submit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Pricing →'}
          </button>
        </div>
      </div>
    </div>
  )
}

function fth(minWidth) {
  return {
    padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:600,
    letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--gray-light)',
    background:'var(--cream)', borderBottom:'2px solid var(--black)',
    whiteSpace:'nowrap', minWidth, position:'sticky', top:109, zIndex:8,
  }
}
function ftd() {
  return { padding:'8px 10px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' }
}
function inp(filled) {
  return {
    width:'100%', padding:'6px 8px', fontSize:13, fontWeight:filled?600:400,
    background:filled?'white':'transparent', border:'1px solid',
    borderColor:filled?'var(--gold)':'var(--border)',
    color:'var(--black)', transition:'all 0.15s',
    fontFamily:'var(--font-body)',
    outline:'none',
  }
}

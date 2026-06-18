'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { getCategory } from '@/lib/categories'

const SQM_TO_SQFT = 10.7639
const MAX_IMG_WIDTH = 900 // compress phone photos to this width

export default function ManufacturerForm({ params }) {
  const { slug, category: categoryId } = params
  const [project, setProject] = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [category, setCategory] = useState(null)
  const [formData, setFormData] = useState({})
  const [imageData, setImageData] = useState({}) // { itemIndex: [{ url, name }] }
  const [designData, setDesignData] = useState({}) // doors only: { itemIndex: [{ url, name }] }
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [error, setError] = useState('')
  const [uploadingFor, setUploadingFor] = useState(null) // item index currently uploading
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

    const { data: existingSub } = await supabase
      .from('submissions').select('*')
      .eq('project_id', proj.id).eq('category', categoryId)
      .eq('manufacturer_name', sched.manufacturer)
      .order('submitted_at', { ascending: false }).limit(1).single()

    const initial = {}
    const imgs = {}
    const designs = {}
    sched.items.forEach((item, i) => {
      const existing = existingSub?.pricing_data?.[i]
      if (cat.id === 'doors') {
        initial[i] = {
          unitPrice: existing?.unitPrice || '',
          notes: existing?.notes || '',
        }
      } else {
        initial[i] = {
          priceSqm: existing?.priceSqm || '',
          moq: existing?.moq || '',
          volBreakQty: existing?.volBreakQty || '',
          volBreakPrice: existing?.volBreakPrice || '',
          notes: existing?.notes || '',
        }
      }
      if (existing?.images?.length) imgs[i] = existing.images
      if (existing?.designOptions?.length) designs[i] = existing.designOptions
    })
    setFormData(initial)
    setImageData(imgs)
    setDesignData(designs)
    if (existingSub) setLastSaved(new Date(existingSub.submitted_at))
    setLoading(false)
  }

  function updateField(itemIndex, fieldId, value) {
    const updated = { ...formData, [itemIndex]: { ...formData[itemIndex], [fieldId]: value } }
    setFormData(updated)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveDraft(updated, imageData, designData), 2000)
  }

  // Compress image to max width before uploading
  async function compressImage(file) {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        if (width > MAX_IMG_WIDTH) {
          height = Math.round((height * MAX_IMG_WIDTH) / width)
          width = MAX_IMG_WIDTH
        }
        canvas.width = width
        canvas.height = height
        canvas.getContext('2d').drawImage(img, 0, 0, width, height)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
        }, 'image/jpeg', 0.82)
      }
      img.src = url
    })
  }

  async function handleImages(itemIndex, files) {
    setUploadingFor(itemIndex)
    const uploaded = [...(imageData[itemIndex] || [])]

    for (const file of Array.from(files)) {
      try {
        const compressed = await compressImage(file)
        const path = `${slug}/${categoryId}/${Date.now()}-${compressed.name}`
        const { data, error: uploadError } = await supabase.storage
          .from('material-images')
          .upload(path, compressed, { upsert: false })

        if (uploadError) {
          console.error('Upload error:', uploadError)
          continue
        }

        const { data: urlData } = supabase.storage
          .from('material-images')
          .getPublicUrl(path)

        uploaded.push({ url: urlData.publicUrl, name: file.name })
      } catch (e) {
        console.error('Image error:', e)
      }
    }

    const newImageData = { ...imageData, [itemIndex]: uploaded }
    setImageData(newImageData)
    setUploadingFor(null)

    // Auto-save after image upload
    clearTimeout(saveTimer.current)
    saveDraft(formData, newImageData, designData)
  }

  async function handleDesignImages(itemIndex, files) {
    const existing = designData[itemIndex] || []
    const remaining = 5 - existing.length
    if (remaining <= 0) return
    setUploadingFor(`design-${itemIndex}`)
    const uploaded = [...existing]

    for (const file of Array.from(files).slice(0, remaining)) {
      try {
        const compressed = await compressImage(file)
        const path = `${slug}/${categoryId}/designs/${Date.now()}-${compressed.name}`
        const { error: uploadError } = await supabase.storage
          .from('material-images')
          .upload(path, compressed, { upsert: false })
        if (uploadError) { console.error('Upload error:', uploadError); continue }
        const { data: urlData } = supabase.storage.from('material-images').getPublicUrl(path)
        uploaded.push({ url: urlData.publicUrl, name: file.name })
      } catch (e) {
        console.error('Design image error:', e)
      }
    }

    const newDesignData = { ...designData, [itemIndex]: uploaded }
    setDesignData(newDesignData)
    setUploadingFor(null)
    clearTimeout(saveTimer.current)
    saveDraft(formData, imageData, newDesignData)
  }

  function removeDesignImage(itemIndex, imgIndex) {
    const updated = [...(designData[itemIndex] || [])]
    updated.splice(imgIndex, 1)
    const newDesignData = { ...designData, [itemIndex]: updated }
    setDesignData(newDesignData)
    clearTimeout(saveTimer.current)
    saveDraft(formData, imageData, newDesignData)
  }

  function buildPricingData(data, imgs, designs) {
    return (schedule?.items || []).map((item, i) => {
      const d = { ...data[i] }
      if (d.priceSqm) d.priceSqft = parseFloat((parseFloat(d.priceSqm) / SQM_TO_SQFT).toFixed(2))
      d.images = imgs[i] || []
      d.designOptions = designs?.[i] || []
      return { ...item, ...d }
    })
  }

  async function saveDraft(data, imgs, designs) {
    if (!project || !schedule) return
    setSaving(true)
    await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectSlug: slug, category: categoryId,
        manufacturerName: schedule.manufacturer || 'Manufacturer',
        pricingData: buildPricingData(data, imgs || imageData, designs || designData),
        isDraft: true,
      }),
    })
    setSaving(false)
    setLastSaved(new Date())
  }

  async function submit() {
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectSlug: slug, category: categoryId,
        manufacturerName: schedule.manufacturer || 'Manufacturer',
        pricingData: buildPricingData(formData, imageData, designData),
      }),
    })
    setSubmitting(false)
    if (!res.ok) { const d = await res.json(); setError(d.error || 'Submission failed.'); return }
    setSubmitted(true)
  }

  // Lets the manufacturer download what they've entered so far as a CSV —
  // useful for their own records, or to forward internally before submitting.
  function exportMyCSV() {
    if (!schedule || !category) return
    const priceFields = category.formFields.filter(f => f.type !== 'calculated' && f.type !== 'images')
    const headers = ['Material', 'Finish / Detail', 'Locations', ...priceFields.map(f => f.label)]
    const lines = [headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',')]
    schedule.items.forEach((item, i) => {
      const d = formData[i] || {}
      const detail = [item.finish, item.cut, item.style, item.material].filter(Boolean).join(' / ')
      const locations = (item.locations || []).join('; ')
      const row = [
        `"${(item.name || '').replace(/"/g, '""')}"`,
        `"${detail.replace(/"/g, '""')}"`,
        `"${locations.replace(/"/g, '""')}"`,
        ...priceFields.map(f => `"${String(d[f.id] ?? '').replace(/"/g, '""')}"`),
      ]
      lines.push(row.join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const safeManufacturer = (schedule.manufacturer || 'pricing').toLowerCase().replace(/[^a-z0-9]+/g, '-')
    a.download = `${safeManufacturer}-${categoryId}-pricing.csv`
    a.click()
  }

  const isDoors = category?.id === 'doors'
  const filledCount = Object.values(formData).filter(d => isDoors ? d.unitPrice : d.priceSqm).length
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
        <div style={{ fontSize:13, fontWeight:400, color:'rgba(247,245,240,0.5)', lineHeight:1.7 }}>Your pricing has been submitted. You can return to this link at any time to update.</div>
        <button onClick={() => setSubmitted(false)} style={{ marginTop:32, padding:'12px 28px', fontSize:10, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', background:'transparent', border:'1px solid rgba(247,245,240,0.2)', color:'rgba(247,245,240,0.6)', cursor:'pointer' }}>Return & Edit</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div style={{ background:'var(--black)', padding:'0 40px', height:60, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:100 }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, color:'#f7f5f0', letterSpacing:'0.06em' }}>
          Relative <span style={{ color:'var(--gold-light)' }}>Estates</span>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'rgba(255,255,255,0.35)' }}>{category?.label} Pricing Request</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:14, fontStyle:'italic', color:'var(--gold-light)', marginTop:1 }}>{project?.name}</div>
        </div>
      </div>

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
          <button className="btn btn-outline btn-sm" onClick={exportMyCSV}>Export CSV</button>
          <button className="btn btn-black btn-sm" onClick={submit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Pricing →'}</button>
        </div>
      </div>

      <div style={{ maxWidth:1100, margin:'0 auto', padding:'32px 32px 80px' }}>
        <div style={{ background:'var(--gold-pale)', border:'1px solid rgba(154,122,74,0.2)', padding:'14px 18px', marginBottom:24, display:'flex', gap:14, alignItems:'flex-start' }}>
          <div style={{ fontSize:16, color:'var(--gold)', flexShrink:0 }}>ℹ</div>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--black)', marginBottom:3 }}>Instructions</div>
            <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)', lineHeight:1.6 }}>
              {isDoors
                ? 'Enter your unit price per door below. Upload up to 5 design options for each door — the client will review and approve one. Progress saves automatically. Submit when ready.'
                : 'Enter pricing for each material below. Progress saves automatically. Price per sqm auto-converts to sqft. Upload photos of each material. Submit when ready.'}
            </div>
          </div>
        </div>

        {error && <div style={{ padding:'10px 14px', background:'var(--danger-bg)', border:'1px solid var(--danger)', fontSize:12, color:'var(--danger)', marginBottom:20 }}>{error}</div>}

        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              {isDoors ? (
                <tr>
                  <th style={fth('60px')}>NO</th>
                  <th style={fth('120px')}>Location</th>
                  <th style={fth('140px')}>Description</th>
                  <th style={fth('90px')}>Size</th>
                  <th style={fth('90px')}>Door Type</th>
                  <th style={fth('110px')}>Unit Price ($) *</th>
                  <th style={fth('260px')}>Design Options (up to 5)</th>
                  <th style={fth('180px')}>Notes</th>
                </tr>
              ) : (
                <tr>
                  <th style={fth('180px')}>Material</th>
                  <th style={fth('110px')}>Price / sqm ($) *</th>
                  <th style={fth('100px')}>= Per sqft</th>
                  <th style={fth('90px')}>Min Order</th>
                  <th style={fth('90px')}>Vol Break</th>
                  <th style={fth('100px')}>Vol Price / sqm</th>
                  <th style={fth('120px')}>Images</th>
                  <th style={fth('200px')}>Notes</th>
                </tr>
              )}
            </thead>
            <tbody>
              {schedule?.items?.map((item, i) => {
                const d = formData[i] || {}
                const imgs = imageData[i] || []
                const designs = designData[i] || []
                const hasPrice = isDoors ? !!d.unitPrice : !!d.priceSqm
                const sqftCalc = d.priceSqm ? `$${(parseFloat(d.priceSqm)/SQM_TO_SQFT).toFixed(2)}` : '—'
                const isUploading = uploadingFor === i
                const isUploadingDesign = uploadingFor === `design-${i}`
                return (
                  <tr key={i} style={{ background:hasPrice?'#f0faf3':'var(--white)', transition:'background 0.2s' }}>

                    {isDoors ? (
                      <>
                        <td style={ftd()}><div style={{ fontSize:13, fontWeight:700 }}>{item.no}</div></td>
                        <td style={ftd()}><div style={{ fontSize:12, color:'var(--gray)' }}>{item.location || '—'}</div></td>
                        <td style={ftd()}>
                          <div style={{ fontSize:11, color:'var(--gray)', lineHeight:1.4, maxHeight:50, overflow:'hidden' }}
                            title={item.description || ''}>
                            {item.description ? item.description.substring(0, 80) + (item.description.length > 80 ? '…' : '') : '—'}
                          </div>
                        </td>
                        <td style={ftd()}>
                          <div style={{ fontSize:11, lineHeight:1.5 }}>
                            {item.widthInches && item.heightInches ? `${item.widthInches}" × ${item.heightInches}"` : '—'}
                            {item.thickMm && <div style={{ fontSize:10, color:'var(--gray-light)' }}>{item.thickMm} thick</div>}
                          </div>
                        </td>
                        <td style={ftd()}><div style={{ fontSize:11, fontWeight:500, color:'var(--gold)' }}>{item.type || '—'}</div></td>
                        <td style={ftd()}>
                          <input type="number" value={d.unitPrice||''} onChange={e=>updateField(i,'unitPrice',e.target.value)} placeholder="0.00" min="0" step="0.01" style={inp(hasPrice)}/>
                        </td>
                        <td style={ftd()}>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:4, alignItems:'center' }}>
                            {designs.map((img, idx) => (
                              <div key={idx} style={{ position:'relative' }}>
                                <img src={img.url} alt={img.name}
                                  style={{ width:48, height:48, objectFit:'cover', border:'2px solid var(--gold)', cursor:'pointer' }}
                                  title={`Option ${idx+1}: ${img.name}`}
                                />
                                <div style={{ position:'absolute', top:-4, left:-4, width:16, height:16, background:'var(--gold)', color:'white', fontSize:9, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%' }}>{idx+1}</div>
                                <button onClick={() => removeDesignImage(i, idx)}
                                  style={{ position:'absolute', top:-4, right:-4, width:16, height:16, background:'var(--danger)', color:'white', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%', border:'none', cursor:'pointer', lineHeight:1 }}>×</button>
                              </div>
                            ))}
                            {designs.length < 5 && (
                              <label style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:48, height:48, background:'var(--cream)', border:`1px dashed ${isUploadingDesign?'var(--gold)':'var(--border-dark)'}`, cursor:'pointer', gap:2, flexShrink:0, transition:'all 0.15s' }}>
                                {isUploadingDesign ? (
                                  <div style={{ width:14, height:14, border:'1.5px solid var(--border)', borderTopColor:'var(--gold)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
                                ) : (
                                  <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                                    <span style={{ fontSize:7, color:'var(--gray-light)', letterSpacing:'0.08em', textTransform:'uppercase' }}>{designs.length}/5</span>
                                  </>
                                )}
                                <input type="file" accept="image/*" multiple style={{ display:'none' }} disabled={isUploadingDesign}
                                  onChange={e => handleDesignImages(i, e.target.files)}/>
                              </label>
                            )}
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
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
                        <td style={ftd()}><input type="number" value={d.priceSqm||''} onChange={e=>updateField(i,'priceSqm',e.target.value)} placeholder="0.00" min="0" step="0.01" style={inp(hasPrice)}/></td>
                        <td style={{ ...ftd(), background:'var(--cream)', fontSize:13, fontWeight:hasPrice?600:400, color:hasPrice?'var(--gold)':'var(--gray-light)' }}>{sqftCalc}</td>
                        <td style={ftd()}><input type="number" value={d.moq||''} onChange={e=>updateField(i,'moq',e.target.value)} placeholder="0" min="0" style={inp(false)}/></td>
                        <td style={ftd()}><input type="number" value={d.volBreakQty||''} onChange={e=>updateField(i,'volBreakQty',e.target.value)} placeholder="0" min="0" style={inp(false)}/></td>
                        <td style={ftd()}><input type="number" value={d.volBreakPrice||''} onChange={e=>updateField(i,'volBreakPrice',e.target.value)} placeholder="0.00" min="0" step="0.01" style={inp(false)}/></td>
                        <td style={ftd()}>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:4, alignItems:'center' }}>
                            {imgs.map((img, idx) => (
                              <img key={idx} src={img.url} alt={img.name}
                                style={{ width:40, height:40, objectFit:'cover', border:'1px solid var(--border)', cursor:'pointer' }}
                                title={img.name}
                              />
                            ))}
                            <label style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', width:40, height:40, background:'var(--cream)', border:`1px dashed ${isUploading?'var(--gold)':'var(--border-dark)'}`, cursor:'pointer', gap:2, flexShrink:0, transition:'all 0.15s' }}>
                              {isUploading ? (
                                <div style={{ width:14, height:14, border:'1.5px solid var(--border)', borderTopColor:'var(--gold)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
                              ) : (
                                <>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                                  <span style={{ fontSize:7, color:'var(--gray-light)', letterSpacing:'0.08em', textTransform:'uppercase' }}>Add</span>
                                </>
                              )}
                              <input type="file" accept="image/*" multiple style={{ display:'none' }} disabled={isUploading}
                                onChange={e => handleImages(i, e.target.files)}/>
                            </label>
                          </div>
                        </td>
                      </>
                    )}

                    <td style={ftd()}><input type="text" value={d.notes||''} onChange={e=>updateField(i,'notes',e.target.value)} placeholder={isDoors ? 'Hardware, fire rating, notes…' : 'Lead time, availability, notes…'} style={{ ...inp(false), width:'100%' }}/></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:16, paddingTop:24, borderTop:'1px solid var(--border)', marginTop:24 }}>
          <div style={{ fontSize:12, fontWeight:400, color:'var(--gray)' }}>{filledCount} of {totalCount} items priced · Results sent to emma@relativeestates.com</div>
          <div style={{ display:'flex', gap:10 }}>
            <button className="btn btn-outline btn-lg" onClick={exportMyCSV}>Export CSV</button>
            <button className="btn btn-black btn-lg" onClick={submit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Pricing →'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function fth(minWidth) {
  return { padding:'10px 12px', textAlign:'left', fontSize:9, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--gray-light)', background:'var(--cream)', borderBottom:'2px solid var(--black)', whiteSpace:'nowrap', minWidth }
}
function ftd() {
  return { padding:'8px 10px', borderBottom:'1px solid var(--border)', verticalAlign:'middle' }
}
function inp(filled) {
  return { width:'100%', padding:'6px 8px', fontSize:13, fontWeight:filled?600:400, background:filled?'white':'transparent', border:'1px solid', borderColor:filled?'var(--gold)':'var(--border)', color:'var(--black)', transition:'all 0.15s', fontFamily:'var(--font-body)', outline:'none' }
}

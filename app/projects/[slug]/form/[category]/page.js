'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { getCategory } from '@/lib/categories'
import { sqmToSqft } from '@/lib/utils'

export default function ManufacturerForm({ params }) {
  const { slug, category: categoryId } = params
  const [project, setProject] = useState(null)
  const [schedule, setSchedule] = useState(null)
  const [category, setCategory] = useState(null)
  const [formData, setFormData] = useState({})
  const [images, setImages] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadData()
  }, [slug, categoryId])

  async function loadData() {
    // Load project
    const { data: proj } = await supabase
      .from('projects')
      .select('*')
      .eq('slug', slug)
      .single()

    if (!proj) { setError('Project not found'); setLoading(false); return }
    setProject(proj)

    // Load schedule for this category
    const { data: sched } = await supabase
      .from('schedules')
      .select('*')
      .eq('project_id', proj.id)
      .eq('category', categoryId)
      .single()

    if (!sched) { setError('Schedule not found for this category'); setLoading(false); return }
    setSchedule(sched)

    const cat = getCategory(categoryId)
    if (!cat) { setError('Unknown category'); setLoading(false); return }
    setCategory(cat)

    // Initialize form data for each item
    const initial = {}
    sched.items.forEach((item, i) => {
      initial[i] = {}
      cat.formFields.forEach(field => {
        if (field.type !== 'calculated') initial[i][field.id] = ''
      })
    })
    setFormData(initial)
    setLoading(false)
  }

  function updateField(itemIndex, fieldId, value) {
    setFormData(prev => ({
      ...prev,
      [itemIndex]: { ...prev[itemIndex], [fieldId]: value }
    }))
  }

  async function handleImageUpload(itemIndex, files) {
    const newImages = { ...images }
    if (!newImages[itemIndex]) newImages[itemIndex] = []

    for (const file of files) {
      const reader = new FileReader()
      reader.onload = e => {
        newImages[itemIndex] = [...(newImages[itemIndex] || []), {
          name: file.name,
          data: e.target.result,
        }]
        setImages({ ...newImages })
      }
      reader.readAsDataURL(file)
    }
  }

  async function submit() {
    setSubmitting(true)
    setError('')

    const manufacturerName = schedule?.manufacturer || 'Unknown Manufacturer'

    // Build pricing data array
    const pricingData = schedule.items.map((item, i) => {
      const data = formData[i] || {}
      const imgList = images[i] || []

      // Auto-calculate sqft if sqm is present
      if (data.priceSqm) data.priceSqft = sqmToSqft(parseFloat(data.priceSqm))
      if (data.volBreakPrice) data.volBreakPriceSqft = sqmToSqft(parseFloat(data.volBreakPrice))

      return {
        ...item,
        ...data,
        imageCount: imgList.length,
        // Note: in production you'd upload images to Supabase Storage
        // For now we store the count and notes
      }
    })

    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectSlug: slug,
        category: categoryId,
        manufacturerName,
        pricingData,
      }),
    })

    setSubmitting(false)

    if (!res.ok) {
      const d = await res.json()
      setError(d.error || 'Submission failed. Please try again.')
      return
    }

    setSubmitted(true)
  }

  // ── Loading ──
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  // ── Error ──
  if (error && !project) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 300, marginBottom: 8 }}>
          Not Found
        </div>
        <div style={{ color: 'var(--gray)', fontSize: 13 }}>{error}</div>
      </div>
    </div>
  )

  // ── Submitted ──
  if (submitted) return (
    <div style={{ minHeight: '100vh', background: 'var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 300,
          letterSpacing: '0.22em', textTransform: 'uppercase',
          color: 'var(--gold-light)', marginBottom: 24,
        }}>
          Submission Received
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 48, fontWeight: 200,
          color: '#f7f5f0', lineHeight: 1, marginBottom: 16,
        }}>
          Thank you.
        </div>
        <div style={{ fontSize: 13, fontWeight: 300, color: 'rgba(247,245,240,0.5)', lineHeight: 1.7 }}>
          Your pricing has been submitted to the Relative Estates team.
          They will be in touch if they have any questions.
        </div>
      </div>
    </div>
  )

  const catLabel = category?.label || categoryId

  return (
    <div style={{ minHeight: '100vh', background: 'var(--off-white)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--black)', padding: '0 48px', height: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 300,
          color: '#f7f5f0', letterSpacing: '0.06em',
        }}>
          Relative <span style={{ color: 'var(--gold-light)' }}>Estates</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>
            Pricing Request
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 14, fontStyle: 'italic',
            color: 'var(--gold-light)',
          }}>
            {project?.name}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '48px 32px 80px' }}>
        {/* Page header */}
        <div style={{ marginBottom: 40 }}>
          <div className="page-eyebrow">{catLabel} — Supplier Pricing Form</div>
          <div className="page-title" style={{ marginBottom: 16 }}>
            {catLabel} <em>Quote Request</em>
          </div>

          {/* Instructions */}
          <div style={{
            background: 'var(--gold-pale)', border: '1px solid rgba(154,122,74,0.2)',
            padding: '18px 22px', display: 'flex', gap: 16, alignItems: 'flex-start',
          }}>
            <div style={{ fontSize: 16, color: 'var(--gold)', flexShrink: 0 }}>ℹ</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--black)', marginBottom: 4 }}>
                Instructions
              </div>
              <div style={{ fontSize: 11, fontWeight: 300, color: 'var(--gray)', lineHeight: 1.7 }}>
                For each item below, please fill in your pricing and any relevant details.
                Upload reference images where available. Add notes for lead time, availability,
                or any special considerations. Submit when complete — results will be sent
                directly to the Relative Estates team.
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div style={{
            padding: '12px 16px', background: 'var(--danger-bg)',
            border: '1px solid var(--danger)', fontSize: 12,
            color: 'var(--danger)', marginBottom: 24,
          }}>
            {error}
          </div>
        )}

        {/* Form items */}
        {schedule?.items?.map((item, i) => (
          <FormItem
            key={i}
            index={i}
            item={item}
            category={category}
            formData={formData[i] || {}}
            images={images[i] || []}
            onUpdate={(fieldId, value) => updateField(i, fieldId, value)}
            onImages={(files) => handleImageUpload(i, files)}
          />
        ))}

        {/* Submit */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 16, paddingTop: 32,
          borderTop: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 300, color: 'var(--gray)' }}>
            Results sent to emma@relativeestates.com
          </div>
          <button
            className="btn btn-black btn-lg"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? 'Submitting…' : 'Submit Pricing →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Individual Form Item ──────────────────────────────────
function FormItem({ index, item, category, formData, images, onUpdate, onImages }) {
  return (
    <div style={{
      background: 'var(--white)', border: '1px solid var(--border)',
      marginBottom: 14, overflow: 'hidden',
    }}>
      {/* Item header */}
      <div style={{
        background: 'var(--black)', padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 300, color: '#f7f5f0',
          }}>
            {item.name}
          </div>
          <div style={{ fontSize: 10, fontWeight: 300, color: 'var(--gold-light)', marginTop: 2 }}>
            {[item.finish, item.cut, item.style, item.material].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{
          fontSize: 9, fontWeight: 300,
          color: 'rgba(247,245,240,0.25)', textAlign: 'right',
          lineHeight: 1.6, maxWidth: 220,
        }}>
          {(item.locations || []).slice(0, 3).join(' · ')}
          {(item.locations || []).length > 3 && ` +${item.locations.length - 3} more`}
        </div>
      </div>

      {/* Fields */}
      <div style={{ padding: '20px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {category.formFields.map(field => {
            if (field.type === 'calculated') {
              const sourceVal = parseFloat(formData[field.sourceField]) || 0
              const computed = sourceVal ? field.formula(sourceVal) : null
              return (
                <div key={field.id}>
                  <label className="field-label">{field.label}</label>
                  <div style={{
                    padding: '10px 14px', background: 'var(--cream)',
                    border: '1px solid var(--border)',
                    fontSize: 13, fontWeight: 300,
                    color: computed ? 'var(--gold)' : 'var(--gray-light)',
                  }}>
                    {computed ? `$${computed}` : '—'}
                  </div>
                </div>
              )
            }

            if (field.type === 'images') {
              return (
                <div key={field.id} style={{ gridColumn: '1 / -1' }}>
                  <label className="field-label">{field.label}</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {images.map((img, idx) => (
                      <img
                        key={idx} src={img.data} alt={img.name}
                        style={{ width: 72, height: 72, objectFit: 'cover', border: '1px solid var(--border)' }}
                      />
                    ))}
                    <label style={{
                      width: 72, height: 72, background: 'var(--cream)',
                      border: '1px dashed var(--border-dark)',
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', gap: 4, cursor: 'pointer',
                      fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: 'var(--gray-light)', flexShrink: 0,
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                        <rect x="3" y="3" width="18" height="18" rx="1"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      Add
                      <input
                        type="file" accept="image/*" multiple style={{ display: 'none' }}
                        onChange={e => onImages(Array.from(e.target.files))}
                      />
                    </label>
                  </div>
                </div>
              )
            }

            if (field.type === 'textarea') {
              return (
                <div key={field.id} style={{ gridColumn: '1 / -1' }}>
                  <label className="field-label">{field.label}</label>
                  <textarea
                    className="field-input"
                    value={formData[field.id] || ''}
                    onChange={e => onUpdate(field.id, e.target.value)}
                    placeholder={field.placeholder}
                    rows={3}
                  />
                </div>
              )
            }

            if (field.type === 'select') {
              return (
                <div key={field.id}>
                  <label className="field-label">{field.label}</label>
                  <select
                    className="field-input"
                    value={formData[field.id] || ''}
                    onChange={e => onUpdate(field.id, e.target.value)}
                  >
                    <option value="">Select…</option>
                    {field.options?.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              )
            }

            return (
              <div key={field.id}>
                <label className="field-label">
                  {field.label}
                  {field.required && <span style={{ color: 'var(--gold)', marginLeft: 4 }}>*</span>}
                </label>
                <input
                  className="field-input"
                  type={field.type || 'text'}
                  value={formData[field.id] || ''}
                  onChange={e => onUpdate(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  step={field.type === 'number' ? '0.01' : undefined}
                  min={field.type === 'number' ? '0' : undefined}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

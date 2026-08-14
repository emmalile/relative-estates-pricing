'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { allCategories, liveCategories, parseCSVForCategory, carryOverLocations } from '@/lib/categories'
import { formatRelativeTime, slugify, plural, formatCurrency, displayProjectName, displayClient, isTypingTarget } from '@/lib/utils'
import ActionMenu from '@/app/components/ActionMenu'

// ═══════════════════════════════════════════════════════
// NAV CONFIG
// ═══════════════════════════════════════════════════════
// Home, All projects and Archived were three destinations for one list in
// three states. Archived is a filter wearing a destination's clothes, and
// "Home" and "All projects" differed only by which filter was applied.
// One destination, with the state as a filter above the table.
const NAV = [
  { id: 'projects', label: 'Projects', icon: 'ti-building' },
  { id: 'vendors', label: 'Vendors', icon: 'ti-users', href: '/vendors' },
  { id: 'repository', label: 'Repository', icon: 'ti-package', href: '/repository' },
  { id: 'reporting', label: 'Reporting', icon: 'ti-chart-bar', href: '/reporting' },
  { id: 'people', label: 'People', icon: 'ti-user-shield', href: '/people' },
]

function categoryLabel(id) {
  return allCategories.find(c => c.id === id)?.label || id
}

export default function AdminHome() {
  const [projects, setProjects] = useState([])
  const [archivedProjects, setArchivedProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingArchived, setLoadingArchived] = useState(true)

  const [search, setSearch] = useState('')
  const [scope, setScope] = useState('active')   // active | archived
  const [openMenuId, setOpenMenuId] = useState(null)
  const [overview, setOverview] = useState({ projects: [], totals: null, overdueDays: 5 })

  const [showNewModal, setShowNewModal] = useState(false)
  const [updateTarget, setUpdateTarget] = useState(null)

  useEffect(() => { loadAll() }, [])

  // `/` puts the cursor in search from anywhere on the page, the same as it
  // does in every tool these people already use.
  const searchRef = useRef(null)
  useEffect(() => {
    function onKey(e) {
      if (isTypingTarget(e)) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close any open folder/row menu on outside click
  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  async function loadAll() {
    setLoading(true)
    setLoadingArchived(true)
    const [activeRes, archivedRes] = await Promise.all([
      fetch('/api/projects'),
      fetch('/api/projects?archived_only=true'),
    ])
    const active = activeRes.ok ? await activeRes.json() : []
    const archived = archivedRes.ok ? await archivedRes.json() : []
    setProjects(active)
    setArchivedProjects(archived)
    setLoading(false)
    setLoadingArchived(false)
    // Value, pending count and overdue age per project — the numbers the
    // list is sorted and filtered by.
    const ov = await fetch('/api/projects/overview')
    if (ov.ok) setOverview(await ov.json())
  }

  async function archiveProject(project) {
    if (!confirm(`Archive "${project.name}"? It will move to Archived and can be restored anytime.`)) return
    const res = await fetch(`/api/projects/delete?id=${project.id}`, { method: 'DELETE' })
    if (!res.ok) { alert('Failed to archive project. Please try again.'); return }
    setProjects(prev => prev.filter(p => p.id !== project.id))
    setArchivedProjects(prev => [{ ...project, deleted_at: new Date().toISOString() }, ...prev])
  }

  async function restoreProject(project) {
    const res = await fetch(`/api/projects/restore?id=${project.id}`, { method: 'POST' })
    if (!res.ok) { alert('Failed to restore project. Please try again.'); return }
    setArchivedProjects(prev => prev.filter(p => p.id !== project.id))
    const restored = { ...project, deleted_at: null }
    setProjects([restored, ...projects])
  }

  function copyDashboardLink(project) {
    navigator.clipboard?.writeText(`${window.location.origin}/projects/${project.slug}/dashboard`)
    alert('Dashboard link copied')
  }
  function copyClientLink(project) {
    navigator.clipboard?.writeText(`${window.location.origin}/projects/${project.slug}/client`)
    alert('Client link copied — this one has no passcode, so only share it with the client directly.')
  }
  function openDashboard(project) {
    window.location.href = `/projects/${project.slug}/dashboard`
  }

  const q = search.trim().toLowerCase()

  // The API returns them most-urgent-first; that order is the answer to
  // "what is waiting on me", so it is preserved rather than re-sorted here.
  const rows = useMemo(() => {
    const bySlug = {}
    projects.forEach(p => { bySlug[p.slug] = p })
    return (overview.projects || [])
      .map(o => ({ ...bySlug[o.slug], ...o, id: bySlug[o.slug]?.id || o.slug }))
      .filter(p => !q || p.name.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q))
  }, [projects, overview.projects, q])

  const filteredArchived = useMemo(() => {
    if (!q) return archivedProjects
    return archivedProjects.filter(p => p.name.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q))
  }, [archivedProjects, q])

  return (
    <div className="shell">
      {/* ── SIDEBAR ── */}
      <aside className="side">
        <button className="side-new" onClick={() => setShowNewModal(true)}>
          <i className="ti ti-plus" /> <span>New project</span>
        </button>

        <ul className="side-nav">
          {NAV.map(n => (
            <li key={n.id} className={n.id === 'projects' ? 'active' : ''}
              onClick={() => n.href && (window.location.href = n.href)}>
              <i className={`ti ${n.icon}`} /> <span>{n.label}</span>
            </li>
          ))}
        </ul>

        {/* The category filter that lived here duplicated the table's own
            column and would not have survived a fifth category. The column
            stays; the filter does not. */}

        {/* Settings and the notifications bell lived here. Both led to the
            "not built yet" placeholder, so they're out until there's a real
            view behind them — Dropbox settings stay reachable from the
            Dropbox item above. */}

        {/* The count stays; the bar it used to sit in does not. It filled at
            8% per project against no denominator, so it implied a quota that
            does not exist — a storage meter inherited from the file-manager
            look, measuring nothing. */}
        <div className="side-storage">
          <span>{plural(projects.length, 'active project')}</span>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="main">
        <div className="topbar">
          <div className="topbar-logo">Relative <span>Estates</span></div>
          <div className="searchbar">
            <i className="ti ti-search" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search projects by name or client…   /"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {/* Sign out was the highest-contrast control on the page, sitting
              beside the avatar that is the conventional home for it. Dropbox
              moved in here too — it is an integration you configure once,
              not a place to work, and this is the settings surface now. */}
          <div className="topbar-right">
            <ActionMenu
              trigger="avatar"
              initials="E"
              label="Account and settings"
              items={[
                { label: 'Dropbox settings', icon: 'ti-brand-dropbox', onClick: () => { window.location.href = '/settings/dropbox' } },
                { sep: true },
                { label: 'Sign out', onClick: signOut },
              ]}
            />
          </div>
        </div>

        <div className="content">
          {/* ── 4.1 A status strip, not a folder count ──
              The whole whitespace budget goes here. These are the questions
              people open this page to answer; the old header answered "what
              folders exist" and the only number on screen was 52. */}
          <StatusStrip totals={overview.totals} overdueDays={overview.overdueDays} loading={loading} />

          <div className="file-controls" style={{ marginTop:'var(--s-6)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'var(--s-2)' }}>
              {[
                { id:'active', label:'Active' },
                { id:'archived', label:'Archived' },
              ].map(f => (
                <button key={f.id} onClick={() => setScope(f.id)}
                  className={`btn btn-sm ${scope === f.id ? 'btn-black' : 'btn-outline'}`}>
                  {f.label}
                </button>
              ))}
              <span style={{ fontSize:'var(--t-xs)', color:'var(--gray)', marginLeft:'var(--s-2)' }}>
                {scope === 'active'
                  ? plural(rows.length, 'project')
                  : plural(filteredArchived.length, 'archived project')}
                {scope === 'active' && rows.length > 0 && ' · most urgent first'}
              </span>
            </div>
          </div>

          {scope === 'archived' ? (
            <ArchivedView
              projects={filteredArchived}
              loading={loadingArchived}
              search={search}
              onRestore={restoreProject}
            />
          ) : loading ? (
            <div style={{ padding:'var(--s-6) 0' }}><span className="spinner" /></div>
          ) : rows.length === 0 ? (
            <EmptyProjects search={search} onCreate={() => setShowNewModal(true)} />
          ) : (
            <table className="ftable">
              <thead>
                <tr>
                  <th style={{ width:'30%' }}>Project</th>
                  <th>Client</th>
                  <th style={{ textAlign:'right' }}>Value</th>
                  <th>Status</th>
                  <th style={{ textAlign:'right' }}>Pending</th>
                  <th>Updated</th>
                  <th style={{ width:36 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <ProjectListRow
                    key={p.id}
                    project={p}
                    menuOpen={openMenuId === p.id}
                    onOpen={openDashboard}
                    onToggleMenu={() => setOpenMenuId(openMenuId === p.id ? null : p.id)}
                    onArchive={archiveProject}
                    onUpdateCSV={(project, category) => { setUpdateTarget({ project, category }); setOpenMenuId(null) }}
                    onCopyDashboard={copyDashboardLink}
                    onCopyClient={copyClientLink}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showNewModal && (
        <NewProjectModal
          onClose={() => setShowNewModal(false)}
          onCreate={(p) => { setProjects([p, ...projects]); setShowNewModal(false) }}
        />
      )}

      {updateTarget && (
        <UpdateCSVModal
          project={updateTarget.project}
          category={updateTarget.category}
          onClose={() => setUpdateTarget(null)}
          onUpdated={() => { setUpdateTarget(null); alert('Schedule updated successfully.') }}
        />
      )}
    </div>
  )
}

// ── Folder Card (Active projects — grid view) ─────────────
function FolderCard({ project, itemCount, menuOpen, onOpen, onToggleMenu, onArchive, onUpdateCSV, onCopyDashboard, onCopyClient }) {
  return (
    <div className="folder" onClick={() => onOpen(project)}>
      <div className="folder-icon"><i className="ti ti-folder" /></div>
      <div className="folder-info">
        <div className="folder-name">{project.name}</div>
        <div className="folder-sub">{itemCount} item{itemCount === 1 ? '' : 's'} · Updated {formatRelativeTime(project.updated_at)}</div>
      </div>
      <button className="folder-menu" onClick={e => { e.stopPropagation(); onToggleMenu() }}>
        <i className="ti ti-dots-vertical" />
      </button>
      {menuOpen && (
        <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
          <button onClick={() => onOpen(project)}>Open dashboard</button>
          <button onClick={() => onCopyDashboard(project)}>Copy dashboard link</button>
          <button onClick={() => onCopyClient(project)}>Copy client link</button>
          {(project.categories || []).length > 0 && <div className="menu-sep" />}
          {(project.categories || []).map(cat => (
            <button key={cat} onClick={() => onUpdateCSV(project, cat)}>Update {categoryLabel(cat)} CSV</button>
          ))}
          <div className="menu-sep" />
          <button className="menu-danger" onClick={() => onArchive(project)}>Archive project</button>
        </div>
      )}
    </div>
  )
}

// ── Project List Row (Active projects — list view) ────────
function ProjectListRow({ project, menuOpen, onOpen, onToggleMenu, onArchive, onUpdateCSV, onCopyDashboard, onCopyClient }) {
  const cats = project.categories || []
  const dot = project.status === 'overdue' ? 'var(--danger)'
            : project.status === 'pending' ? 'var(--warning)'
            : project.status === 'complete' ? 'var(--success)'
            : 'var(--g400)'
  return (
    <tr className="frow" onClick={() => onOpen(project)}>
      <td>
        <span style={{ display:'inline-flex', alignItems:'center', gap:'var(--s-3)' }}>
          <span style={{ width:8, height:8, borderRadius:'var(--r-pill)', background:dot, flexShrink:0 }} />
          <span style={{ fontWeight:500 }}>{displayProjectName(project.name, allCategories.map(c => c.label))}</span>
        </span>
      </td>
      <td className="fcat">{displayClient(project.client).name || '—'}</td>
      <td className="fprice" style={{ textAlign:'right' }}>
        {project.value > 0 ? formatCurrency(project.value) : <span className="fcat">—</span>}
      </td>
      <td><StatusBadge status={project.status} waitingDays={project.waitingDays} /></td>
      {/* "3 of 52" implies an action. A bare 52 does not. */}
      <td className="fprice" style={{ textAlign:'right' }}>
        {project.pending > 0
          ? <span>{project.pending} of {project.itemCount}</span>
          : <span className="fcat">{project.itemCount ? `0 of ${project.itemCount}` : '—'}</span>}
      </td>
      <td className="fcat">{formatRelativeTime(project.updatedAt || project.updated_at)}</td>
      <td onClick={e => e.stopPropagation()}>
        <div style={{ position:'relative' }}>
          <button className="folder-menu" onClick={e => { e.stopPropagation(); onToggleMenu() }} aria-label="Project actions">
            <i className="ti ti-dots-vertical" />
          </button>
          {menuOpen && (
            <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
              <button onClick={() => onOpen(project)}>Open dashboard</button>
              <button onClick={() => onCopyDashboard(project)}>Copy dashboard link</button>
              <button onClick={() => onCopyClient(project)}>Copy client link</button>
              {cats.length > 0 && <div className="menu-sep" />}
              {cats.map(cat => (
                <button key={cat} onClick={() => onUpdateCSV(project, cat)}>Update {categoryLabel(cat)} CSV</button>
              ))}
              <div className="menu-sep" />
              <button className="menu-danger" onClick={() => onArchive(project)}>Archive project</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Archived Projects View ────────────────────────────────
function ArchivedView({ projects, loading, search, onRestore }) {
  return (
    <>
      <div className="section-header"><i className="ti ti-archive" /> Archived projects</div>
      {loading ? (
        <div style={{ padding: '24px 0' }}><span className="spinner" /></div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{search ? `No archived projects match "${search}"` : 'No archived projects'}</div>
          <div className="empty-state-sub">Projects you archive show up here and can be restored anytime.</div>
        </div>
      ) : (
        <div className="folders" style={{ flexWrap: 'wrap' }}>
          {projects.map(p => (
            <div key={p.id} className="folder" style={{ cursor: 'default' }}>
              <div className="folder-icon"><i className="ti ti-archive" /></div>
              <div className="folder-info">
                <div className="folder-name">{p.name}</div>
                <div className="folder-sub">Archived {formatRelativeTime(p.deleted_at)}</div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => onRestore(p)}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ── Update CSV Modal ──────────────────────────────────────
// Unchanged from the previous design — logic left exactly as-is.
function UpdateCSVModal({ project, category, onClose, onUpdated }) {
  const [items, setItems] = useState(null)
  const [existingItems, setExistingItems] = useState([])
  const [itemCount, setItemCount] = useState(0)
  const [manufacturer, setManufacturer] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const catDef = allCategories.find(c => c.id === category)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('schedules')
        .select('manufacturer, items')
        .eq('project_id', project.id)
        .eq('category', category)
        .single()
      if (data) {
        setManufacturer(data.manufacturer || '')
        setExistingItems(data.items || [])
        setItemCount(data.items?.length || 0)
      }
    }
    load()
  }, [project.id, category])

  async function handleCSV(file) {
    const text = await file.text()
    // An import replaces the items outright, so keep the rooms already on
    // the schedule for any item the CSV doesn't name them for.
    const parsed = carryOverLocations(parseCSVForCategory(text, category), existingItems, category)
    setItems(parsed)
    setItemCount(parsed.length)
  }

  async function save() {
    setSaving(true)
    setError('')

    const updates = { manufacturer }
    if (items) updates.items = items

    const res = await fetch('/api/schedules', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        category,
        ...updates,
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const d = await res.json()
      setError(d.error || 'Update failed. Please try again.')
      return
    }

    onUpdated()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">
              Update {catDef?.label || category} Schedule
            </div>
            <div style={{ fontSize: 12, color: 'var(--g600)', marginTop: 4 }}>
              {project.name}
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
            <label className="field-label">Manufacturer Name</label>
            <input
              className="field-input"
              value={manufacturer}
              onChange={e => setManufacturer(e.target.value)}
              placeholder="e.g. Stone Source International"
            />
          </div>

          <div>
            <label className="field-label">Replace CSV Schedule</label>
            <div style={{
              fontSize: 13, color: 'var(--g600)',
              marginBottom: 10, lineHeight: 1.6,
            }}>
              Current schedule has <strong>{itemCount} items</strong>.
              Upload a new CSV to replace it. The old schedule will be overwritten.
            </div>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px',
              border: '1px dashed var(--g300)', borderRadius: 8,
              cursor: 'pointer',
              background: items ? 'var(--success-bg)' : 'var(--g50)',
              transition: 'background 0.2s',
              fontSize: 13,
              color: items ? 'var(--success)' : 'var(--g600)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              {items
                ? `✓ New CSV ready — ${itemCount} items parsed`
                : 'Upload new CSV to replace current schedule'
              }
              <input
                type="file"
                accept=".csv,.txt"
                style={{ display: 'none' }}
                onChange={e => e.target.files[0] && handleCSV(e.target.files[0])}
              />
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-black btn-sm"
            onClick={save}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── New Project Modal ─────────────────────────────────────
// Unchanged from the previous design — logic left exactly as-is.
function NewProjectModal({ onClose, onCreate }) {
  const [step, setStep] = useState(1) // 1: details, 2: categories, 3: upload CSVs
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [selectedCats, setSelectedCats] = useState([])
  const [catData, setCatData] = useState({}) // { stone: { manufacturer, items } }
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  function toggleCat(catId) {
    setSelectedCats(prev =>
      prev.includes(catId) ? prev.filter(c => c !== catId) : [...prev, catId]
    )
  }

  function updateCatData(catId, field, value) {
    setCatData(prev => ({
      ...prev,
      [catId]: { ...prev[catId], [field]: value }
    }))
  }

  async function handleCSV(catId, file) {
    const text = await file.text()
    const items = parseCSVForCategory(text, catId)
    updateCatData(catId, 'items', items)
    updateCatData(catId, 'itemCount', items.length)
  }

  async function create() {
    if (!name.trim()) { setError('Project name is required'); return }
    if (selectedCats.length === 0) { setError('Select at least one category'); return }

    setCreating(true)
    setError('')

    const schedules = selectedCats
      .filter(cat => catData[cat]?.items?.length > 0)
      .map(cat => ({
        category: cat,
        manufacturer: catData[cat]?.manufacturer || '',
        items: catData[cat]?.items || [],
      }))

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        client: client.trim(),
        categories: selectedCats,
        schedules,
      }),
    })

    const data = await res.json()
    setCreating(false)

    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      return
    }

    onCreate(data)
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">New Project</div>
            <div style={{ fontSize: 12, color: 'var(--g600)', marginTop: 4 }}>
              Step {step} of 3
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

          {/* Step 1 — Project Details */}
          {step === 1 && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <label className="field-label">Project Name *</label>
                <input
                  className="field-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Residence at Oak Hill"
                  autoFocus
                />
              </div>
              <div>
                <label className="field-label">Client / Location</label>
                <input
                  className="field-input"
                  value={client}
                  onChange={e => setClient(e.target.value)}
                  placeholder="e.g. Private Client · Kansas City, MO"
                />
              </div>
              {name && (
                <div style={{
                  marginTop: 16, padding: '10px 14px', borderRadius: 8,
                  background: 'var(--g50)', fontSize: 12,
                  color: 'var(--g600)',
                }}>
                  URL will be: <strong style={{ color: 'var(--black)' }}>
                    /projects/{slugify(name)}/dashboard
                  </strong>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Select Categories */}
          {step === 2 && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--g600)', marginBottom: 20 }}>
                Select all material categories for this project.
                You can always add more later.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {allCategories.map(cat => {
                  const selected = selectedCats.includes(cat.id)
                  const isLive = cat.status === 'live'
                  return (
                    <div
                      key={cat.id}
                      onClick={() => isLive && toggleCat(cat.id)}
                      style={{
                        padding: '16px 20px', borderRadius: 10,
                        border: `1px solid ${selected ? 'var(--black)' : 'var(--g200)'}`,
                        background: selected ? 'var(--black)' : 'var(--white)',
                        cursor: isLive ? 'pointer' : 'not-allowed',
                        opacity: isLive ? 1 : 0.45,
                        transition: 'all 0.15s',
                        position: 'relative',
                      }}
                    >
                      <div style={{
                        fontSize: 18, marginBottom: 4,
                        color: selected ? 'var(--white)' : 'var(--g500)',
                      }}>
                        {cat.icon}
                      </div>
                      <div style={{
                        fontSize: 14, fontWeight: 500,
                        color: selected ? 'var(--white)' : 'var(--black)',
                      }}>
                        {cat.label}
                      </div>
                      <div style={{
                        fontSize:12,
                        color: selected ? 'rgba(255,255,255,0.6)' : 'var(--g500)',
                        marginTop: 2,
                      }}>
                        {cat.description}
                      </div>
                      {!isLive && (
                        <div style={{
                          position: 'absolute', top: 8, right: 8,
                          fontSize:12, letterSpacing: '0.08em', textTransform: 'uppercase',
                          color: 'var(--g500)', borderRadius: 10,
                          padding: '2px 8px', border: '1px solid var(--g200)',
                        }}>
                          Soon
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 3 — Upload CSVs per category */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--g600)', marginBottom: 24 }}>
                For each category, enter the manufacturer name and upload your CSV schedule.
              </div>
              {selectedCats.map(catId => {
                const cat = allCategories.find(c => c.id === catId)
                const data = catData[catId] || {}
                return (
                  <div key={catId} style={{
                    border: '1px solid var(--g200)', borderRadius: 10,
                    padding: '20px 24px',
                    marginBottom: 16,
                    background: 'var(--white)',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
                    }}>
                      <span style={{ fontSize: 16, color: 'var(--g700)' }}>{cat.icon}</span>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>
                        {cat.label}
                      </div>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <label className="field-label">Manufacturer Name</label>
                      <input
                        className="field-input"
                        value={data.manufacturer || ''}
                        onChange={e => updateCatData(catId, 'manufacturer', e.target.value)}
                        placeholder="e.g. Stone Source International"
                      />
                    </div>
                    <div>
                      <label className="field-label">CSV Schedule</label>
                      <label style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 16px',
                        border: '1px dashed var(--g300)', borderRadius: 8,
                        cursor: 'pointer',
                        background: data.itemCount ? 'var(--success-bg)' : 'var(--g50)',
                        transition: 'background 0.2s',
                        fontSize: 13,
                        color: data.itemCount ? 'var(--success)' : 'var(--g600)',
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </svg>
                        {data.itemCount
                          ? `✓ ${data.itemCount} items parsed`
                          : 'Upload CSV — columns: Name, Finish/Color, Cut, Room, Area'
                        }
                        <input
                          type="file"
                          accept=".csv,.txt"
                          style={{ display: 'none' }}
                          onChange={e => e.target.files[0] && handleCSV(catId, e.target.files[0])}
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step > 1 && (
            <button className="btn btn-outline btn-sm" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={onClose}>
            Cancel
          </button>
          {step < 3 ? (
            <button
              className="btn btn-black btn-sm"
              onClick={() => {
                if (step === 1 && !name.trim()) { setError('Project name is required'); return }
                if (step === 2 && selectedCats.length === 0) { setError('Select at least one category'); return }
                setError('')
                setStep(step + 1)
              }}
            >
              Continue →
            </button>
          ) : (
            <button
              className="btn btn-black btn-sm"
              onClick={create}
              disabled={creating}
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Status strip ──────────────────────────────────────────
// Four numbers, above everything, with room to breathe. Two of them are
// counts of work waiting on a person; the other two are money. Nothing
// here is a folder.
function StatusStrip({ totals, overdueDays, loading }) {
  const t = totals || { activeValue: 0, pendingApproval: 0, overdue: 0, approvedThisMonth: 0 }
  const cells = [
    { val: formatCurrency(t.activeValue), label: 'Active value' },
    { val: t.pendingApproval, label: 'Pending approval', urgent: t.pendingApproval > 0 },
    { val: t.overdue, label: `Overdue > ${overdueDays || 5} days`, danger: t.overdue > 0 },
    { val: formatCurrency(t.approvedThisMonth), label: 'Approved this month' },
  ]
  return (
    <div style={{ display:'flex', gap:'var(--s-12)', flexWrap:'wrap', padding:'var(--s-8) 0 var(--s-6)', borderBottom:'1px solid var(--border)' }}>
      {cells.map(c => (
        <div key={c.label}>
          <div style={{
            fontSize:'var(--t-3xl)', fontWeight:500, lineHeight:1, letterSpacing:'-0.02em',
            fontVariantNumeric:'tabular-nums',
            color: loading ? 'var(--g300)'
              : c.danger ? 'var(--danger)'
              : c.urgent ? 'var(--black)'
              : (c.val === 0 || c.val === '$0.00') ? 'var(--g500)' : 'var(--black)',
          }}>
            {loading ? '—' : c.val}
          </div>
          <div style={{ fontSize:'var(--t-xs)', color:'var(--gray)', marginTop:'var(--s-2)' }}>{c.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Status dot ────────────────────────────────────────────
// Replaces the folder icon. A folder says "this is stored somewhere"; a dot
// says "this is in a state, and one of those states wants you".
const STATUS = {
  overdue:  { label: 'Overdue',  cls: 'badge-rejected' },
  pending:  { label: 'Pending',  cls: 'badge-pending' },
  awaiting: { label: 'Awaiting vendor', cls: 'badge-draft' },
  active:   { label: 'In progress', cls: 'badge-draft' },
  complete: { label: 'Approved', cls: 'badge-approved' },
}

function StatusBadge({ status, waitingDays }) {
  const s = STATUS[status] || STATUS.active
  const label = status === 'overdue' && waitingDays ? `Overdue · ${waitingDays}d` : s.label
  return <span className={`badge ${s.cls}`}>{label}</span>
}

// ── Empty state ───────────────────────────────────────────
// The only way to create a project used to be a button in the far top-left,
// diagonally opposite the void where the eye lands.
function EmptyProjects({ search, onCreate }) {
  if (search) return (
    <div className="empty-state" style={{ padding:'var(--s-12) 0' }}>
      <div className="empty-state-title">No projects match “{search}”</div>
      <div className="empty-state-sub">Try a different project name or client.</div>
    </div>
  )
  return (
    <div className="empty-state" style={{ padding:'var(--s-16) 0' }}>
      <div className="empty-state-title">No projects yet</div>
      <div className="empty-state-sub">
        A project holds one schedule per category, the vendor pricing against it, and what you approve.
      </div>
      <button className="btn btn-black" onClick={onCreate}>Create your first project</button>
    </div>
  )
}

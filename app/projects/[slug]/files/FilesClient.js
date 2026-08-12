'use client'

import { useState, useEffect } from 'react'
import SignOutButton from '@/app/components/SignOutButton'
import { liveCategories } from '@/lib/categories'

// Documents Claude can read into line items. Everything else on the list is
// still browsable — this only decides where the Extract action appears.
const EXTRACTABLE = ['pdf', 'csv', 'tsv', 'txt', 'md']

const ICONS = {
  pdf: 'ti-file-type-pdf', csv: 'ti-file-type-csv',
  xlsx: 'ti-file-type-xls', xls: 'ti-file-type-xls',
  doc: 'ti-file-type-doc', docx: 'ti-file-type-doc',
  ppt: 'ti-file-type-ppt', pptx: 'ti-file-type-ppt',
  jpg: 'ti-photo', jpeg: 'ti-photo', png: 'ti-photo',
  gif: 'ti-photo', webp: 'ti-photo', heic: 'ti-photo',
  zip: 'ti-file-zip', dwg: 'ti-blueprint', dxf: 'ti-blueprint',
  rvt: 'ti-blueprint', skp: 'ti-blueprint',
}

function formatSize(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

// "The key is not set" is the same sentence for four different problems: the
// variable is absent, it exists with no value, it was saved under a
// neighbouring name, or this build predates the change. Each has a different
// fix, so say which one it is instead of leaving it to be worked out from the
// outside. Variable names only — no value is ever read or shown.
function ExtractionSetupNotice({ diagnostics }) {
  const state = diagnostics?.keyState
  const seen = diagnostics?.anthropicVarNames || []
  const dep = diagnostics?.deployment
  const nearMisses = seen.filter(n => n !== 'ANTHROPIC_API_KEY')

  return (
    <div style={{ padding:'16px 18px', border:'1px solid var(--border)', background:'var(--white)', fontSize:12, marginBottom:20, lineHeight:1.7 }}>
      <div style={{ fontWeight:600, marginBottom:6 }}>Reading documents is not set up yet</div>

      {state === 'empty' || state === 'blank' ? (
        <div>
          <code>ANTHROPIC_API_KEY</code> exists in this deployment but its value is{' '}
          {state === 'empty' ? 'empty' : 'only whitespace'}. Open it in Vercel, paste the
          key into the value field, save, and redeploy.
        </div>
      ) : nearMisses.length ? (
        <div>
          This deployment has no <code>ANTHROPIC_API_KEY</code>, but it can see{' '}
          {nearMisses.map((n, i) => (
            <span key={n}>{i > 0 ? ', ' : ''}<code>{n}</code></span>
          ))}
          . That is almost certainly the key under the wrong name — rename it to exactly{' '}
          <code>ANTHROPIC_API_KEY</code> and redeploy.
        </div>
      ) : (
        <div>
          This deployment cannot see <code>ANTHROPIC_API_KEY</code> under that name or any
          name close to it. Check that it is set for <strong>Production</strong> on this
          project — a variable defined in a shared team group does nothing until the group
          is linked to the project.
        </div>
      )}

      {dep?.env && (
        <div style={{ marginTop:12, paddingTop:10, borderTop:'1px solid var(--border)', fontSize:11, color:'var(--gray-light)' }}>
          Answered by the <strong>{dep.env}</strong> build
          {dep.branch ? <> of <code>{dep.branch}</code></> : null}
          {dep.commit ? <> at <code>{dep.commit}</code></> : null}. Variables added after a
          build was made do not reach it — redeploy so they take effect.
        </div>
      )}
    </div>
  )
}

export default function FilesClient({ slug, canManage }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [picker, setPicker] = useState(null) // { path, folders, loading }
  const [search, setSearch] = useState('')
  const [extract, setExtract] = useState(null) // { file, category }
  const [extractions, setExtractions] = useState(null)

  useEffect(() => { load(); loadExtractions() }, [slug])

  async function load() {
    setLoading(true)
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/files`)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not load files.')
      setLoading(false)
      return
    }
    setData(await res.json())
    setLoading(false)
  }

  async function loadExtractions() {
    const res = await fetch(`/api/extractions?projectSlug=${encodeURIComponent(slug)}`)
    if (res.ok) setExtractions(await res.json())
  }

  // Reading a long schedule takes minutes, so this deliberately blocks with a
  // busy state rather than pretending to be instant. On success it goes
  // straight to the review screen, which is where the work actually is.
  async function startExtraction() {
    const { file, category } = extract
    setBusy(true); setError(''); setNotice('')
    const res = await fetch('/api/extractions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectSlug: slug, category, path: file.path, name: file.name }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setExtract(null)
      setError(d.error || 'Could not read that document.')
      loadExtractions()
      return
    }
    window.location.href = `/projects/${slug}/extractions/${d.extraction.id}`
  }

  async function sync(full = false) {
    setBusy(true); setError(''); setNotice('')
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error || 'Sync failed.'); return }
    setNotice(
      d.added || d.removed
        ? `Synced — ${d.added} added or updated, ${d.removed} removed.`
        : 'Synced — nothing changed.'
    )
    load()
  }

  async function openPicker(path = '') {
    setPicker({ path, folders: [], loading: true })
    const res = await fetch(`/api/dropbox/browse?path=${encodeURIComponent(path)}`)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) {
      setPicker(null)
      setError(d.error || 'Could not list Dropbox folders. Is Dropbox connected?')
      return
    }
    setPicker({ path, folders: d.folders || [], loading: false })
  }

  async function chooseFolder(path) {
    setBusy(true); setError(''); setNotice('')
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/folder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dropboxPath: path }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    setPicker(null)
    if (!res.ok) { setError(d.error || 'Could not set the folder.'); return }
    if (d.syncError) setError(`Folder saved, but the first sync failed: ${d.syncError}`)
    else setNotice(`Folder linked — ${d.added ?? 0} files found.`)
    load()
  }

  async function unlink() {
    if (!confirm('Unlink this Dropbox folder?\n\nThe file list here is cleared. Nothing in Dropbox is touched.')) return
    setBusy(true)
    await fetch(`/api/projects/${encodeURIComponent(slug)}/folder`, { method: 'DELETE' })
    setBusy(false)
    load()
  }

  async function openFile(file) {
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/files/${file.id}/link`)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setError(d.error || 'Could not open that file.'); return }
    window.open(d.url, '_blank', 'noopener')
  }

  const files = (data?.files || []).filter(f =>
    !search.trim() || f.name.toLowerCase().includes(search.trim().toLowerCase())
  )

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div style={{ height:64, borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 40px', background:'var(--white)', gap:20 }}>
        <button onClick={() => window.location.href = `/projects/${slug}/dashboard`}
          style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase' }}>Dashboard</span>
        </button>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, letterSpacing:'0.06em' }}>
          Relative <span style={{ color:'var(--gold)' }}>Estates</span>
        </div>
        <div style={{ fontSize:13, fontWeight:500, color:'var(--gray)', flex:1 }}>{data?.project?.name}</div>
        <SignOutButton compact />
      </div>

      <div style={{ padding:'48px 56px 80px' }}>
        <div className="page-eyebrow">Project Files</div>
        <div className="page-title" style={{ marginBottom:10 }}>Docu<em>ments</em></div>
        <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7, marginBottom:28, maxWidth:640 }}>
          Everything in this project&apos;s Dropbox folder, in one place. Files live in
          Dropbox — this is a live index, not a copy, so anything added or edited there
          shows up on the next sync. Not visible to clients.
        </div>

        {error && (
          <div style={{ padding:'12px 16px', background:'var(--danger-bg)', border:'1px solid var(--danger)', color:'var(--danger)', fontSize:12, marginBottom:20 }}>{error}</div>
        )}
        {notice && (
          <div style={{ padding:'12px 16px', background:'var(--success-bg)', border:'1px solid var(--success)', color:'var(--success)', fontSize:12, marginBottom:20 }}>{notice}</div>
        )}

        {loading ? <div className="spinner" /> : !data?.folder ? (
          <div className="empty-state" style={{ border:'1px dashed var(--border-dark)', padding:'40px 24px' }}>
            <div className="empty-state-title">No Dropbox folder linked</div>
            <div className="empty-state-sub" style={{ marginBottom:18 }}>
              {canManage
                ? 'Choose the folder that holds this project’s plans, schedules and renderings.'
                : 'An admin needs to link this project to a Dropbox folder.'}
            </div>
            {canManage && (
              <button className="btn btn-black btn-sm" onClick={() => openPicker('')} disabled={busy}>
                Choose folder
              </button>
            )}
          </div>
        ) : (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', padding:'14px 16px', border:'1px solid var(--border)', background:'var(--white)', marginBottom:20 }}>
              <i className="ti ti-folder" style={{ fontSize:20, color:'var(--gold)' }} />
              <div style={{ flex:'1 1 220px', minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, wordBreak:'break-all' }}>{data.folder.path}</div>
                <div style={{ fontSize:11, color:'var(--gray-light)' }}>
                  {data.files.length} file{data.files.length !== 1 ? 's' : ''}
                  {data.folder.lastSyncedAt && ` · synced ${new Date(data.folder.lastSyncedAt).toLocaleString()}`}
                </div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => sync(false)} disabled={busy}>
                {busy ? 'Syncing…' : 'Sync'}
              </button>
              {canManage && (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => openPicker('')} disabled={busy}>Change folder</button>
                  <button className="btn btn-outline btn-sm" onClick={unlink} disabled={busy}
                    style={{ color:'var(--danger)', borderColor:'var(--danger)' }}>Unlink</button>
                </>
              )}
            </div>

            {data.folder.lastError && (
              <div style={{ padding:'10px 14px', background:'var(--danger-bg)', border:'1px solid var(--danger)', color:'var(--danger)', fontSize:12, marginBottom:20 }}>
                Last sync failed: {data.folder.lastError}
              </div>
            )}

            {extractions && !extractions.configured && (
              <ExtractionSetupNotice diagnostics={extractions.diagnostics} />
            )}

            {extractions?.extractions?.length > 0 && (
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:10 }}>
                  Recent extractions
                </div>
                {extractions.extractions.slice(0, 5).map(x => (
                  <a key={x.id} href={`/projects/${slug}/extractions/${x.id}`}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 12px', border:'1px solid var(--border)', borderBottom:'none', background:'var(--white)', textDecoration:'none', color:'inherit', fontSize:12 }}>
                    <span style={{
                      fontSize:9, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase',
                      padding:'2px 7px', border:'1px solid currentColor', whiteSpace:'nowrap',
                      color: x.status === 'applied' ? 'var(--success)'
                        : x.status === 'failed' ? 'var(--danger)' : 'var(--gray-light)',
                    }}>{x.status}</span>
                    <span style={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.source_name}</span>
                    <span style={{ color:'var(--gray-light)', whiteSpace:'nowrap' }}>{x.category}</span>
                    <span style={{ color:'var(--gray-light)', whiteSpace:'nowrap' }}>{new Date(x.created_at).toLocaleDateString()}</span>
                  </a>
                ))}
                <div style={{ borderBottom:'1px solid var(--border)' }} />
              </div>
            )}

            <input className="field-input" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Filter by name…" style={{ maxWidth:320, marginBottom:16 }} />

            {files.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">{data.files.length ? 'No matches' : 'No files yet'}</div>
                <div className="empty-state-sub">
                  {data.files.length ? 'Try a different search.' : 'Add files to the Dropbox folder, then hit Sync.'}
                </div>
              </div>
            ) : (
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Name</th>
                    <th style={th}>Type</th>
                    <th style={{ ...th, textAlign:'right' }}>Size</th>
                    <th style={th}>Modified</th>
                    <th style={{ ...th, textAlign:'right' }}>Extract</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map(f => (
                    <tr key={f.id} onClick={() => openFile(f)} style={{ cursor:'pointer' }}>
                      <td style={td}>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <i className={`ti ${ICONS[f.ext] || 'ti-file'}`} style={{ fontSize:18, color:'var(--gray-light)' }} />
                          <span style={{ fontSize:13, fontWeight:500 }}>{f.name}</span>
                        </div>
                      </td>
                      <td style={{ ...td, fontSize:11, textTransform:'uppercase', color:'var(--gray-light)', letterSpacing:'0.06em' }}>{f.ext || '—'}</td>
                      <td style={{ ...td, textAlign:'right', fontSize:12, color:'var(--gray)', whiteSpace:'nowrap' }}>{formatSize(f.sizeBytes)}</td>
                      <td style={{ ...td, fontSize:12, color:'var(--gray)', whiteSpace:'nowrap' }}>
                        {f.modified ? new Date(f.modified).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}
                        onClick={e => e.stopPropagation()}>
                        {EXTRACTABLE.includes(f.ext) ? (
                          <button className="btn btn-outline btn-sm" disabled={busy}
                            onClick={() => setExtract({ file: f, category: liveCategories[0]?.id || '' })}>
                            Read into schedule
                          </button>
                        ) : (
                          <span style={{ fontSize:11, color:'var(--gray-light)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {extract && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && setExtract(null)}>
          <div className="modal" style={{ maxWidth:520 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Read into a schedule</div>
                <div style={{ fontSize:11, color:'var(--gray)', marginTop:4, wordBreak:'break-all' }}>
                  {extract.file.name}
                </div>
              </div>
              {!busy && <button className="modal-close" onClick={() => setExtract(null)}>✕</button>}
            </div>
            <div className="modal-body">
              {busy ? (
                <div style={{ textAlign:'center', padding:'20px 0' }}>
                  <div className="spinner" />
                  <div style={{ fontSize:12, color:'var(--gray)', marginTop:14, lineHeight:1.7 }}>
                    Reading the document. A long schedule can take a few minutes —
                    leave this open.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize:12, color:'var(--gray)', lineHeight:1.7, marginBottom:18 }}>
                    Claude reads this document and proposes line items. You review each one
                    before anything reaches the schedule — nothing is added automatically.
                  </div>
                  <label className="field-label" style={{ display:'block', marginBottom:6 }}>Which schedule</label>
                  <select className="field-input" value={extract.category}
                    onChange={e => setExtract({ ...extract, category: e.target.value })}>
                    {liveCategories.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => setExtract(null)}>Cancel</button>
              <button className="btn btn-black btn-sm" disabled={busy || !extract.category}
                onClick={startExtraction}>
                {busy ? 'Reading…' : 'Read document'}
              </button>
            </div>
          </div>
        </div>
      )}

      {picker && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setPicker(null)}>
          <div className="modal" style={{ maxWidth:560 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title">Choose a Dropbox folder</div>
                <div style={{ fontSize:11, color:'var(--gray)', marginTop:4, wordBreak:'break-all' }}>
                  {picker.path || '/ (top level)'}
                </div>
              </div>
              <button className="modal-close" onClick={() => setPicker(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight:420, overflowY:'auto' }}>
              {picker.loading ? <div className="spinner" /> : (
                <>
                  {picker.path && (
                    <button onClick={() => openPicker(picker.path.split('/').slice(0, -1).join('/'))}
                      style={folderRow}>
                      <i className="ti ti-arrow-up" style={{ fontSize:16, color:'var(--gray-light)' }} /> Up one level
                    </button>
                  )}
                  {picker.folders.length === 0 && (
                    <div style={{ fontSize:12, color:'var(--gray-light)', padding:'10px 0', lineHeight:1.7 }}>
                      <em>No subfolders here.</em>
                      {/* An empty top level almost always means the Dropbox app
                          was scoped to its own folder rather than the whole
                          Dropbox, in which case there is nothing to browse and
                          no error to explain why. */}
                      {!picker.path && (
                        <div style={{ marginTop:8 }}>
                          Nothing at the top level usually means the Dropbox app was
                          created with <strong>App folder</strong> access instead of{' '}
                          <strong>Full Dropbox</strong>. That choice cannot be changed
                          after the app is created — make a new app with full access,
                          then reconnect in Settings → Dropbox.
                        </div>
                      )}
                    </div>
                  )}
                  {picker.folders.map(f => (
                    <div key={f.path} style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <button onClick={() => openPicker(f.path)} style={{ ...folderRow, flex:1 }}>
                        <i className="ti ti-folder" style={{ fontSize:16, color:'var(--gold)' }} /> {f.name}
                      </button>
                      <button className="btn btn-outline btn-sm" disabled={busy}
                        onClick={() => chooseFolder(f.path)}>Use this</button>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline btn-sm" onClick={() => setPicker(null)}>Cancel</button>
              {picker.path && (
                <button className="btn btn-black btn-sm" disabled={busy}
                  onClick={() => chooseFolder(picker.path)}>Use this folder</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const th = {
  padding:'11px 12px', textAlign:'left', fontSize:9, fontWeight:600,
  letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)',
  borderBottom:'1px solid var(--border)', whiteSpace:'nowrap',
}
const td = { padding:'12px', borderBottom:'1px solid var(--border)', verticalAlign:'middle', fontSize:13 }
const folderRow = {
  display:'flex', alignItems:'center', gap:10, width:'100%', textAlign:'left',
  padding:'9px 10px', background:'none', border:'none', borderBottom:'1px solid var(--border)',
  cursor:'pointer', fontSize:13, fontFamily:'var(--font-body)', color:'var(--black)',
}

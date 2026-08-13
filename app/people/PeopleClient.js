'use client'

import { useState, useEffect } from 'react'
import SignOutButton from '@/app/components/SignOutButton'

const ROLE_INFO = {
  owner:  { label: 'Owner',  blurb: 'Full access to everything. Cannot be removed.' },
  admin:  { label: 'Admin',  blurb: 'Full access to everything, including people.' },
  member: { label: 'Member', blurb: 'Internal team. Sees cost and margin, on assigned projects only.' },
  client: { label: 'Client', blurb: 'Sees their own project pricing only. No cost or margin.' },
}
const ASSIGNABLE = ['admin', 'member', 'client']

// Roles that see everything by role alone — assigning them to projects
// would be meaningless, so the project picker is hidden for them.
const GLOBAL_ROLES = ['owner', 'admin']

export default function PeopleClient({ currentUserId, currentUserRole }) {
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState('client')
  const [projectIds, setProjectIds] = useState([])
  const [editing, setEditing] = useState(null) // profile id being edited

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/people')
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not load people.')
      setLoading(false)
      return
    }
    const data = await res.json()
    setMembers(data.members)
    setInvitations(data.invitations)
    setProjects(data.projects)
    setLoading(false)
  }

  async function invite(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role, projectIds }),
    })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not add that person.')
      return
    }
    setEmail(''); setRole('client'); setProjectIds([])
    load()
  }

  async function saveMember(id, patch) {
    setBusy(true); setError('')
    const res = await fetch(`/api/people/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not save that change.')
      return
    }
    setEditing(null)
    load()
  }

  async function revoke(member) {
    if (!confirm(
      `Remove ${member.email}?\n\nThey lose access immediately. They can still sign in, but will see "no access" until you add them again.`
    )) return
    setBusy(true); setError('')
    const res = await fetch(`/api/people/${member.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not remove that person.')
      return
    }
    load()
  }

  async function cancelInvite(inv) {
    setBusy(true); setError('')
    const res = await fetch(`/api/people/invitations/${encodeURIComponent(inv.email)}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not cancel that invitation.')
      return
    }
    load()
  }

  function toggleProject(list, setList, id) {
    setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  }

  function projectNames(ids) {
    if (!ids?.length) return '—'
    return ids.map(id => projects.find(p => p.id === id)?.name || 'Unknown').join(', ')
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div className="app-header" style={{ height:64, borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 40px', background:'var(--white)', gap:20 }}>
        <button onClick={() => window.location.href = '/'} style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase' }}>Back</span>
        </button>
        <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:300, letterSpacing:'0.06em', flex:1 }}>
          Relative <span style={{ color:'var(--gold)' }}>Estates</span>
        </div>
        <SignOutButton compact />
      </div>

      <div className="page-body" style={{ padding:'48px 56px 80px', maxWidth:1100 }}>
        <div className="page-eyebrow">Access Control</div>
        <div className="page-title" style={{ marginBottom:10 }}>People &amp; <em>Permissions</em></div>
        <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7, marginBottom:36, maxWidth:640 }}>
          Anyone here can sign in with Google or an emailed link. Access comes from this
          list — signing in on its own grants nothing. Removing someone takes effect on
          their next request; there is no password to change.
        </div>

        {error && (
          <div style={{ padding:'12px 16px', background:'var(--danger-bg)', border:'1px solid var(--danger)', color:'var(--danger)', fontSize:12, marginBottom:24 }}>
            {error}
          </div>
        )}

        {/* ── Invite ─────────────────────────────── */}
        <form onSubmit={invite} style={{ border:'1px solid var(--border)', background:'var(--white)', padding:'22px 24px', marginBottom:36 }}>
          <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:16 }}>
            Add someone
          </div>
          <div style={{ display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-end' }}>
            <div style={{ flex:'2 1 260px' }}>
              <label className="field-label">Email address</label>
              <input className="field-input" type="email" value={email} required
                onChange={e => setEmail(e.target.value)} placeholder="carrie@example.com" />
            </div>
            <div style={{ flex:'1 1 160px' }}>
              <label className="field-label">Role</label>
              <select className="field-input" value={role} onChange={e => setRole(e.target.value)}>
                {ASSIGNABLE.map(r => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-black btn-sm" disabled={busy} style={{ height:38 }}>
              {busy ? 'Adding…' : 'Add person'}
            </button>
          </div>

          <div style={{ fontSize:11, color:'var(--gray-light)', marginTop:8 }}>{ROLE_INFO[role].blurb}</div>

          {!GLOBAL_ROLES.includes(role) && (
            <div style={{ marginTop:18, paddingTop:18, borderTop:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:10 }}>
                Projects they can see
              </div>
              {projects.length === 0 ? (
                <div style={{ fontSize:12, fontStyle:'italic', color:'var(--gray-light)' }}>No projects yet.</div>
              ) : (
                <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                  {projects.map(p => {
                    const on = projectIds.includes(p.id)
                    return (
                      <label key={p.id}
                        style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', cursor:'pointer', fontSize:12,
                                 border:`1.5px solid ${on ? 'var(--gold)' : 'var(--border)'}`,
                                 background:on ? 'var(--gold-pale)' : 'transparent' }}>
                        <input type="checkbox" checked={on} style={{ margin:0 }}
                          onChange={() => toggleProject(projectIds, setProjectIds, p.id)} />
                        {p.name}
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </form>

        {/* ── Members ────────────────────────────── */}
        <div style={{ fontSize:13, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', paddingBottom:12, borderBottom:'2px solid var(--black)', marginBottom:0 }}>
          Has access <span style={{ color:'var(--gray-light)', fontWeight:400 }}>· {members.length}</span>
        </div>

        {loading ? (
          <div style={{ padding:'32px 0' }}><div className="spinner" /></div>
        ) : (
          <div className="table-scroll">
          <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:40 }}>
            <thead>
              <tr>
                <th style={th}>Person</th>
                <th style={th}>Role</th>
                <th style={th}>Projects</th>
                <th style={{ ...th, textAlign:'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => {
                const isEditing = editing === m.id
                const isOwner = m.role === 'owner'
                const isSelf = m.id === currentUserId
                return (
                  <MemberRow
                    key={m.id}
                    member={m}
                    projects={projects}
                    isEditing={isEditing}
                    isOwner={isOwner}
                    isSelf={isSelf}
                    canGrantOwner={currentUserRole === 'owner'}
                    busy={busy}
                    projectNames={projectNames}
                    onEdit={() => setEditing(m.id)}
                    onCancel={() => setEditing(null)}
                    onSave={patch => saveMember(m.id, patch)}
                    onRevoke={() => revoke(m)}
                  />
                )
              })}
            </tbody>
          </table>
          </div>
        )}

        {/* ── Pending ────────────────────────────── */}
        {invitations.length > 0 && (
          <>
            <div style={{ fontSize:13, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', paddingBottom:12, borderBottom:'2px solid var(--black)' }}>
              Invited, not signed in yet <span style={{ color:'var(--gray-light)', fontWeight:400 }}>· {invitations.length}</span>
            </div>
            <div style={{ fontSize:12, color:'var(--gray)', margin:'12px 0 4px', lineHeight:1.6 }}>
              These people have been granted access but haven&apos;t signed in yet. Send them the
              app link — their access activates automatically the first time they sign in with
              this email address.
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <tbody>
                {invitations.map(inv => (
                  <tr key={inv.email}>
                    <td style={td}>
                      <div style={{ fontSize:13, fontWeight:500 }}>{inv.email}</div>
                    </td>
                    <td style={td}>
                      <span style={roleChip}>{ROLE_INFO[inv.role]?.label || inv.role}</span>
                    </td>
                    <td style={{ ...td, fontSize:12, color:'var(--gray)' }}>{projectNames(inv.project_ids)}</td>
                    <td style={{ ...td, textAlign:'right' }}>
                      <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => cancelInvite(inv)}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}

function MemberRow({ member, projects, isEditing, isOwner, isSelf, canGrantOwner, busy, projectNames, onEdit, onCancel, onSave, onRevoke }) {
  const [role, setRole] = useState(member.role)
  const [ids, setIds] = useState(member.project_ids || [])

  useEffect(() => {
    setRole(member.role)
    setIds(member.project_ids || [])
  }, [member, isEditing])

  const roleOptions = canGrantOwner ? ['owner', ...ASSIGNABLE] : ASSIGNABLE

  if (!isEditing) {
    return (
      <tr>
        <td style={td}>
          <div style={{ fontSize:13, fontWeight:600 }}>{member.full_name || member.email}</div>
          {member.full_name && <div style={{ fontSize:11, color:'var(--gray-light)' }}>{member.email}</div>}
          {isSelf && <span style={{ fontSize:9, fontWeight:600, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--gold)' }}>You</span>}
        </td>
        <td style={td}><span style={roleChip}>{ROLE_INFO[member.role]?.label || member.role}</span></td>
        <td style={{ ...td, fontSize:12, color:'var(--gray)' }}>
          {GLOBAL_ROLES.includes(member.role) ? 'All projects' : projectNames(member.project_ids)}
        </td>
        <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
          <button className="btn btn-outline btn-sm" onClick={onEdit} disabled={busy || isOwner}>Edit</button>
          {!isOwner && !isSelf && (
            <button className="btn btn-outline btn-sm" style={{ marginLeft:8, color:'var(--danger)', borderColor:'var(--danger)' }}
              onClick={onRevoke} disabled={busy}>Remove</button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <tr style={{ background:'var(--cream)' }}>
      <td style={td}>
        <div style={{ fontSize:13, fontWeight:600 }}>{member.full_name || member.email}</div>
      </td>
      <td style={td}>
        <select className="field-input" value={role} onChange={e => setRole(e.target.value)} style={{ minWidth:120 }}>
          {roleOptions.map(r => <option key={r} value={r}>{ROLE_INFO[r].label}</option>)}
        </select>
      </td>
      <td style={td}>
        {GLOBAL_ROLES.includes(role) ? (
          <div style={{ fontSize:12, color:'var(--gray)', fontStyle:'italic' }}>Sees all projects by role</div>
        ) : (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {projects.map(p => {
              const on = ids.includes(p.id)
              return (
                <label key={p.id}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 9px', cursor:'pointer', fontSize:11,
                           border:`1.5px solid ${on ? 'var(--gold)' : 'var(--border)'}`,
                           background:on ? 'var(--gold-pale)' : 'var(--white)' }}>
                  <input type="checkbox" checked={on} style={{ margin:0 }}
                    onChange={() => setIds(on ? ids.filter(x => x !== p.id) : [...ids, p.id])} />
                  {p.name}
                </label>
              )
            })}
          </div>
        )}
      </td>
      <td style={{ ...td, textAlign:'right', whiteSpace:'nowrap' }}>
        <button className="btn btn-black btn-sm" disabled={busy}
          onClick={() => onSave({ role, projectIds: ids })}>Save</button>
        <button className="btn btn-outline btn-sm" style={{ marginLeft:8 }} onClick={onCancel} disabled={busy}>Cancel</button>
      </td>
    </tr>
  )
}

const th = {
  padding:'11px 12px', textAlign:'left', fontSize:9, fontWeight:600,
  letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--gray-light)',
  borderBottom:'1px solid var(--border)', whiteSpace:'nowrap',
}
const td = { padding:'14px 12px', borderBottom:'1px solid var(--border)', verticalAlign:'middle', fontSize:13 }
const roleChip = {
  display:'inline-block', padding:'3px 9px', fontSize:9, fontWeight:600,
  letterSpacing:'0.08em', textTransform:'uppercase',
  background:'var(--gold-pale)', color:'var(--gold)', border:'1px solid rgba(154,122,74,0.2)',
}

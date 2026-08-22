'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import SignOutButton from '@/app/components/SignOutButton'
import Wordmark from '@/app/components/Wordmark'
import { AUDIENCE_LABEL, formatPhone } from '@/lib/messaging'
import { formatRelativeTime } from '@/lib/utils'

// The shared inbox.
//
// The thing this screen exists to end is a client question living on one
// person's phone. So the two facts that were previously in that person's
// head are on screen at all times: who the message is from — as an
// audience, not just a name — and whose job it is to answer.
//
// The audience banner above the reply box is not decoration. A client and
// a vendor may be told different things, and the person typing usually has
// the dashboard open in another tab.

const AUDIENCE_STYLE = {
  client:       { bg: 'var(--g100)',    fg: 'var(--g700)', bd: 'var(--g300)' },
  manufacturer: { bg: 'var(--g100)',    fg: 'var(--g700)', bd: 'var(--g300)' },
  internal:     { bg: 'var(--g100)',    fg: 'var(--g700)', bd: 'var(--g300)' },
  unknown:      { bg: 'var(--danger-bg)', fg: 'var(--danger)', bd: 'var(--danger)' },
}

function AudienceChip({ audience, small }) {
  const s = AUDIENCE_STYLE[audience] || AUDIENCE_STYLE.unknown
  return (
    <span style={{
      display:'inline-block', padding: small ? '1px 6px' : '3px 9px',
      fontSize: small ? 10 : 11, fontWeight:600, letterSpacing:'0.1em',
      textTransform:'uppercase', background:s.bg, color:s.fg,
      border:`1px solid ${s.bd}`, whiteSpace:'nowrap',
    }}>
      {AUDIENCE_LABEL[audience] || 'Unidentified'}
    </span>
  )
}

export default function InboxClient() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('threads')
  const [pane, setPane] = useState('list')   // which pane a phone is showing

  const load = useCallback(async () => {
    const res = await fetch('/api/inbox')
    const d = await res.json().catch(() => ({}))
    setLoading(false)
    if (!res.ok) { setError(d.error || 'Could not load the inbox.'); return }
    setError('')
    setData(d)
  }, [])

  useEffect(() => { load() }, [load])

  // Open the thread a notification email linked to.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('thread')
    if (id) { setSelected(id); setPane('thread') }
  }, [])

  // Messages arrive while the screen is open. Polled rather than pushed —
  // a realtime subscription is a lot of machinery for a list that is
  // interesting once every few minutes — and paused when the tab is in the
  // background so it is not doing this all night.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const id = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  const openThreads = (data?.threads || []).filter(t => t.status !== 'closed')
  const unreadCount = openThreads.filter(t => t.unread).length
  const openTasks = data?.tasks || []
  const mine = openTasks.filter(t => t.assignee_id === data?.me?.id)

  return (
    <div style={{ minHeight:'100vh', background:'var(--off-white)' }}>
      <div className="app-header" style={{ height:64, borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', padding:'0 40px', background:'var(--white)', gap:20 }}>
        <button onClick={() => window.location.href = '/'}
          style={{ display:'flex', alignItems:'center', gap:8, background:'none', border:'none', cursor:'pointer', padding:'0 16px 0 0', borderRight:'1px solid var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          <span style={{ fontSize:12, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase' }}>Projects</span>
        </button>
        <Wordmark href={'/'} style={{ flex:1 }} />
        <SignOutButton compact />
      </div>

      <div className="page-body" style={{ padding:'48px 56px 80px' }}>
        <div className="page-eyebrow">Internal</div>
        <div className="page-title" style={{ marginBottom:10 }}>In<em>box</em></div>
        <div style={{ fontSize:13, color:'var(--gray)', lineHeight:1.7, marginBottom:24, maxWidth:660 }}>
          Text messages from clients and vendors, where the whole team can see them.
          Every reply is typed by a person and goes back out as a text. Nothing here
          is answered automatically.
        </div>

        {error && (
          <div style={{ padding:'12px 16px', background:'var(--danger-bg)', border:'1px solid var(--danger)', color:'var(--danger)', fontSize:12, marginBottom:20 }}>{error}</div>
        )}

        {data?.messaging && !data.messaging.configured && <SetupNotice state={data.messaging} />}

        <div style={{ display:'flex', gap:2, marginBottom:16, flexWrap:'wrap' }}>
          <Tab active={tab === 'threads'} onClick={() => setTab('threads')}>
            Threads{unreadCount ? ` · ${unreadCount} new` : ''}
          </Tab>
          <Tab active={tab === 'tasks'} onClick={() => setTab('tasks')}>
            Tasks{openTasks.length ? ` · ${openTasks.length}` : ''}
            {mine.length ? ` (${mine.length} yours)` : ''}
          </Tab>
        </div>

        {loading ? <div className="spinner" /> : tab === 'tasks' ? (
          <>
            <TasksPanel
              tasks={openTasks}
              people={data?.people || []}
              threads={data?.threads || []}
              onOpen={id => { setSelected(id); setPane('thread'); setTab('threads') }}
              onChanged={load}
            />
            {['owner', 'admin'].includes(data?.me?.role) && (
              <RoutingPanel
                projects={data?.projects || []}
                people={data?.people || []}
                onChanged={load}
              />
            )}
          </>
        ) : (
          <div className="inbox-grid" data-pane={pane}>
            <div className="inbox-list">
              {openThreads.length === 0 ? (
                <div style={{ padding:'40px 24px', textAlign:'center', fontSize:13, color:'var(--gray-light)', lineHeight:1.7 }}>
                  No messages yet. Once a number is pointed at this app, anything texted
                  to it lands here.
                </div>
              ) : openThreads.map(t => (
                <ThreadRow
                  key={t.id} thread={t} active={t.id === selected}
                  onClick={() => { setSelected(t.id); setPane('thread') }}
                />
              ))}
            </div>

            <div className="inbox-thread">
              {selected ? (
                <ThreadView
                  key={selected}
                  id={selected}
                  data={data}
                  onBack={() => setPane('list')}
                  onChanged={load}
                />
              ) : (
                <div style={{ padding:'60px 30px', textAlign:'center', fontSize:13, color:'var(--gray-light)' }}>
                  Pick a thread to read it.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Setup ────────────────────────────────────────────────
// Names the variables that are missing, one by one, and the URL to paste
// into Twilio. "Not configured" without saying which piece is a message
// somebody has to debug rather than act on.
function SetupNotice({ state }) {
  const [url, setUrl] = useState('')
  useEffect(() => { setUrl(`${window.location.origin}/api/sms/inbound`) }, [])

  return (
    <div style={{ padding:'16px 18px', border:'1px solid var(--border)', background:'var(--g50)', marginBottom:20, fontSize:13, lineHeight:1.7, color:'var(--g700)' }}>
      <strong style={{ color:'var(--black)' }}>No phone number is connected yet.</strong>{' '}
      The inbox works, but nothing can arrive in it and no reply can be sent.
      <div style={{ marginTop:10 }}>
        Missing: {state.missing.map(m => (
          <code key={m} style={{ fontSize:12, background:'var(--white)', border:'1px solid var(--border)', padding:'1px 5px', marginRight:6 }}>{m}</code>
        ))}
      </div>
      {state.sidLooksWrong && (
        <div style={{ marginTop:8, color:'var(--danger)' }}>
          TWILIO_ACCOUNT_SID does not start with “AC”. That is usually an API key SID
          rather than the account SID.
        </div>
      )}
      <div style={{ marginTop:10, color:'var(--gray)' }}>
        In Twilio, set the number’s incoming-message webhook to{' '}
        <code style={{ fontSize:12, background:'var(--white)', border:'1px solid var(--border)', padding:'1px 5px' }}>{url}</code>{' '}
        (HTTP POST). US numbers also need A2P 10DLC registration before carriers will
        deliver anything.
      </div>
    </div>
  )
}

function Tab({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding:'9px 16px', fontSize:12, fontWeight:600, letterSpacing:'0.1em',
      textTransform:'uppercase', cursor:'pointer',
      background: active ? 'var(--black)' : 'var(--white)',
      color: active ? 'var(--white)' : 'var(--gray)',
      border:'1px solid var(--border)',
    }}>{children}</button>
  )
}

// ── The list ─────────────────────────────────────────────
function ThreadRow({ thread, active, onClick }) {
  const who = thread.contact?.displayName || formatPhone(thread.contact?.phone)
  return (
    <button onClick={onClick} style={{
      display:'block', width:'100%', textAlign:'left', padding:'14px 16px',
      border:'none', borderBottom:'1px solid var(--border)', cursor:'pointer',
      background: active ? 'var(--g100)' : 'var(--white)',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
        {thread.unread && (
          <span style={{ width:7, height:7, borderRadius:'50%', background:'var(--black)', flexShrink:0 }} />
        )}
        <span style={{ fontSize:14, color:'var(--black)', fontWeight: thread.unread ? 600 : 400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{who}</span>
        <span style={{ marginLeft:'auto', fontSize:11, color:'var(--gray-light)', flexShrink:0 }}>
          {formatRelativeTime(thread.lastMessageAt)}
        </span>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5, flexWrap:'wrap' }}>
        <AudienceChip audience={thread.contact?.audience} small />
        {thread.project && (
          <span style={{ fontSize:11, color:'var(--gray)' }}>{thread.project.name}</span>
        )}
        {thread.hasOpenTask && (
          <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--gray-light)' }}>· open task</span>
        )}
      </div>
      <div style={{ fontSize:12, color:'var(--gray)', lineHeight:1.5, overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
        {thread.lastMessage
          ? `${thread.lastMessage.direction === 'outbound' ? 'You: ' : ''}${thread.lastMessage.body}`
          : 'No messages'}
      </div>
    </button>
  )
}

// ── One thread ───────────────────────────────────────────
function ThreadView({ id, data, onBack, onChanged }) {
  const [thread, setThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [audience, setAudience] = useState(null)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [identifying, setIdentifying] = useState(false)
  const bottom = useRef(null)

  const isAdmin = ['owner', 'admin'].includes(data?.me?.role)

  const load = useCallback(async (markRead) => {
    const res = await fetch(`/api/inbox/${id}`)
    const d = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(d.error || 'Could not load the thread.'); return }
    setThread(d.thread); setMessages(d.messages); setAudience(d.audience)
    if (markRead) {
      await fetch(`/api/inbox/${id}`, {
        method:'PATCH',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ markRead:true }),
      })
      onChanged()
    }
  }, [id, onChanged])

  useEffect(() => { load(true) }, [load])
  useEffect(() => { bottom.current?.scrollIntoView({ block:'end' }) }, [messages.length])

  async function send() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true); setErr('')

    const res = await fetch(`/api/inbox/${id}/reply`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ body: text }),
    })
    const d = await res.json().catch(() => ({}))
    setSending(false)

    if (!res.ok) { setErr(d.error || 'Could not send.'); return }
    // Kept in the box on failure — a message that failed to send should
    // not also disappear.
    if (d.sent) setBody('')
    else setErr(d.error || 'Saved to the thread, but the carrier rejected it.')
    load(false); onChanged()
  }

  async function patch(payload) {
    await fetch(`/api/inbox/${id}`, {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
    })
    load(false); onChanged()
  }

  if (!thread) return <div style={{ padding:30 }}><div className="spinner" /></div>

  const contact = thread.contact || {}
  const unknown = contact.audience === 'unknown'
  const who = contact.display_name || formatPhone(contact.phone)

  return (
    <>
      <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <button className="inbox-back" onClick={onBack} style={{ background:'none', border:'none', cursor:'pointer', padding:'0 8px 0 0', alignItems:'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:15, color:'var(--black)' }}>{who}</div>
          <div style={{ fontSize:11, color:'var(--gray-light)' }}>
            {formatPhone(contact.phone)}
            {thread.project ? ` · ${thread.project.name}` : ' · No project'}
            {contact.opted_out_at ? ' · opted out' : ''}
          </div>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <AudienceChip audience={contact.audience} />
          <select
            value={thread.assigneeId || ''}
            onChange={e => patch({ assigneeId: e.target.value || null })}
            style={{ fontSize:12, padding:'5px 8px', border:'1px solid var(--border)', background:'var(--white)' }}>
            <option value="">Unassigned</option>
            {(data?.people || []).map(p => (
              <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
            ))}
          </select>
          <button onClick={() => patch({ status: thread.status === 'closed' ? 'open' : 'closed' })}
            style={{ fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', padding:'6px 10px', background:'var(--white)', border:'1px solid var(--border)', cursor:'pointer', color:'var(--gray)' }}>
            {thread.status === 'closed' ? 'Reopen' : 'Close'}
          </button>
        </div>
      </div>

      {/* What may be said in this thread, in front of the person about to
          say something. */}
      {audience && (
        <div style={{
          padding:'10px 18px', fontSize:12, lineHeight:1.6,
          borderBottom:'1px solid var(--border)',
          background: unknown ? 'var(--danger-bg)' : 'var(--g50)',
          color: unknown ? 'var(--danger)' : 'var(--g600)',
        }}>
          {audience.scope}
        </div>
      )}

      <div className="inbox-messages">
        {messages.map(m => <Bubble key={m.id} message={m} />)}
        <div ref={bottom} />
      </div>

      {unknown ? (
        <div style={{ padding:'16px 18px', borderTop:'1px solid var(--border)', background:'var(--g50)' }}>
          <div style={{ fontSize:13, color:'var(--g700)', lineHeight:1.7, marginBottom: isAdmin ? 12 : 0 }}>
            Replies are held until somebody says who this number belongs to. A phone
            number on its own does not establish that, and the answer decides whether
            this person may be told prices.
          </div>
          {isAdmin ? (
            identifying ? (
              <IdentifyPanel
                id={id} data={data} contact={contact}
                onDone={() => { setIdentifying(false); load(false); onChanged() }}
                onCancel={() => setIdentifying(false)}
              />
            ) : (
              <button onClick={() => setIdentifying(true)} style={{
                padding:'9px 16px', fontSize:12, fontWeight:600, letterSpacing:'0.1em',
                textTransform:'uppercase', background:'var(--black)', color:'var(--white)',
                border:'none', cursor:'pointer',
              }}>Identify this number</button>
            )
          ) : (
            <div style={{ fontSize:12, color:'var(--gray-light)', marginTop:8 }}>
              An owner or admin can do that from this thread.
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding:'12px 18px', borderTop:'1px solid var(--border)' }}>
          {err && <div style={{ fontSize:12, color:'var(--danger)', marginBottom:8 }}>{err}</div>}
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
            placeholder={`Reply to ${who}…`}
            rows={3}
            style={{ width:'100%', padding:'10px 12px', fontSize:15, fontFamily:'inherit', border:'1px solid var(--border)', resize:'vertical' }}
          />
          <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:8, flexWrap:'wrap' }}>
            <button onClick={send} disabled={sending || !body.trim()} style={{
              padding:'9px 20px', fontSize:12, fontWeight:600, letterSpacing:'0.1em',
              textTransform:'uppercase', border:'none',
              background: sending || !body.trim() ? 'var(--g300)' : 'var(--black)',
              color:'var(--white)', cursor: sending || !body.trim() ? 'default' : 'pointer',
            }}>{sending ? 'Sending…' : 'Send text'}</button>
            <span style={{ fontSize:11, color:'var(--gray-light)' }}>
              {body.length} characters · goes out as a text message
            </span>
          </div>
        </div>
      )}
    </>
  )
}

function Bubble({ message }) {
  const out = message.direction === 'outbound'
  const failed = message.status === 'failed'
  return (
    <div style={{ display:'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth:'78%' }}>
        <div style={{
          padding:'10px 13px', fontSize:14, lineHeight:1.6, whiteSpace:'pre-wrap',
          background: out ? 'var(--black)' : 'var(--g100)',
          color: out ? 'var(--white)' : 'var(--black)',
          border: failed ? '1px solid var(--danger)' : 'none',
        }}>{message.body}</div>
        <div style={{ fontSize:10, color: failed ? 'var(--danger)' : 'var(--gray-light)', marginTop:4, textAlign: out ? 'right' : 'left' }}>
          {/* An automatic acknowledgement is labelled as one. Nobody should
              have to wonder which colleague sent a message they did not. */}
          {message.author === 'assistant' ? 'Automatic · ' : ''}
          {formatRelativeTime(message.created_at)}
          {failed ? ` · not delivered${message.error ? `: ${message.error}` : ''}` : ''}
        </div>
      </div>
    </div>
  )
}

// ── Saying who somebody is ───────────────────────────────
function IdentifyPanel({ id, data, contact, onDone, onCancel }) {
  const [audience, setAudience] = useState('client')
  const [projectId, setProjectId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [displayName, setDisplayName] = useState(contact.display_name || '')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true); setErr('')
    const res = await fetch(`/api/inbox/${id}/identify`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ audience, projectId: projectId || null, profileId: profileId || null, vendorId: vendorId || null, displayName }),
    })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { setErr(d.error || 'Could not save.'); return }
    onDone()
  }

  const field = { width:'100%', padding:'8px 10px', fontSize:14, border:'1px solid var(--border)', background:'var(--white)', marginBottom:10 }

  return (
    <div style={{ border:'1px solid var(--border)', background:'var(--white)', padding:16 }}>
      {err && <div style={{ fontSize:12, color:'var(--danger)', marginBottom:10 }}>{err}</div>}

      <Label>Who is {formatPhone(contact.phone)}?</Label>
      <select value={audience} onChange={e => setAudience(e.target.value)} style={field}>
        <option value="client">A client — may see released prices for their project</option>
        <option value="manufacturer">A vendor — may see their own schedule and their own quote</option>
        <option value="internal">Someone on the team</option>
      </select>

      <Label>Name</Label>
      <input value={displayName} onChange={e => setDisplayName(e.target.value)}
        placeholder="How this thread should be labelled" style={field} />

      {audience === 'client' && (
        <>
          <Label>Project</Label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} style={field}>
            <option value="">Choose a project…</option>
            {(data?.projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <Label>Account (optional)</Label>
          <select value={profileId} onChange={e => setProfileId(e.target.value)} style={field}>
            <option value="">Not linked to an account</option>
            {(data?.clients || []).map(c => (
              <option key={c.id} value={c.id}>{c.full_name || c.email}</option>
            ))}
          </select>
        </>
      )}

      {audience === 'manufacturer' && (
        <>
          <Label>Vendor</Label>
          <select value={vendorId} onChange={e => setVendorId(e.target.value)} style={field}>
            <option value="">Not linked to a vendor</option>
            {(data?.vendors || []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

          <Label>Project (optional)</Label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} style={field}>
            <option value="">Leave unscoped — they quote on several</option>
            {(data?.projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      )}

      <div style={{ display:'flex', gap:10, marginTop:6 }}>
        <button onClick={save} disabled={saving} style={{
          padding:'9px 18px', fontSize:12, fontWeight:600, letterSpacing:'0.1em',
          textTransform:'uppercase', background:'var(--black)', color:'var(--white)',
          border:'none', cursor:'pointer',
        }}>{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} style={{
          padding:'9px 18px', fontSize:12, fontWeight:600, letterSpacing:'0.1em',
          textTransform:'uppercase', background:'var(--white)', color:'var(--gray)',
          border:'1px solid var(--border)', cursor:'pointer',
        }}>Cancel</button>
      </div>
    </div>
  )
}

function Label({ children }) {
  return (
    <div style={{ fontSize:11, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:5 }}>
      {children}
    </div>
  )
}

// ── Who answers for each project ─────────────────────────
// The default owner of anything that arrives about a project. Set here
// rather than buried in project settings, because the question it answers
// — "who picks this up when nobody claims it" — is a question about the
// inbox, and this is the screen where its absence is felt.
function RoutingPanel({ projects, people, onChanged }) {
  const [saving, setSaving] = useState(null)

  async function set(projectId, assigneeId) {
    setSaving(projectId)
    await fetch('/api/inbox/routing', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ projectId, assigneeId: assigneeId || null }),
    })
    setSaving(null)
    onChanged()
  }

  if (!projects.length) return null

  return (
    <div style={{ marginTop:32 }}>
      <div style={{ fontSize:12, fontWeight:600, letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--gray-light)', marginBottom:10 }}>
        Who answers for each project
      </div>
      <div style={{ fontSize:12, color:'var(--gray)', lineHeight:1.7, marginBottom:12, maxWidth:600 }}>
        New messages about a project are assigned to this person. Anyone can hand a
        thread to somebody else once it arrives. Left unset, it falls to the owner.
      </div>
      <div style={{ border:'1px solid var(--border)', background:'var(--white)' }}>
        {projects.map(p => (
          <div key={p.id} style={{ padding:'11px 16px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <span style={{ flex:'1 1 200px', fontSize:14, color:'var(--black)' }}>{p.name}</span>
            <select
              value={p.primary_contact_id || ''}
              disabled={saving === p.id}
              onChange={e => set(p.id, e.target.value)}
              style={{ fontSize:12, padding:'5px 8px', border:'1px solid var(--border)', background:'var(--white)' }}>
              <option value="">Falls to the owner</option>
              {people.map(x => <option key={x.id} value={x.id}>{x.full_name || x.email}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tasks ────────────────────────────────────────────────
function TasksPanel({ tasks, people, threads, onOpen, onChanged }) {
  const nameOf = id => {
    const p = people.find(x => x.id === id)
    return p ? (p.full_name || p.email) : 'Unassigned'
  }
  const threadOf = id => threads.find(t => t.id === id)

  async function patch(taskId, payload) {
    await fetch(`/api/tasks/${taskId}`, {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
    })
    onChanged()
  }

  if (!tasks.length) {
    return (
      <div style={{ padding:'40px 24px', border:'1px solid var(--border)', background:'var(--white)', textAlign:'center', fontSize:13, color:'var(--gray-light)', lineHeight:1.7 }}>
        Nothing outstanding. A task appears here whenever a message arrives that nobody
        has answered.
      </div>
    )
  }

  return (
    <div style={{ border:'1px solid var(--border)', background:'var(--white)' }}>
      {tasks.map(t => {
        const thread = threadOf(t.conversation_id)
        return (
          <div key={t.id} style={{ padding:'14px 16px', borderBottom:'1px solid var(--border)', display:'flex', gap:14, alignItems:'flex-start', flexWrap:'wrap' }}>
            <div style={{ flex:'1 1 260px', minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                <span style={{ fontSize:14, color:'var(--black)' }}>{t.title}</span>
                {thread?.contact && <AudienceChip audience={thread.contact.audience} small />}
                {t.reason === 'unknown_contact' && (
                  <span style={{ fontSize:10, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--danger)' }}>Not identified</span>
                )}
              </div>
              {t.detail && (
                <div style={{ fontSize:12, color:'var(--gray)', lineHeight:1.6 }}>{t.detail}</div>
              )}
              <div style={{ fontSize:11, color:'var(--gray-light)', marginTop:5 }}>
                {nameOf(t.assignee_id)} · {formatRelativeTime(t.created_at)}
                {thread?.project ? ` · ${thread.project.name}` : ''}
              </div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <select value={t.assignee_id || ''} onChange={e => patch(t.id, { assigneeId: e.target.value || null })}
                style={{ fontSize:12, padding:'5px 8px', border:'1px solid var(--border)', background:'var(--white)' }}>
                <option value="">Unassigned</option>
                {people.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
              </select>
              {t.conversation_id && (
                <button onClick={() => onOpen(t.conversation_id)} style={{
                  fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase',
                  padding:'6px 10px', background:'var(--black)', color:'var(--white)', border:'none', cursor:'pointer',
                }}>Open</button>
              )}
              <button onClick={() => patch(t.id, { status:'done' })} style={{
                fontSize:11, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase',
                padding:'6px 10px', background:'var(--white)', color:'var(--gray)', border:'1px solid var(--border)', cursor:'pointer',
              }}>Done</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

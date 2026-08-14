import { NextResponse } from 'next/server'
import { requireInternal, hasFullAccess } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSnapshot } from '@/lib/projectContext'
import { priceState, PRICE_STATES, daysSince } from '@/lib/priceState'

// GET /api/projects/overview — what the portal home needs to answer the
// three questions people actually open it for: what is waiting on me, what
// changed, and what is this running at.
//
// The old home answered "what folders exist". It listed categories and a
// bare item count, and the only number on the screen was 52.
//
// Reads through the service role so one request covers every project, which
// makes the access filter below load-bearing — RLS is not filtering here.
// Money comes from buildSnapshot, the same function behind reporting, chat
// and the project dashboard, so no figure here can disagree with those.

// A project is overdue when a vendor has been sitting on a schedule for
// longer than this without pricing it.
const OVERDUE_DAYS = 5

export async function GET() {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { user } = auth

  const admin = createAdminClient()

  let q = admin.from('projects').select('id, name, client, slug, categories, created_at')
    .is('deleted_at', null)
  if (!hasFullAccess(user.role)) {
    const { data: memberships } = await admin
      .from('project_members').select('project_id').eq('user_id', user.id)
    const ids = (memberships || []).map(m => m.project_id)
    if (!ids.length) return NextResponse.json({ projects: [], totals: emptyTotals() })
    q = q.in('id', ids)
  }

  const { data: projects, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!projects?.length) return NextResponse.json({ projects: [], totals: emptyTotals() })

  const ids = projects.map(p => p.id)
  const [{ data: schedules }, { data: submissions }, { data: approvals }] = await Promise.all([
    admin.from('schedules').select('*').in('project_id', ids),
    admin.from('submissions').select('*').in('project_id', ids),
    admin.from('approvals').select('*').in('project_id', ids),
  ])

  const by = (rows, key) => {
    const map = {}
    ;(rows || []).forEach(r => { (map[r[key]] ||= []).push(r) })
    return map
  }
  const schedulesBy = by(schedules, 'project_id')
  const submissionsBy = by(submissions, 'project_id')
  const approvalsBy = by(approvals, 'project_id')

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const rows = projects.map(project => {
    const projSchedules = schedulesBy[project.id] || []
    const projSubs = submissionsBy[project.id] || []
    const projApprovals = approvalsBy[project.id] || []

    const snapshot = buildSnapshot({
      project, schedules: projSchedules, submissions: projSubs, approvals: projApprovals,
    })

    const apprByKey = {}
    projApprovals.forEach(a => { apprByKey[`${a.category}|||${a.item_key}`] = a })

    let priced = 0, pendingPriced = 0, approved = 0, rejected = 0, itemCount = 0
    let oldestWait = null

    projSchedules.forEach(sched => {
      const catSubs = projSubs.filter(s => s.category === sched.category)
      ;(sched.items || []).forEach((item, i) => {
        itemCount++
        const ap = apprByKey[`${sched.category}|||${item.key}`]
        const state = priceState(sched.category, catSubs, item, i, ap)
        if (state === PRICE_STATES.priced) {
          priced++
          // Only a priced line can be waiting on a decision. Counting
          // unpriced ones as "pending approval" is what made the old
          // number meaningless.
          if (!ap || ap.status === 'pending') pendingPriced++
        } else if (sched.created_at) {
          const d = daysSince(sched.created_at)
          if (d != null && (oldestWait == null || d > oldestWait)) oldestWait = d
        }
        if (ap?.status === 'approved') approved++
        if (ap?.status === 'rejected') rejected++
      })
    })

    // Latest movement of any kind, which is what "updated" has to mean for
    // the column to be worth sorting on.
    let updatedAt = project.created_at
    ;[...projSubs.map(s => s.submitted_at), ...projApprovals.map(a => a.updated_at)]
      .forEach(ts => { if (ts && new Date(ts) > new Date(updatedAt)) updatedAt = ts })

    // Value approved within this calendar month, which is the only "what
    // changed" the data can support honestly: approvals carry a timestamp,
    // individual price edits do not.
    let approvedThisMonth = 0
    snapshot.categories.forEach(c => {
      c.items.forEach(it => {
        if (it.status !== 'approved') return
        const ap = apprByKey[`${c.category}|||${it.key}`]
        if (ap?.updated_at && new Date(ap.updated_at) >= monthStart) {
          approvedThisMonth += it.lineTotal || 0
        }
      })
    })

    const overdue = oldestWait != null && oldestWait > OVERDUE_DAYS
    const status = overdue ? 'overdue'
      : pendingPriced > 0 ? 'pending'
      : itemCount > 0 && approved === itemCount ? 'complete'
      : priced === 0 ? 'awaiting'
      : 'active'

    return {
      slug: project.slug,
      name: project.name,
      client: project.client,
      categories: project.categories || [],
      value: snapshot.totals.revenue,
      itemCount,
      priced,
      pending: pendingPriced,
      approved,
      rejected,
      waitingDays: oldestWait,
      overdue,
      status,
      updatedAt,
      approvedThisMonth: round(approvedThisMonth),
    }
  })

  // Urgency, not the alphabet. The order alone should answer "what is
  // waiting on me" before anyone reads a single row.
  const rank = { overdue: 0, pending: 1, awaiting: 2, active: 3, complete: 4 }
  rows.sort((a, b) =>
    (rank[a.status] - rank[b.status]) ||
    (b.waitingDays || 0) - (a.waitingDays || 0) ||
    b.pending - a.pending ||
    new Date(b.updatedAt) - new Date(a.updatedAt)
  )

  const totals = {
    activeValue: round(rows.reduce((s, r) => s + r.value, 0)),
    pendingApproval: rows.reduce((s, r) => s + r.pending, 0),
    overdue: rows.filter(r => r.overdue).length,
    approvedThisMonth: round(rows.reduce((s, r) => s + r.approvedThisMonth, 0)),
    projectCount: rows.length,
  }

  return NextResponse.json({ projects: rows, totals, overdueDays: OVERDUE_DAYS })
}

const round = n => parseFloat(Number(n || 0).toFixed(2))

function emptyTotals() {
  return { activeValue: 0, pendingApproval: 0, overdue: 0, approvedThisMonth: 0, projectCount: 0 }
}

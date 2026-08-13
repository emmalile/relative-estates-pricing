import { NextResponse } from 'next/server'
import { requireInternal, hasFullAccess } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildSnapshot } from '@/lib/projectContext'
import { getCategory } from '@/lib/categories'

// GET /api/reporting — cost, revenue and profit across every project the
// caller can see.
//
// Reads through the service-role client so one request can cover many
// projects, which makes the access filter below load-bearing: RLS is not
// doing the filtering, so this route decides which projects are in scope.
// owner and admin see everything; a member sees only projects they are on.
//
// Every figure comes from buildSnapshot, the same function behind chat and
// the same pricing rules as the dashboard.
export async function GET() {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { user } = auth

  const admin = createAdminClient()

  let projectQuery = admin.from('projects').select('id, name, client, slug, categories, created_at')
  if (!hasFullAccess(user.role)) {
    const { data: memberships } = await admin
      .from('project_members').select('project_id').eq('user_id', user.id)
    const ids = (memberships || []).map(m => m.project_id)
    if (!ids.length) {
      return NextResponse.json({ projects: [], categories: [], totals: emptyTotals() })
    }
    projectQuery = projectQuery.in('id', ids)
  }

  const { data: projects, error } = await projectQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!projects?.length) {
    return NextResponse.json({ projects: [], categories: [], totals: emptyTotals() })
  }

  const ids = projects.map(p => p.id)

  // Fetched in bulk and grouped here rather than per project, so the number
  // of round trips does not grow with the number of projects.
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

  const categoryRollup = {}
  const rows = projects.map(project => {
    const snapshot = buildSnapshot({
      project,
      schedules: schedulesBy[project.id] || [],
      submissions: submissionsBy[project.id] || [],
      approvals: approvalsBy[project.id] || [],
    })

    snapshot.categories.forEach(c => {
      const r = (categoryRollup[c.category] ||= {
        category: c.category,
        label: getCategory(c.category)?.label || c.category,
        projects: 0, itemCount: 0, cost: 0, revenue: 0,
      })
      r.projects++
      r.itemCount += c.itemCount
      r.cost += c.totalCost
      r.revenue += c.totalRevenue
    })

    return {
      slug: project.slug,
      name: project.name,
      client: project.client,
      createdAt: project.created_at,
      categories: snapshot.categories.map(c => c.category),
      ...snapshot.totals,
    }
  })

  const totals = rows.reduce((acc, r) => {
    acc.cost += r.cost
    acc.revenue += r.revenue
    acc.itemCount += r.itemCount
    acc.pricedItemCount += r.pricedItemCount
    return acc
  }, emptyTotals())

  totals.profit = round(totals.revenue - totals.cost)
  totals.cost = round(totals.cost)
  totals.revenue = round(totals.revenue)
  totals.marginPct = totals.revenue > 0
    ? parseFloat(((totals.profit / totals.revenue) * 100).toFixed(1)) : null
  totals.projectCount = rows.length

  return NextResponse.json({
    projects: rows.sort((a, b) => b.revenue - a.revenue),
    categories: Object.values(categoryRollup).map(c => ({
      ...c,
      cost: round(c.cost),
      revenue: round(c.revenue),
      profit: round(c.revenue - c.cost),
      marginPct: c.revenue > 0 ? parseFloat((((c.revenue - c.cost) / c.revenue) * 100).toFixed(1)) : null,
    })).sort((a, b) => b.revenue - a.revenue),
    totals,
  })
}

const round = n => parseFloat(n.toFixed(2))

function emptyTotals() {
  return {
    cost: 0, revenue: 0, profit: 0, marginPct: null,
    itemCount: 0, pricedItemCount: 0, projectCount: 0,
  }
}

import { NextResponse } from 'next/server'
import { requireInternal } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessProject } from '@/lib/projectAccess'
import { buildChatTools } from '@/lib/chatTools'
import {
  createAnthropicClient, EXTRACTION_MODEL,
  isExtractionConfigured, extractionDiagnostics, logExtractionUnconfigured,
} from '@/lib/anthropic'

// Several tool calls and a considered answer take longer than a page load.
export const maxDuration = 300

// Chat is interactive, and Claude Opus 5 answers structured questions well
// below its top effort setting. Extraction runs at high because a misread
// price is money; this reads numbers that are already computed, where the
// work is selecting and explaining rather than deriving.
const CHAT_EFFORT = 'medium'

const SYSTEM = `You answer questions about a single interior construction project for the firm's own team.

Everything you know comes from your tools. Call them before answering — do not answer a question about quantities, prices, or documents from the conversation alone, and never estimate a number that a tool could give you. If the data does not contain the answer, say exactly what is missing rather than filling the gap.

How the numbers work:
- A line item's quantity comes from what the team has entered against it. Zero means nobody has entered one yet, not that the quantity is zero. Say so rather than reporting zero as a fact.
- costPerUnit is what the firm pays. clientPricePerUnit is what the client is charged. Never present cost to anyone as the client price or the reverse.
- Units differ by category — stone is quoted by area, doors by the door. Never add quantities across categories; a total that mixes square metres and door counts is meaningless.
- lineTotal and the category totals are already computed. Use them rather than multiplying your own.
- Items with status "rejected" are excluded from totals. Mention them separately if they matter to the question.

Lead with the answer. A question with a number for an answer should open with that number, then the breakdown that supports it. Give the reasoning after the result, not before it, and only as far as it helps someone act. Use a table when comparing several line items; prose otherwise.

Say where a figure came from when it is not obvious — which category, how many items it covers, whether anything was excluded. Someone reading your answer should be able to check it.`

// POST /api/chat — a question about one project.
//
// The project is resolved from the slug and checked against the caller's
// access before any tool exists. Tools are then bound to that project id, so
// the model has no way to name a different one.
export async function POST(request) {
  const auth = await requireInternal()
  if (auth.response) return auth.response
  const { user } = auth

  const { projectSlug, messages } = await request.json()
  if (!projectSlug || !Array.isArray(messages) || !messages.length) {
    return NextResponse.json({ error: 'projectSlug and messages are required' }, { status: 400 })
  }

  if (!isExtractionConfigured()) {
    logExtractionUnconfigured('POST /api/chat')
    return NextResponse.json({
      error: 'ANTHROPIC_API_KEY is not available to this deployment, so chat cannot run.',
      diagnostics: extractionDiagnostics(),
    }, { status: 503 })
  }

  const admin = createAdminClient()
  const { data: project } = await admin
    .from('projects').select('id, name, slug').eq('slug', projectSlug).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!(await canAccessProject(user, project.id))) {
    return NextResponse.json({ error: 'Not authorized for this project' }, { status: 403 })
  }

  // Only role and text survive from the browser. Anything else a client might
  // put in the payload — tool results, other content blocks — is dropped, so
  // the conversation cannot be used to feed the model fabricated tool output.
  const history = messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content }))

  if (!history.length || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'The last message must be from the user.' }, { status: 400 })
  }

  const client = createAnthropicClient()
  const { tools, used } = buildChatTools({ admin, projectId: project.id })

  try {
    const runner = client.beta.messages.toolRunner({
      model: EXTRACTION_MODEL,
      max_tokens: 16000,
      system: `${SYSTEM}\n\nThe project is "${project.name}".`,
      thinking: { type: 'adaptive' },
      output_config: { effort: CHAT_EFFORT },
      tools,
      messages: history,
      max_iterations: 12,
    })

    // The last message the runner yields is the final answer — iteration ends
    // when Claude stops calling tools.
    let final = null
    for await (const message of runner) final = message

    if (!final) {
      return NextResponse.json({ error: 'No answer was produced.' }, { status: 502 })
    }
    if (final.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'Claude declined to answer that.' }, { status: 502 })
    }

    const answer = final.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()

    return NextResponse.json({
      answer: answer || 'No answer was produced — try rephrasing the question.',
      // What it consulted, so an answer can be checked rather than trusted.
      consulted: used,
      usage: {
        input_tokens: final.usage?.input_tokens ?? null,
        output_tokens: final.usage?.output_tokens ?? null,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Chat failed.' }, { status: 502 })
  }
}

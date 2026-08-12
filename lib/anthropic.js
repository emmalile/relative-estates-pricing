import Anthropic from '@anthropic-ai/sdk'

// Claude client for reading project documents.
//
// SERVER ONLY. The key is never sent to the browser, and document content is
// only ever read on the server — the extraction routes download from Dropbox,
// send to the API, and return proposed line items.

// Extraction reads documents and proposes money-bearing line items a person
// then reviews, so it runs on the most capable model rather than the cheapest.
export const EXTRACTION_MODEL = 'claude-opus-5'

const KEY = 'ANTHROPIC_API_KEY'

// Whether the key is usable, and if not, why. "Not set" and "set to an empty
// value" look identical from the outside but have different fixes, and a
// variable saved with no value is easy to do by accident.
export function extractionKeyState() {
  const raw = process.env[KEY]
  if (raw === undefined) return 'absent'
  if (raw === '') return 'empty'
  if (!raw.trim()) return 'blank'
  return 'present'
}

// Names of environment variables that look like they were meant to be this
// one. A key saved under a slightly wrong name is invisible from the outside:
// the variable exists, the deployment is current, and nothing reads it.
//
// Names only. Values are never read here and never leave the server.
export function anthropicVarNames() {
  return Object.keys(process.env).filter(k => /anthropic|claude/i.test(k)).sort()
}

export function missingExtractionVars() {
  return extractionKeyState() === 'present' ? [] : [KEY]
}

export function isExtractionConfigured() {
  return extractionKeyState() === 'present'
}

// What the deployment is, so a stale build is visible rather than deduced.
// Vercel sets these; locally they are absent and the fields come back null.
export function deploymentInfo() {
  return {
    env: process.env.VERCEL_ENV || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
  }
}

let cached = null

export function createAnthropicClient() {
  const state = extractionKeyState()
  if (state !== 'present') {
    throw new Error(
      state === 'absent'
        ? `${KEY} is not set in this deployment.`
        : `${KEY} is set but has no value in this deployment.`
    )
  }
  if (!cached) {
    // Trimmed because pasting a key commonly carries a trailing newline or
    // space, which the API rejects as an invalid key rather than as whitespace.
    cached = new Anthropic({ apiKey: process.env[KEY].trim() })
  }
  return cached
}

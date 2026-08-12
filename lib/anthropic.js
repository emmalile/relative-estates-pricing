import Anthropic from '@anthropic-ai/sdk'

// Claude client for reading project documents.
//
// SERVER ONLY. The key is never sent to the browser, and document content is
// only ever read on the server — the extraction routes download from Dropbox,
// send to the API, and return proposed line items.

// Extraction reads documents and proposes money-bearing line items a person
// then reviews, so it runs on the most capable model rather than the cheapest.
export const EXTRACTION_MODEL = 'claude-opus-5'

export function missingExtractionVars() {
  return ['ANTHROPIC_API_KEY'].filter(name => !process.env[name])
}

export function isExtractionConfigured() {
  return missingExtractionVars().length === 0
}

let cached = null

export function createAnthropicClient() {
  const missing = missingExtractionVars()
  if (missing.length) {
    throw new Error(
      `${missing.join(' and ')} is not set in this deployment. Add it in Vercel ` +
      'under Project Settings > Environment Variables, then redeploy. Create a ' +
      'key at https://console.anthropic.com/settings/keys.'
    )
  }
  if (!cached) {
    cached = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return cached
}

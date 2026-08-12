import { getCategory } from './categories'
import { createAnthropicClient, EXTRACTION_MODEL } from './anthropic'

// Reading a vendor document into proposed schedule line items.
//
// Nothing here writes to the database. Extraction proposes; a person reviews
// and approves; only then does anything reach a schedule. That separation is
// the point — a model reading a PDF is a fast first draft, not an authority
// on what a project is buying.

// Anthropic accepts a 32 MB request; base64 inflates by about a third, so the
// practical ceiling on the file itself is lower. Refuse early with a message
// that says what to do rather than letting the API reject it.
export const MAX_FILE_BYTES = 20 * 1024 * 1024

const PDF_EXTS = ['pdf']
const TEXT_EXTS = ['csv', 'tsv', 'txt', 'md']

export function isExtractable(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '')
  return PDF_EXTS.includes(e) || TEXT_EXTS.includes(e)
}

// The fields a line item carries are the same ones a CSV import fills in, so
// an extracted item and an imported one are the same shape. Deriving the
// schema from the category means adding a category adds extraction with it.
export function extractionSchemaFor(category) {
  const fields = Object.keys(category.csvColumns)

  const properties = {}
  for (const field of fields) {
    // The CSV aliases are the column headings this field appears under in
    // real documents, which is the most useful description available.
    const aliases = category.csvColumns[field] || []
    properties[field] = {
      type: 'string',
      description:
        `${field}. In documents this is usually labelled: ${aliases.join(', ')}. ` +
        'Empty string if the document does not state it.',
    }
  }
  properties.sourceLocation = {
    type: 'string',
    description:
      'Where in the document this row came from — page number, table name, or row ' +
      'number. Used by a reviewer to check the row against the source.',
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'notes'],
    properties: {
      items: {
        type: 'array',
        description: 'One entry per distinct line item found in the document.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...fields, 'sourceLocation'],
          properties,
        },
      },
      notes: {
        type: 'string',
        description:
          'Anything a reviewer needs to know: parts of the document that were ' +
          'ambiguous or unreadable, totals that did not add up, sections skipped ' +
          'and why. Empty string if there is nothing to flag.',
      },
    },
  }
}

function systemPrompt(category) {
  return [
    `You read supplier documents for an interior construction firm and pull out the ${category.label.toLowerCase()} line items they list.`,
    '',
    'The output feeds a pricing schedule that people quote real money against, so a wrong value is worse than a missing one.',
    '',
    'Transcribe what the document says. Do not calculate values the document omits, do not carry a value across from a neighbouring row, and do not fill a field from what a similar item would usually be. A field the document does not state is an empty string.',
    '',
    'One entry per distinct line item. Where a document lists the same item several times for different rooms, that is still one entry — put the rooms in the location field. Ignore headers, totals, subtotals, and summary rows: those are not items.',
    '',
    'Copy identifiers, dimensions, and prices exactly as printed, including their units. Do not convert between units.',
    '',
    'Give each entry a sourceLocation precise enough for a reviewer to find the original row without reading the whole document.',
  ].join('\n')
}

function userContent({ fileName, mediaType, bytes, category }) {
  const instruction = {
    type: 'text',
    text:
      `Document: ${fileName}\n\n` +
      `Pull out every ${category.label.toLowerCase()} line item it lists. ` +
      'If the document turns out not to contain any, return an empty items array and say so in notes.',
  }

  if (mediaType === 'application/pdf') {
    return [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') },
      },
      instruction,
    ]
  }

  return [
    { type: 'text', text: `<document name="${fileName}">\n${bytes.toString('utf8')}\n</document>` },
    instruction,
  ]
}

export function mediaTypeFor(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '')
  return PDF_EXTS.includes(e) ? 'application/pdf' : 'text/plain'
}

// Reads one document and returns the rows it proposes. Throws with a message
// meant for a person if the document cannot be read.
export async function extractItems({ categoryId, fileName, ext, bytes }) {
  const category = getCategory(categoryId)
  if (!category) throw new Error(`Unknown category: ${categoryId}`)

  if (bytes.length > MAX_FILE_BYTES) {
    throw new Error(
      `${fileName} is ${(bytes.length / 1024 / 1024).toFixed(1)} MB, over the ` +
      `${MAX_FILE_BYTES / 1024 / 1024} MB limit for a single document. Split it and extract each part.`
    )
  }

  const client = createAnthropicClient()

  // Streamed because a long schedule can run to thousands of tokens of JSON,
  // and a non-streaming request that size risks an HTTP timeout.
  const stream = client.messages.stream({
    model: EXTRACTION_MODEL,
    max_tokens: 32000,
    system: systemPrompt(category),
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: extractionSchemaFor(category) },
    },
    messages: [
      {
        role: 'user',
        content: userContent({ fileName, mediaType: mediaTypeFor(ext), bytes, category }),
      },
    ],
  })

  const message = await stream.finalMessage()

  if (message.stop_reason === 'refusal') {
    throw new Error(
      'Claude declined to read this document. If it is an ordinary supplier ' +
      'document, this is likely a false positive — try again, or extract from a different file.'
    )
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error(
      `${fileName} produced more line items than fit in one response. Split the ` +
      'document and extract each part separately.'
    )
  }

  const text = message.content.find(b => b.type === 'text')?.text
  if (!text) throw new Error('Claude returned no content for this document.')

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Claude returned a response that could not be read as line items.')
  }

  return {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    usage: {
      input_tokens: message.usage?.input_tokens ?? null,
      output_tokens: message.usage?.output_tokens ?? null,
    },
  }
}

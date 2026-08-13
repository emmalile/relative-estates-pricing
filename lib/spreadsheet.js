import ExcelJS from 'exceljs'

// Turning a workbook into something a model can read.
//
// A .xlsx is a zip of XML, so unlike a PDF it cannot be handed over as-is.
// It is flattened here into one CSV block per sheet, which keeps the row and
// column structure that makes a supplier schedule legible while staying plain
// text. Sheet names are kept so a reviewer can be told which sheet a line
// item came from.

// A workbook can hold far more than belongs in one request. These bounds keep
// a runaway file from silently consuming the whole context; when one bites,
// the text says so rather than ending mid-row with no explanation.
const MAX_SHEETS = 12
const MAX_ROWS_PER_SHEET = 2000
const MAX_CHARS = 400_000

// Cells are not plain values: a formula cell carries its formula and its last
// computed result, rich text arrives as runs, and a hyperlink as a pair. What
// matters for a schedule is the value a person would see in the cell.
function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    // A formula cell: use what it evaluated to, not the formula itself. A
    // supplier's totals column is nearly always computed.
    if ('result' in value) return cellText(value.result)
    if ('richText' in value) return (value.richText || []).map(r => r.text).join('')
    if ('text' in value) return String(value.text)
    if ('error' in value) return String(value.error)
    return ''
  }
  return String(value)
}

function csvEscape(s) {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function workbookToText(bytes, fileName) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)

  const parts = []
  const skipped = []
  let sheetCount = 0

  workbook.eachSheet(sheet => {
    if (sheetCount >= MAX_SHEETS) { skipped.push(sheet.name); return }
    sheetCount++

    const lines = []
    let truncated = false

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS_PER_SHEET) { truncated = true; return }
      // row.values is 1-based with a hole at index 0.
      const cells = (row.values || []).slice(1).map(v => csvEscape(cellText(v)))
      // Keep the row number: it is what a reviewer uses to find the row again.
      lines.push(`${rowNumber},${cells.join(',')}`)
    })

    if (!lines.length) return

    parts.push(
      `<sheet name="${sheet.name}">\n` +
      'row,' + 'columns follow in spreadsheet order\n' +
      lines.join('\n') +
      (truncated ? `\n… truncated at row ${MAX_ROWS_PER_SHEET}` : '') +
      '\n</sheet>'
    )
  })

  if (!parts.length) {
    throw new Error(`${fileName} has no readable rows — every sheet is empty.`)
  }

  let text = parts.join('\n\n')
  let charTruncated = false
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS)
    charTruncated = true
  }

  const warnings = []
  if (skipped.length) warnings.push(`Sheets not read (limit ${MAX_SHEETS}): ${skipped.join(', ')}`)
  if (charTruncated) warnings.push('The workbook was too large to include in full and was cut short.')

  return {
    text: warnings.length ? `${text}\n\n<note>${warnings.join(' ')}</note>` : text,
    sheetCount,
    warnings,
  }
}

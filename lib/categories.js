// ═══════════════════════════════════════════════════════
// CATEGORY LIBRARY
// ═══════════════════════════════════════════════════════
// This is the single source of truth for all material
// categories in the system.
//
// TO ADD A NEW CATEGORY:
// 1. Add an entry to the CATEGORIES object below
// 2. Define its csvColumns (how the CSV maps to fields)
// 3. Define its formFields (what the manufacturer fills out)
// 4. That's it — routing, dashboard, email all work automatically
// ═══════════════════════════════════════════════════════

export const CATEGORIES = {

  stone: {
    id: 'stone',
    label: 'Stone',
    icon: '◈',
    description: 'Natural stone, marble, travertine, quartzite',
    status: 'live',

    csvColumns: {
      name:   ['name', 'stone name', 'material'],
      finish: ['finish/color', 'finish', 'color'],
      cut:    ['cut', 'size', 'format'],
      room:   ['room', 'location', 'space'],
      area:   ['area', 'application', 'use'],
    },

    itemKeyFields: ['name', 'finish', 'cut'],

    formFields: [
      {
        id: 'priceSqm',
        label: 'Price per sqm (USD)',
        type: 'number',
        required: true,
        placeholder: '0.00',
        helpText: 'Enter your price per square meter in USD',
      },
      {
        id: 'priceSqft',
        label: 'Price per sq ft (auto-calculated)',
        type: 'calculated',
        formula: (val) => val ? (val / 10.7639).toFixed(2) : null,
        sourceField: 'priceSqm',
      },
      {
        id: 'moq',
        label: 'Minimum Order Qty (sqm)',
        type: 'number',
        required: false,
        placeholder: '0',
      },
      {
        id: 'volBreakQty',
        label: 'Volume Break Quantity (sqm)',
        type: 'number',
        required: false,
        placeholder: 'e.g. 100',
        helpText: 'Order quantity at which lower pricing applies',
      },
      {
        id: 'volBreakPrice',
        label: 'Volume Break Price / sqm (USD)',
        type: 'number',
        required: false,
        placeholder: '0.00',
      },
      {
        id: 'images',
        label: 'Material Sample Images',
        type: 'images',
        required: false,
        helpText: 'Upload one or more reference photos of this material',
      },
      {
        id: 'notes',
        label: 'Notes',
        type: 'textarea',
        required: false,
        placeholder: 'Lead time, availability, finish options, special considerations…',
      },
    ],

    dashboardPriceDisplay: (data) => ({
      primary: data.priceSqm ? `$${data.priceSqm}/sqm` : null,
      secondary: data.priceSqft ? `$${data.priceSqft}/sqft` : null,
      volume: data.volBreakQty && data.volBreakPrice
        ? `>${data.volBreakQty}sqm: $${data.volBreakPrice}/sqm`
        : null,
      moq: data.moq ? `Min: ${data.moq} sqm` : null,
    }),

    quantityUnit: 'sqm',
  },

  doors: {
    id: 'doors',
    label: 'Doors',
    icon: '▭',
    description: 'Interior and exterior doors',
    status: 'live',

    csvColumns: {
      no:           ['no', 'door no', 'door number'],
      location:     ['products name/photo', 'room', 'location'],
      description:  ['product description'],
      widthInches:  ['width (inches)', 'width inches'],
      heightInches: ['height (inches)', 'height inches'],
      thickMm:      ['thick(mm)', 'thick mm'],
      widthMm:      ['width (mm)', 'width mm'],
      heightMm:     ['height (mm)', 'height mm'],
      type:         ['door type'],
      unitPrice:    ['unit price (usd)', 'unit price'],
      qty:          ['qty'],
      totalArea:    ['total area'],
      amount:       ['amount (exw foshan)', 'total amount (usd)'],
      margin:       ['relative margin (10%)', 'relative margin'],
      totalPrice:   ['total price'],
    },

    itemKeyFields: ['no'],

    formFields: [
      { id: 'unitPrice', label: 'Unit Price (USD)', type: 'number', required: true, placeholder: '0.00' },
      { id: 'qty', label: 'Qty', type: 'number', required: false, placeholder: '1' },
      { id: 'totalArea', label: 'Total Area (sqm)', type: 'number', required: false, placeholder: '0.00' },
      { id: 'amount', label: 'Amount (USD)', type: 'number', required: false, placeholder: '0.00' },
      { id: 'margin', label: 'Relative Margin', type: 'number', required: false, placeholder: '0.10' },
      { id: 'totalPrice', label: 'Total Price (USD)', type: 'number', required: false, placeholder: '0.00' },
      { id: 'designOptions', label: 'Design Options', type: 'images', required: false, helpText: 'Upload up to 5 design options for the client to choose from' },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Hardware prep, fire rating, special notes…' },
    ],

    dashboardPriceDisplay: (data) => ({
      primary: data.totalPrice ? `$${data.totalPrice}` : null,
      secondary: data.unitPrice ? `$${data.unitPrice}/unit` : null,
      volume: null,
      moq: data.qty ? `Qty: ${data.qty}` : null,
    }),

    quantityUnit: 'units',
  },

  hardware: {
    id: 'hardware',
    label: 'Hardware',
    icon: '⬡',
    description: 'Door hardware, pulls, hinges, locks',
    status: 'coming_soon',
    csvColumns: {
      name:        ['name', 'item', 'product'],
      productLine: ['product line', 'line', 'series'],
      finish:      ['finish', 'color'],
      room:        ['room', 'location'],
      area:        ['area', 'application'],
    },
    itemKeyFields: ['name', 'productLine', 'finish'],
    formFields: [
      { id: 'pricePerPiece', label: 'Price per Piece (USD)', type: 'number', required: true, placeholder: '0.00' },
      { id: 'pricePerSet', label: 'Price per Set (USD)', type: 'number', required: false, placeholder: '0.00' },
      { id: 'finish', label: 'Finish', type: 'text', required: false, placeholder: 'e.g. Satin Brass' },
      { id: 'leadTimeWeeks', label: 'Lead Time (weeks)', type: 'number', required: false, placeholder: '0' },
      { id: 'moq', label: 'Minimum Order Qty', type: 'number', required: false, placeholder: '1' },
      { id: 'images', label: 'Product Images', type: 'images', required: false },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Availability, lead time, special notes…' },
    ],
    dashboardPriceDisplay: (data) => ({
      primary: data.pricePerPiece ? `$${data.pricePerPiece}/pc` : null,
      secondary: data.pricePerSet ? `$${data.pricePerSet}/set` : null,
      volume: null,
      moq: data.moq ? `Min: ${data.moq}` : null,
    }),
    quantityUnit: 'pieces',
  },

  lighting: {
    id: 'lighting',
    label: 'Lighting',
    icon: '◎',
    description: 'Fixtures, pendants, chandeliers, sconces',
    status: 'coming_soon',
    csvColumns: {
      name:        ['name', 'fixture', 'item'],
      fixtureType: ['fixture type', 'type', 'category'],
      finish:      ['finish', 'color', 'material'],
      room:        ['room', 'location', 'space'],
      area:        ['area', 'application'],
    },
    itemKeyFields: ['name', 'fixtureType', 'finish'],
    formFields: [
      { id: 'pricePerUnit', label: 'Price per Unit (USD)', type: 'number', required: true, placeholder: '0.00' },
      { id: 'finish', label: 'Finish', type: 'text', required: false, placeholder: 'e.g. Aged Brass' },
      { id: 'leadTimeWeeks', label: 'Lead Time (weeks)', type: 'number', required: false, placeholder: '0' },
      { id: 'isCustom', label: 'Custom or Standard', type: 'select', options: ['Standard', 'Custom', 'Semi-Custom'], required: false },
      { id: 'moq', label: 'Minimum Order Qty', type: 'number', required: false, placeholder: '1' },
      { id: 'images', label: 'Product Images', type: 'images', required: false },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Lead time, wattage, IP rating, special notes…' },
    ],
    dashboardPriceDisplay: (data) => ({
      primary: data.pricePerUnit ? `$${data.pricePerUnit}/unit` : null,
      secondary: data.isCustom ? data.isCustom : null,
      volume: null,
      moq: data.moq ? `Min: ${data.moq}` : null,
    }),
    quantityUnit: 'units',
  },

  flooring: {
    id: 'flooring',
    label: 'Flooring',
    icon: '▤',
    description: 'Hardwood, engineered wood, specialty flooring',
    status: 'coming_soon',
    csvColumns: {
      name:     ['name', 'species', 'material', 'product'],
      finish:   ['finish', 'stain', 'color'],
      width:    ['width', 'plank width', 'size'],
      room:     ['room', 'location', 'space'],
      area:     ['area', 'application'],
    },
    itemKeyFields: ['name', 'finish', 'width'],
    formFields: [
      { id: 'priceSqm', label: 'Price per sqm (USD)', type: 'number', required: true, placeholder: '0.00' },
      { id: 'priceSqft', label: 'Price per sq ft (auto)', type: 'calculated', formula: (v) => v ? (v / 10.7639).toFixed(2) : null, sourceField: 'priceSqm' },
      { id: 'finish', label: 'Finish', type: 'text', required: false, placeholder: 'e.g. Matte Oil' },
      { id: 'grade', label: 'Grade', type: 'text', required: false, placeholder: 'e.g. Select & Better' },
      { id: 'moq', label: 'Minimum Order (sqm)', type: 'number', required: false, placeholder: '0' },
      { id: 'volBreakQty', label: 'Volume Break (sqm)', type: 'number', required: false, placeholder: '0' },
      { id: 'volBreakPrice', label: 'Volume Break Price / sqm', type: 'number', required: false, placeholder: '0.00' },
      { id: 'images', label: 'Sample Images', type: 'images', required: false },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Lead time, grade, installation notes…' },
    ],
    dashboardPriceDisplay: (data) => ({
      primary: data.priceSqm ? `$${data.priceSqm}/sqm` : null,
      secondary: data.priceSqft ? `$${data.priceSqft}/sqft` : null,
      volume: data.volBreakQty && data.volBreakPrice ? `>${data.volBreakQty}sqm: $${data.volBreakPrice}` : null,
      moq: data.moq ? `Min: ${data.moq} sqm` : null,
    }),
    quantityUnit: 'sqm',
  },

  plumbing: {
    id: 'plumbing',
    label: 'Plumbing',
    icon: '⊕',
    description: 'Fixtures, fittings, faucets',
    status: 'coming_soon',
    csvColumns: {
      name:     ['name', 'item', 'fixture', 'product'],
      finish:   ['finish', 'color', 'material'],
      model:    ['model', 'sku', 'product code'],
      room:     ['room', 'location', 'space'],
      area:     ['area', 'application'],
    },
    itemKeyFields: ['name', 'finish', 'model'],
    formFields: [
      { id: 'pricePerUnit', label: 'Price per Unit (USD)', type: 'number', required: true, placeholder: '0.00' },
      { id: 'finish', label: 'Finish', type: 'text', required: false, placeholder: 'e.g. Brushed Nickel' },
      { id: 'leadTimeWeeks', label: 'Lead Time (weeks)', type: 'number', required: false, placeholder: '0' },
      { id: 'moq', label: 'Minimum Order Qty', type: 'number', required: false, placeholder: '1' },
      { id: 'images', label: 'Product Images', type: 'images', required: false },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Rough-in specs, lead time, availability…' },
    ],
    dashboardPriceDisplay: (data) => ({
      primary: data.pricePerUnit ? `$${data.pricePerUnit}/unit` : null,
      secondary: data.leadTimeWeeks ? `${data.leadTimeWeeks}wk lead` : null,
      volume: null,
      moq: null,
    }),
    quantityUnit: 'units',
  },

  cabinetry: {
    id: 'cabinetry',
    label: 'Cabinetry',
    icon: '▬',
    description: 'Kitchen, bath, and custom cabinetry',
    status: 'coming_soon',
    csvColumns: {
      name:     ['name', 'item', 'cabinet type'],
      material: ['material', 'species', 'finish'],
      style:    ['style', 'door style', 'design'],
      room:     ['room', 'location', 'space'],
      area:     ['area', 'application'],
    },
    itemKeyFields: ['name', 'material', 'style'],
    formFields: [
      { id: 'pricePerLinFt', label: 'Price per Linear Foot (USD)', type: 'number', required: false, placeholder: '0.00' },
      { id: 'pricePerUnit', label: 'Price per Unit (USD)', type: 'number', required: false, placeholder: '0.00' },
      { id: 'material', label: 'Material / Species', type: 'text', required: false, placeholder: 'e.g. Walnut' },
      { id: 'construction', label: 'Construction Type', type: 'text', required: false, placeholder: 'e.g. Frameless, Face-Frame' },
      { id: 'leadTimeWeeks', label: 'Lead Time (weeks)', type: 'number', required: false, placeholder: '0' },
      { id: 'images', label: 'Sample Images', type: 'images', required: false },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Finish options, lead time, installation notes…' },
    ],
    dashboardPriceDisplay: (data) => ({
      primary: data.pricePerLinFt ? `$${data.pricePerLinFt}/lin ft` : data.pricePerUnit ? `$${data.pricePerUnit}/unit` : null,
      secondary: data.leadTimeWeeks ? `${data.leadTimeWeeks}wk lead` : null,
      volume: null,
      moq: null,
    }),
    quantityUnit: 'lin ft',
  },

  tile: {
    id: 'tile',
    label: 'Tile',
    icon: '◫',
    description: 'Ceramic, porcelain, specialty tile',
    status: 'coming_soon',
    csvColumns: {
      name:   ['name', 'tile name', 'product', 'material'],
      finish: ['finish', 'color', 'glaze'],
      size:   ['size', 'format', 'cut', 'dimensions'],
      room:   ['room', 'location', 'space'],
      area:   ['area', 'application'],
    },
    itemKeyFields: ['name', 'finish', 'size'],
    formFields: [
      { id: 'priceSqm', label: 'Price per sqm (USD)', type: 'number', required: true, placeholder: '0.00' },
      { id: 'priceSqft', label: 'Price per sq ft (auto)', type: 'calculated', formula: (v) => v ? (v / 10.7639).toFixed(2) : null, sourceField: 'priceSqm' },
      { id: 'moq', label: 'Minimum Order (sqm)', type: 'number', required: false, placeholder: '0' },
      { id: 'volBreakQty', label: 'Volume Break (sqm)', type: 'number', required: false, placeholder: '0' },
      { id: 'volBreakPrice', label: 'Volume Break Price / sqm', type: 'number', required: false, placeholder: '0.00' },
      { id: 'images', label: 'Sample Images', type: 'images', required: false },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Lead time, grout joint recommendation, special notes…' },
    ],
    dashboardPriceDisplay: (data) => ({
      primary: data.priceSqm ? `$${data.priceSqm}/sqm` : null,
      secondary: data.priceSqft ? `$${data.priceSqft}/sqft` : null,
      volume: data.volBreakQty && data.volBreakPrice ? `>${data.volBreakQty}sqm: $${data.volBreakPrice}` : null,
      moq: data.moq ? `Min: ${data.moq} sqm` : null,
    }),
    quantityUnit: 'sqm',
  },

}

// Helper — get all live categories
export const liveCategories = Object.values(CATEGORIES).filter(c => c.status === 'live')

// Helper — get all categories (for the project setup selector)
export const allCategories = Object.values(CATEGORIES)

// Helper — get a single category by id
export const getCategory = (id) => CATEGORIES[id] || null

// Helper — parse a CSV for a given category
export function parseCSVForCategory(csvText, categoryId) {
  const category = getCategory(categoryId)
  if (!category) return []

  const lines = parseCSVLines(csvText)
  if (lines.length < 2) return []

  // Parse headers
  const rawHeaders = lines[0].map(h => h.trim().toLowerCase())

  // Map CSV headers to our field names
  const fieldMap = {}
  Object.entries(category.csvColumns).forEach(([fieldName, aliases]) => {
    const colIndex = rawHeaders.findIndex(h =>
      aliases.some(alias => h.includes(alias.toLowerCase()))
    )
    if (colIndex >= 0) fieldMap[fieldName] = colIndex
  })

  const rows = lines.slice(1).map(cols => {
    const row = {}
    Object.entries(fieldMap).forEach(([field, idx]) => {
      row[field] = (cols[idx] || '').trim()
    })
    return row
  })

  return buildScheduleItems(rows, category)
}

// Turns raw field-per-column rows into schedule items: drops empties,
// deduplicates on the category's key fields, and collects each duplicate's
// location onto the surviving item.
//
// Shared by CSV import and document extraction so an item lifted out of a PDF
// is indistinguishable from one imported from a spreadsheet — same key, same
// shape, same behaviour everywhere downstream.
export function buildScheduleItems(rows, category) {
  // The first key field identifies the row; without it there is no item.
  // (stone uses 'name', doors use 'no', etc.)
  const primaryField = category.itemKeyFields[0]
  const keyFields = category.itemKeyFields
  const map = {}

  rows
    .filter(r => r && String(r[primaryField] || '').trim())
    .forEach(row => {
      const k = keyFields.map(f => String(row[f] || '').trim()).join('|||')
      if (!map[k]) {
        map[k] = { ...row, key: k, locations: [] }
      }
      // Build location string from whichever location fields exist
      const loc = [row.room, row.area, row.location].filter(Boolean).join(' — ')
      if (loc && !map[k].locations.includes(loc)) {
        map[k].locations.push(loc)
      }
    })

  return Object.values(map)
}

// Carries room locations from the items already on a schedule onto the ones
// just parsed out of a CSV, matched on item key.
//
// A schedule import replaces items wholesale, so a CSV with no room column
// would otherwise blank every location on the project. That is exactly the
// shape of the manufacturer pricing export, which carries no rooms by
// design — importing one back would quietly cost you the room data.
//
// Only fills gaps: a CSV that does carry rooms wins, so this can't stop an
// import from legitimately changing where a material goes.
//
// Matching falls back from the full item key to the primary field alone
// (the material name), because a CSV that lost the room column has usually
// lost or reshaped the other key fields too — the pricing export merges
// finish and cut into one column, so its keys never match on the nose.
export function carryOverLocations(newItems, oldItems, categoryOrId) {
  if (!oldItems?.length) return newItems

  const category = typeof categoryOrId === 'string' ? getCategory(categoryOrId) : categoryOrId
  const primaryField = category?.itemKeyFields?.[0]
  const norm = v => String(v ?? '').trim().toLowerCase()

  const byKey = {}
  const byName = {}
  oldItems.forEach(item => {
    if (!item) return
    const locations = item.locations || []
    if (!locations.length) return
    if (item.key) byKey[item.key] = locations
    // First one wins: if two items share a name, we can't tell them apart,
    // so don't spread one's rooms over the other.
    if (primaryField && item[primaryField] != null) {
      const n = norm(item[primaryField])
      if (n && !(n in byName)) byName[n] = locations
    }
  })

  return (newItems || []).map(item => {
    if ((item.locations || []).length > 0) return item
    const match = byKey[item.key]
      || (primaryField ? byName[norm(item[primaryField])] : null)
    return match ? { ...item, locations: match } : item
  })
}

// Properly parse CSV text into rows of columns,
// handling quoted fields that contain commas and newlines
function parseCSVLines(text) {
  const rows = []
  let current = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        current.push(field)
        field = ''
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        current.push(field)
        if (current.some(c => c.trim())) rows.push(current)
        current = []
        field = ''
      } else {
        field += ch
      }
    }
  }
  // Last field / row
  current.push(field)
  if (current.some(c => c.trim())) rows.push(current)

  return rows
}

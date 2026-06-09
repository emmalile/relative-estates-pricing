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
    status: 'live',  // 'live' | 'coming_soon'

    // How to parse the uploaded CSV
    // Maps CSV column names (lowercase) to internal field names
    csvColumns: {
      name:   ['name', 'stone name', 'material'],
      finish: ['finish/color', 'finish', 'color'],
      cut:    ['cut', 'size', 'format'],
      room:   ['room', 'location', 'space'],
      area:   ['area', 'application', 'use'],
    },

    // The unique key that identifies each line item
    // (used to deduplicate rows from the CSV)
    itemKeyFields: ['name', 'finish', 'cut'],

    // Fields shown on the manufacturer form
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

    // How to display pricing in the dashboard
    dashboardPriceDisplay: (data) => ({
      primary: data.priceSqm ? `$${data.priceSqm}/sqm` : null,
      secondary: data.priceSqft ? `$${data.priceSqft}/sqft` : null,
      volume: data.volBreakQty && data.volBreakPrice
        ? `>${data.volBreakQty}sqm: $${data.volBreakPrice}/sqm`
        : null,
      moq: data.moq ? `Min: ${data.moq} sqm` : null,
    }),

    // Unit label shown next to quantity input
    quantityUnit: 'sqm',
  },

  // ─────────────────────────────────────────────────────
  // COMING SOON — scaffold is ready, activate when needed
  // To activate: change status to 'live' and fill in
  // csvColumns and formFields following the stone example
  // ─────────────────────────────────────────────────────

  doors: {
    id: 'doors',
    label: 'Doors',
    icon: '▭',
    description: 'Interior and exterior doors',
    status: 'coming_soon',
    csvColumns: {
      name:     ['name', 'door name', 'door type'],
      style:    ['style', 'design'],
      material: ['material', 'species', 'core'],
      room:     ['room', 'location', 'opening'],
      area:     ['area', 'application'],
    },
    itemKeyFields: ['name', 'style', 'material'],
    formFields: [
      { id: 'pricePerUnit', label: 'Price per Unit (USD)', type: 'number', required: true, placeholder: '0.00' },
      { id: 'material', label: 'Material / Species', type: 'text', required: false, placeholder: 'e.g. White Oak' },
      { id: 'finish', label: 'Finish', type: 'text', required: false, placeholder: 'e.g. Natural Oil' },
      { id: 'leadTimeWeeks', label: 'Lead Time (weeks)', type: 'number', required: false, placeholder: '0' },
      { id: 'moq', label: 'Minimum Order Qty', type: 'number', required: false, placeholder: '1' },
      { id: 'images', label: 'Product Images', type: 'images', required: false },
      { id: 'notes', label: 'Notes', type: 'textarea', required: false, placeholder: 'Hardware prep, fire rating, special notes…' },
    ],
    dashboardPriceDisplay: (data) => ({
      primary: data.pricePerUnit ? `$${data.pricePerUnit}/unit` : null,
      secondary: data.leadTimeWeeks ? `${data.leadTimeWeeks}wk lead` : null,
      volume: null,
      moq: data.moq ? `Min: ${data.moq} units` : null,
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

  const lines = csvText.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  // Parse headers
  const rawHeaders = lines[0].split(',').map(h =>
    h.trim().replace(/^"|"$/g, '').toLowerCase()
  )

  // Map CSV headers to our field names
  const fieldMap = {}
  Object.entries(category.csvColumns).forEach(([fieldName, aliases]) => {
    const colIndex = rawHeaders.findIndex(h =>
      aliases.some(alias => h.includes(alias.toLowerCase()))
    )
    if (colIndex >= 0) fieldMap[fieldName] = colIndex
  })

  // Parse rows
  const rows = lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    const row = {}
    Object.entries(fieldMap).forEach(([field, idx]) => {
      row[field] = cols[idx] || ''
    })
    return row
  }).filter(r => r.name)

  // Deduplicate by itemKeyFields
  const keyFields = category.itemKeyFields
  const map = {}
  rows.forEach(row => {
    const k = keyFields.map(f => row[f] || '').join('|||')
    if (!map[k]) {
      map[k] = {
        ...row,
        key: k,
        locations: [],
      }
    }
    const loc = [row.room, row.area].filter(Boolean).join(' — ')
    if (loc && !map[k].locations.includes(loc)) {
      map[k].locations.push(loc)
    }
  })

  return Object.values(map)
}

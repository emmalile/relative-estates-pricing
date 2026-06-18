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
      no:           ['NO', 'Door NO', 'Door Number'],
      location:     ['Products Name/Photo', 'Room', 'Location'],
      description:  ['Product Description'], 
      widthInches:  ['Width (Inches)', 'Width Inches'],
      heightInches: ['Height (Inches)', 'Height Inches'],
      thickMm:      ['Thick(MM)'],
      widthMm:      ['Width (MM)'],
      heightMm:     ['Height (MM)'],
      type:         ['Door Type'],
      unitPrice:    ['Unit Price (USD)'],
      qty:          ['Qty'],
      totalArea:    ['Total Area'],
      amount:       ['Total Amount (USD)', 'Amount (EXW Foshan)'],
      margin:       ['Relative Margin'],
      totalPrice:   ['Total Price (USD)'],
    },

    itemKeyFields: ['no'],

    formFields: [
      { id: 'unitPrice', label: 'Unit Price (USD)', type: 'number' },
      { id: 'qty', label: 'Qty', type: 'number' },
      { id: 'totalArea', label: 'Total Area (sqm)', type: 'number' },
      { id: 'amount', label: 'Amount (USD)', type: 'number' },
      { id: 'margin', label: 'Relative Margin', type: 'number' },
      { id: 'totalPrice', label: 'Total Price (USD)', type: 'number' },
      { id: 'designOptions', label: 'Design Options', type: 'images' },
    ],

    dashboardPriceDisplay: (data) => ({
      primary: data.totalPrice ? `$${data.totalPrice}` : null,
      secondary: data.unitPrice ? `$${data.unitPrice}/unit` : null,
      qty: data.qty ? `Qty: ${data.qty}` : null,
      totalArea: data.totalArea ? `${data.totalArea} sqm` : null,
    }),

    quantityUnit: 'units',
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

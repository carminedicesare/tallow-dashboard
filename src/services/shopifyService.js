/**
 * shopifyService.js
 * Fetches order data from the Shopify Admin REST API for the past 7 days.
 * Falls back to mock data if the API is not configured.
 */

import { COGS, ORDER_FEES } from '../cogsConfig.js'

// ─── Mock data for development / unconfigured state ──────────────────────────

const MOCK_ORDERS = {
  currentWeek: {
    orders: [
      {
        id: 'mock-1',
        created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
        total_price: '89.97',
        subtotal_price: '89.97',
        total_discounts: '0.00',
        refunds: [],
        line_items: [
          { sku: '8oz-original', quantity: 2, price: '34.99' },
          { sku: 'lip-balm',     quantity: 1, price: '19.99' },
        ],
      },
      {
        id: 'mock-2',
        created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        total_price: '34.99',
        subtotal_price: '34.99',
        total_discounts: '0.00',
        refunds: [],
        line_items: [
          { sku: '4oz-original', quantity: 1, price: '34.99' },
        ],
      },
      {
        id: 'mock-3',
        created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
        total_price: '114.97',
        subtotal_price: '114.97',
        total_discounts: '5.00',
        refunds: [],
        line_items: [
          { sku: 'face-balm',    quantity: 2, price: '39.99' },
          { sku: '4oz-original', quantity: 1, price: '34.99' },
        ],
      },
      {
        id: 'mock-4',
        created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
        total_price: '39.99',
        subtotal_price: '39.99',
        total_discounts: '0.00',
        refunds: [{ transactions: [{ amount: '39.99' }] }],
        line_items: [
          { sku: 'face-balm', quantity: 1, price: '39.99' },
        ],
      },
      {
        id: 'mock-5',
        created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
        total_price: '69.98',
        subtotal_price: '69.98',
        total_discounts: '0.00',
        refunds: [],
        line_items: [
          { sku: '8oz-original', quantity: 2, price: '34.99' },
        ],
      },
    ],
    isMock: true,
  },
  priorWeek: {
    orders: [
      {
        id: 'mock-pw-1',
        total_price: '74.98',
        subtotal_price: '74.98',
        total_discounts: '0.00',
        refunds: [],
        line_items: [
          { sku: '8oz-original', quantity: 1, price: '34.99' },
          { sku: '4oz-original', quantity: 1, price: '34.99' },
          { sku: 'lip-balm',     quantity: 1, price: '4.99'  },
        ],
      },
      {
        id: 'mock-pw-2',
        total_price: '79.98',
        subtotal_price: '79.98',
        total_discounts: '0.00',
        refunds: [],
        line_items: [
          { sku: 'face-balm', quantity: 2, price: '39.99' },
        ],
      },
      {
        id: 'mock-pw-3',
        total_price: '34.99',
        subtotal_price: '34.99',
        total_discounts: '0.00',
        refunds: [],
        line_items: [
          { sku: '4oz-original', quantity: 1, price: '34.99' },
        ],
      },
    ],
    isMock: true,
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLastMonday(weeksAgo = 0) {
  const now = new Date()
  const day = now.getDay() // 0 = Sun, 1 = Mon
  const diff = (day === 0 ? 6 : day - 1) + weeksAgo * 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function calculateRefunds(orders) {
  return orders.reduce((sum, order) => {
    if (!order.refunds || order.refunds.length === 0) return sum
    return sum + order.refunds.reduce((rSum, refund) => {
      return rSum + (refund.transactions || []).reduce((tSum, t) => {
        return tSum + parseFloat(t.amount || 0)
      }, 0)
    }, 0)
  }, 0)
}

function calcOrderFees(order) {
  const orderTotal = parseFloat(order.total_price || 0)
  const itemCount  = (order.line_items || []).reduce((s, i) => s + (i.quantity || 0), 0)

  const threepl = itemCount > 0
    ? ORDER_FEES.threepl_first_item + (Math.max(itemCount - 1, 0) * ORDER_FEES.threepl_additional_item)
    : 0
  const packaging  = ORDER_FEES.packaging
  const processing = (orderTotal * ORDER_FEES.shopify_processing_rate) + ORDER_FEES.shopify_processing_flat

  return { threepl, packaging, processing, total: threepl + packaging + processing }
}

function processOrders(orders) {
  const grossRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0)
  const refunds      = calculateRefunds(orders)
  const netRevenue   = grossRevenue - refunds
  const orderCount   = orders.length
  const aov          = orderCount > 0 ? netRevenue / orderCount : 0

  // Per-order fees totalled across all orders
  const totalOrderFees = orders.reduce((sum, o) => sum + calcOrderFees(o).total, 0)

  // Units sold per SKU
  const skuSales = {}
  orders.forEach(order => {
    ;(order.line_items || []).forEach(item => {
      const sku = item.sku || 'unknown'
      if (!skuSales[sku]) skuSales[sku] = { quantity: 0, revenue: 0 }
      skuSales[sku].quantity += item.quantity || 0
      skuSales[sku].revenue += parseFloat(item.price || 0) * (item.quantity || 0)
    })
  })

  // Enrich with COGS data
  const skuBreakdown = Object.entries(skuSales).map(([sku, data]) => {
    const cogsEntry = COGS[sku]
    const unitCost  = cogsEntry?.unitCost || 0
    const unitPrice = cogsEntry?.price || (data.quantity > 0 ? data.revenue / data.quantity : 0)
    const totalCOGS = unitCost * data.quantity
    const grossProfit = data.revenue - totalCOGS
    const marginPct   = data.revenue > 0 ? (grossProfit / data.revenue) * 100 : 0

    return {
      sku,
      name: cogsEntry?.name || sku,
      category: cogsEntry?.category || 'Other',
      quantity: data.quantity,
      revenue: data.revenue,
      unitCost,
      unitPrice,
      totalCOGS,
      grossProfit,
      marginPct,
    }
  })

  const totalCOGS       = skuBreakdown.reduce((s, p) => s + p.totalCOGS, 0)
  const totalAllCosts   = totalCOGS + totalOrderFees
  const grossMarginPct  = netRevenue > 0 ? ((netRevenue - totalCOGS) / netRevenue) * 100 : 0
  const netMarginPct    = netRevenue > 0 ? ((netRevenue - totalAllCosts) / netRevenue) * 100 : 0
  const netProfit       = netRevenue - totalAllCosts

  return {
    grossRevenue,
    refunds,
    netRevenue,
    orderCount,
    aov,
    totalCOGS,
    totalOrderFees,
    totalAllCosts,
    grossMarginPct,
    netMarginPct,
    netProfit,
    skuBreakdown,
  }
}

// ─── API fetch ────────────────────────────────────────────────────────────────

async function fetchOrders(createdAtMin, createdAtMax) {
  const storeUrl = import.meta.env.VITE_SHOPIFY_STORE_URL
  const token    = import.meta.env.VITE_SHOPIFY_ACCESS_TOKEN

  if (!storeUrl || !token) {
    throw new Error('Shopify not configured')
  }

  const params = new URLSearchParams({
    status: 'any',
    created_at_min: createdAtMin.toISOString(),
    created_at_max: createdAtMax.toISOString(),
    limit: '250',
    fields: 'id,created_at,total_price,subtotal_price,total_discounts,refunds,line_items',
  })

  // In local dev, call Shopify directly with the token
  // In production on Vercel, route through /api/shopify serverless function
  const isDev = import.meta.env.DEV
  const url = isDev
    ? `https://${storeUrl}/admin/api/2024-01/orders.json?${params.toString()}`
    : `/api/shopify?${params.toString()}`

  const headers = { 'Content-Type': 'application/json' }
  if (isDev) headers['X-Shopify-Access-Token'] = token

  const res = await fetch(url, { headers })

  if (!res.ok) {
    throw new Error(`Shopify API error: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  return data.orders || []
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getShopifyData() {
  const now = new Date()
  const thisMonday    = getLastMonday(0)
  const lastMonday    = getLastMonday(1)
  const twoWeeksAgo   = getLastMonday(2)

  try {
    const [currentOrders, priorOrders] = await Promise.all([
      fetchOrders(thisMonday, now),
      fetchOrders(lastMonday, thisMonday),
    ])

    return {
      current: { ...processOrders(currentOrders), isMock: false },
      prior:   { ...processOrders(priorOrders),   isMock: false },
    }
  } catch (err) {
    console.warn('Shopify API unavailable, using mock data:', err.message)
    return {
      current: { ...processOrders(MOCK_ORDERS.currentWeek.orders), isMock: true },
      prior:   { ...processOrders(MOCK_ORDERS.priorWeek.orders),   isMock: true },
    }
  }
}

/**
 * shopifyService.js
 * Full order-level P&L engine for Hide Tallow.
 */

import { COGS, ORDER_FEES } from '../cogsConfig.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getDateRange(preset) {
  const now = new Date()
  const today = new Date(now); today.setHours(23,59,59,999)

  const startOf = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x }

  const dayOfWeek = now.getDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1

  switch (preset) {
    case 'this_week': {
      const mon = new Date(now); mon.setDate(now.getDate() - daysSinceMonday); mon.setHours(0,0,0,0)
      return { start: mon, end: today, label: 'This Week' }
    }
    case 'last_week': {
      const mon = new Date(now); mon.setDate(now.getDate() - daysSinceMonday - 7); mon.setHours(0,0,0,0)
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999)
      return { start: mon, end: sun, label: 'Last Week' }
    }
    case 'last_7': {
      const start = new Date(now); start.setDate(now.getDate() - 6); start.setHours(0,0,0,0)
      return { start, end: today, label: 'Last 7 Days' }
    }
    case 'last_30': {
      const start = new Date(now); start.setDate(now.getDate() - 29); start.setHours(0,0,0,0)
      return { start, end: today, label: 'Last 30 Days' }
    }
    case 'this_month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return { start, end: today, label: 'This Month' }
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      return { start, end, label: 'Last Month' }
    }
    case 'last_90': {
      const start = new Date(now); start.setDate(now.getDate() - 89); start.setHours(0,0,0,0)
      return { start, end: today, label: 'Last 90 Days' }
    }
    case 'ytd': {
      const start = new Date(now.getFullYear(), 0, 1)
      return { start, end: today, label: 'Year to Date' }
    }
    default:
      return getDateRange('this_week')
  }
}

function calcOrderRefund(order) {
  if (!order.refunds || order.refunds.length === 0) return 0
  return order.refunds.reduce((rSum, refund) =>
    rSum + (refund.transactions || []).reduce((tSum, t) =>
      tSum + parseFloat(t.amount || 0), 0), 0)
}

function calcOrderFees(order) {
  const orderTotal = parseFloat(order.total_price || 0)
  const itemCount  = (order.line_items || []).reduce((s, i) => s + (i.quantity || 0), 0)
  const threepl    = itemCount > 0
    ? ORDER_FEES.threepl_first_item + (Math.max(itemCount - 1, 0) * ORDER_FEES.threepl_additional_item)
    : 0
  const packaging  = ORDER_FEES.packaging
  const processing = (orderTotal * ORDER_FEES.shopify_processing_rate) + ORDER_FEES.shopify_processing_flat
  return { threepl, packaging, processing, total: threepl + packaging + processing }
}

// ─── Shipping helpers ─────────────────────────────────────────────────────────

function calcShippingCollected(order) {
  // Sum what the customer actually paid for shipping
  if (!order.shipping_lines || order.shipping_lines.length === 0) return 0
  return order.shipping_lines.reduce((s, line) => s + parseFloat(line.price || 0), 0)
}

function calcPostageCost(order) {
  // Actual postage cost charged by 3PL — pulled from shipping_lines.source or
  // a future 3PL API integration. For now we use the discounted_price
  // (what Shopify negotiated rate is) as the best available proxy.
  // When we connect the 3PL API this function gets the real number.
  if (!order.shipping_lines || order.shipping_lines.length === 0) return 0
  return order.shipping_lines.reduce((s, line) => {
    // Use discounted_price if available (carrier rate), else fall back to price
    const cost = parseFloat(line.discounted_price ?? line.price ?? 0)
    return s + cost
  }, 0)
}

// ─── Order-level P&L ──────────────────────────────────────────────────────────

export function calcOrderPnL(order) {
  const grossRevenue     = parseFloat(order.total_price || 0)
  const shippingCollected = calcShippingCollected(order)
  const productRevenue   = grossRevenue - shippingCollected   // pure product revenue
  const refund           = calcOrderRefund(order)
  const netRevenue       = grossRevenue - refund
  const discounts        = parseFloat(order.total_discounts || 0)
  const fees             = calcOrderFees(order)
  const postageCost      = calcPostageCost(order)             // what 3PL charges for postage

  const lineItems = (order.line_items || []).map(item => {
    const sku       = item.sku || 'unknown'
    const cogsEntry = COGS[sku]
    const qty       = item.quantity || 0
    const unitPrice = parseFloat(item.price || 0)
    const unitCost  = cogsEntry?.unitCost || 0
    const revenue   = unitPrice * qty
    const cogs      = unitCost * qty
    return {
      sku,
      name: cogsEntry?.name || sku,
      category: cogsEntry?.category || 'Other',
      qty,
      unitPrice,
      unitCost,
      revenue,
      cogs,
      grossProfit: revenue - cogs,
      marginPct: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0,
    }
  })

  const totalCOGS    = lineItems.reduce((s, i) => s + i.cogs, 0)
  const grossProfit  = netRevenue - totalCOGS
  // Net profit includes: COGS + order fulfillment fees + actual postage cost
  const totalCosts   = totalCOGS + fees.total + postageCost
  const netProfit    = netRevenue - totalCosts
  const netMarginPct = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0
  // Shipping P&L: customer paid vs. what 3PL charges us
  const shippingMargin = shippingCollected - postageCost

  return {
    id:                order.id,
    orderNumber:       order.order_number || order.name || order.id,
    createdAt:         order.created_at,
    email:             order.email || '',
    grossRevenue,
    productRevenue,
    shippingCollected,
    postageCost,
    shippingMargin,
    refund,
    netRevenue,
    discounts,
    totalCOGS,
    fees,
    grossProfit,
    totalCosts,
    netProfit,
    netMarginPct,
    lineItems,
    itemCount: lineItems.reduce((s, i) => s + i.qty, 0),
    isRefunded: refund > 0,
  }
}

// ─── Period summary ───────────────────────────────────────────────────────────

export function summarizeOrders(orders) {
  const enriched = orders.map(calcOrderPnL)

  const grossRevenue        = enriched.reduce((s, o) => s + o.grossRevenue, 0)
  const refunds             = enriched.reduce((s, o) => s + o.refund, 0)
  const netRevenue          = enriched.reduce((s, o) => s + o.netRevenue, 0)
  const discounts           = enriched.reduce((s, o) => s + o.discounts, 0)
  const totalCOGS           = enriched.reduce((s, o) => s + o.totalCOGS, 0)
  const totalFees           = enriched.reduce((s, o) => s + o.fees.total, 0)
  const shippingCollected   = enriched.reduce((s, o) => s + o.shippingCollected, 0)
  const postageCost         = enriched.reduce((s, o) => s + o.postageCost, 0)
  const shippingMargin      = shippingCollected - postageCost
  const totalCosts          = totalCOGS + totalFees + postageCost
  const grossProfit         = netRevenue - totalCOGS
  const netProfit           = netRevenue - totalCosts
  const orderCount    = enriched.length
  const aov           = orderCount > 0 ? netRevenue / orderCount : 0
  const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0
  const netMarginPct   = netRevenue > 0 ? (netProfit  / netRevenue) * 100 : 0

  // SKU breakdown
  const skuMap = {}
  enriched.forEach(order => {
    order.lineItems.forEach(item => {
      if (!skuMap[item.sku]) skuMap[item.sku] = { ...item, qty: 0, revenue: 0, cogs: 0, grossProfit: 0 }
      skuMap[item.sku].qty         += item.qty
      skuMap[item.sku].revenue     += item.revenue
      skuMap[item.sku].cogs        += item.cogs
      skuMap[item.sku].grossProfit += item.grossProfit
    })
  })
  const skuBreakdown = Object.values(skuMap).map(s => ({
    ...s,
    marginPct: s.revenue > 0 ? (s.grossProfit / s.revenue) * 100 : 0,
    totalCOGS: s.cogs,
    quantity: s.qty,
  })).sort((a, b) => b.revenue - a.revenue)

  // Daily revenue for sparkline
  const dailyMap = {}
  enriched.forEach(o => {
    const day = o.createdAt?.split('T')[0] || 'unknown'
    if (!dailyMap[day]) dailyMap[day] = 0
    dailyMap[day] += o.netRevenue
  })
  const dailyRevenue = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue]) => ({ date, revenue }))

  // Fee breakdown
  const feeBreakdown = {
    threepl:    enriched.reduce((s, o) => s + o.fees.threepl, 0),
    packaging:  enriched.reduce((s, o) => s + o.fees.packaging, 0),
    processing: enriched.reduce((s, o) => s + o.fees.processing, 0),
    postage:    postageCost,
  }

  return {
    enrichedOrders: enriched,
    grossRevenue,
    refunds,
    netRevenue,
    discounts,
    totalCOGS,
    totalFees,
    feeBreakdown,
    shippingCollected,
    postageCost,
    shippingMargin,
    totalCosts,
    grossProfit,
    netProfit,
    orderCount,
    aov,
    grossMarginPct,
    netMarginPct,
    skuBreakdown,
    dailyRevenue,
  }
}

// ─── API fetch ────────────────────────────────────────────────────────────────

async function fetchOrders(start, end) {
  const storeUrl = import.meta.env.VITE_SHOPIFY_STORE_URL
  const token    = import.meta.env.VITE_SHOPIFY_ACCESS_TOKEN

  if (!storeUrl || !token) throw new Error('Shopify not configured')

  const params = new URLSearchParams({
    status: 'any',
    created_at_min: start.toISOString(),
    created_at_max: end.toISOString(),
    limit: '250',
    fields: 'id,name,order_number,created_at,email,total_price,subtotal_price,total_discounts,refunds,line_items,shipping_lines',
  })

  const isDev = import.meta.env.DEV
  const url   = isDev
    ? `https://${storeUrl}/admin/api/2024-01/orders.json?${params}`
    : `/api/shopify?${params}`

  const headers = { 'Content-Type': 'application/json' }
  if (isDev) headers['X-Shopify-Access-Token'] = token

  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Shopify API error: ${res.status}`)
  const data = await res.json()
  return data.orders || []
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getShopifyData(preset = 'this_week') {
  const range     = getDateRange(preset)
  const prevRange = getPriorRange(preset)

  try {
    const [orders, priorOrders] = await Promise.all([
      fetchOrders(range.start, range.end),
      fetchOrders(prevRange.start, prevRange.end),
    ])

    return {
      current:    { ...summarizeOrders(orders),      isMock: false, range },
      prior:      { ...summarizeOrders(priorOrders), isMock: false, range: prevRange },
      rawOrders:  orders,
    }
  } catch (err) {
    console.warn('Shopify API unavailable, using mock data:', err.message)
    const mockOrders = getMockOrders()
    return {
      current:   { ...summarizeOrders(mockOrders), isMock: true, range },
      prior:     { ...summarizeOrders([]),          isMock: true, range: prevRange },
      rawOrders: mockOrders,
    }
  }
}

function getPriorRange(preset) {
  switch (preset) {
    case 'this_week':   return getDateRange('last_week')
    case 'last_week':   { const r = getDateRange('last_week'); const s = new Date(r.start); s.setDate(s.getDate()-7); const e = new Date(r.end); e.setDate(e.getDate()-7); return { start: s, end: e, label: 'Prior Week' } }
    case 'last_7':      { const r = getDateRange('last_7');    const s = new Date(r.start); s.setDate(s.getDate()-7); const e = new Date(r.end);   e.setDate(e.getDate()-7); return { start: s, end: e, label: 'Prior 7 Days' } }
    case 'this_month':  return getDateRange('last_month')
    case 'last_month':  { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth()-2, 1); const e = new Date(n.getFullYear(), n.getMonth()-1, 0, 23,59,59); return { start: s, end: e, label: 'Prior Month' } }
    case 'last_30':     { const r = getDateRange('last_30');   const s = new Date(r.start); s.setDate(s.getDate()-30); const e = new Date(r.end); e.setDate(e.getDate()-30); return { start: s, end: e, label: 'Prior 30 Days' } }
    default:            return getDateRange('last_week')
  }
}

function getMockOrders() {
  // total_price includes shipping_lines price (as Shopify does)
  // shipping_lines[].price = what customer paid, discounted_price = carrier rate (3PL cost)
  // Orders over $75 have free shipping (customer pays $0, but 3PL still charges postage)
  return [
    { id:'m1', name:'#1001', order_number:1001, created_at: new Date(Date.now()-1*86400000).toISOString(), email:'a@test.com', total_price:'36.95', subtotal_price:'32.00', total_discounts:'0.00', refunds:[], line_items:[{ sku:'Everyday_Jar_Lavender', quantity:2, price:'16.00' }], shipping_lines:[{ price:'4.95', discounted_price:'6.20' }] },
    { id:'m2', name:'#1002', order_number:1002, created_at: new Date(Date.now()-2*86400000).toISOString(), email:'b@test.com', total_price:'31.95', subtotal_price:'27.00', total_discounts:'0.00', refunds:[], line_items:[{ sku:'OTGTin_Unscented', quantity:1, price:'11.00' }, { sku:'OTGTin_Lavender', quantity:1, price:'12.00' }, { sku:'PocketStick_Spearmint', quantity:1, price:'6.00' }], shipping_lines:[{ price:'4.95', discounted_price:'7.40' }] },
    { id:'m3', name:'#1003', order_number:1003, created_at: new Date(Date.now()-2*86400000).toISOString(), email:'c@test.com', total_price:'19.95', subtotal_price:'15.00', total_discounts:'0.00', refunds:[], line_items:[{ sku:'DailyBar_Lavender', quantity:1, price:'15.00' }], shipping_lines:[{ price:'4.95', discounted_price:'5.80' }] },
    { id:'m4', name:'#1004', order_number:1004, created_at: new Date(Date.now()-3*86400000).toISOString(), email:'d@test.com', total_price:'48.00', subtotal_price:'54.00', total_discounts:'6.00', refunds:[], line_items:[{ sku:'Everyday_Jar_Vanilla', quantity:3, price:'16.00' }], shipping_lines:[{ price:'0.00', discounted_price:'7.10' }] },
    { id:'m5', name:'#1005', order_number:1005, created_at: new Date(Date.now()-4*86400000).toISOString(), email:'e@test.com', total_price:'16.95', subtotal_price:'12.00', total_discounts:'0.00', refunds:[{ transactions:[{ amount:'16.95' }] }], line_items:[{ sku:'OTGTin_Lemongrass', quantity:1, price:'12.00' }], shipping_lines:[{ price:'4.95', discounted_price:'5.80' }] },
    { id:'m6', name:'#1006', order_number:1006, created_at: new Date(Date.now()-5*86400000).toISOString(), email:'f@test.com', total_price:'30.00', subtotal_price:'30.00', total_discounts:'0.00', refunds:[], line_items:[{ sku:'Everyday_Jar_Unscented', quantity:2, price:'15.00' }], shipping_lines:[{ price:'0.00', discounted_price:'6.20' }] },
  ]
}

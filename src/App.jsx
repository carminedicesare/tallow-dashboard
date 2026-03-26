import { useState, useEffect, useCallback, useRef } from 'react'
import { getShopifyData } from './services/shopifyService.js'
import { getMetaData }    from './services/metaService.js'
import { askClaude }      from './services/claudeService.js'
import { MONTHLY_FIXED }  from './cogsConfig.js'

// ─── Constants ────────────────────────────────────────────────────────────────
const CACHE_KEY    = 'tallow_dashboard_cache_v2'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000

const TIME_PRESETS = [
  { id: 'this_week',  label: 'This Week' },
  { id: 'last_week',  label: 'Last Week' },
  { id: 'last_7',     label: 'Last 7 Days' },
  { id: 'last_30',    label: 'Last 30 Days' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'last_90',    label: 'Last 90 Days' },
  { id: 'ytd',        label: 'YTD' },
]

const TABS = [
  { id: 'overview',  label: '📊 Overview' },
  { id: 'orders',    label: '🧾 Orders' },
  { id: 'products',  label: '📦 Products' },
  { id: 'cashflow',  label: '💰 Cash Flow' },
  { id: 'ads',       label: '📣 Ads' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function fmtPct(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—'
  return n.toFixed(decimals) + '%'
}
function fmtNum(n) {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('en-US')
}
function pctChange(curr, prev) {
  if (!prev || prev === 0) return null
  return ((curr - prev) / prev) * 100
}
function sign(n) {
  return n >= 0 ? '+' : ''
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, change, sub, accent }) {
  const dir = change === null || change === undefined ? 'flat' : change >= 0 ? 'up' : 'down'
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''
  return (
    <div className="kpi-card" style={accent ? { borderTopColor: accent, borderTopWidth: 2, borderTopStyle: 'solid' } : {}}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {change !== null && change !== undefined ? (
        <div className={`kpi-change ${dir}`}>
          {arrow && <span className="kpi-change-arrow">{arrow}</span>}
          <span>{Math.abs(change).toFixed(1)}% vs prior period</span>
        </div>
      ) : (
        <div className="kpi-change flat"><span>No prior period data</span></div>
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

// ─── Profit Pill ──────────────────────────────────────────────────────────────
function ProfitPill({ value }) {
  if (value == null || isNaN(value)) return <span style={{ color: 'var(--text-dim)' }}>—</span>
  const isPos = value >= 0
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 700,
      background: isPos ? 'rgba(76,212,128,0.12)' : 'rgba(240,94,94,0.12)',
      color: isPos ? 'var(--green)' : 'var(--red)',
    }}>
      {isPos ? '+' : ''}{fmt(value, 2)}
    </span>
  )
}

// ─── Margin Bar ───────────────────────────────────────────────────────────────
function MarginBar({ pct }) {
  if (pct == null) return <span style={{ color: 'var(--text-dim)' }}>—</span>
  const cls = pct >= 60 ? 'high' : pct >= 30 ? 'medium' : 'low'
  return (
    <div className="margin-bar">
      <div className="margin-track">
        <div className={`margin-fill ${cls}`} style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }} />
      </div>
      <span style={{ minWidth: 42, textAlign: 'right' }}>{fmtPct(pct)}</span>
    </div>
  )
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#7F77DD', height = 48 }) {
  if (!data || data.length < 2) return null
  const width = 260
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const pad = 4
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2)
    const y = height - pad - ((v - min) / range) * (height - pad * 2)
    return `${x},${y}`
  })
  const pathD = `M ${points.join(' L ')}`
  const areaD = `M ${points[0]} L ${points.join(' L ')} L ${width - pad},${height} L ${pad},${height} Z`
  const last = points[points.length - 1].split(',')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <defs>
        <linearGradient id={`grad-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#grad-${color.replace('#','')})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  )
}

// ─── Line Item Row ────────────────────────────────────────────────────────────
function LineRow({ label, value, color, bold, border, indent }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: `${border ? '10px' : '7px'} 0`,
      borderTop: border ? '1px solid var(--border)' : 'none',
      marginLeft: indent ? 16 : 0,
    }}>
      <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span style={{ fontSize: 13, color: color || 'var(--text)', fontWeight: bold ? 700 : 500 }}>{value}</span>
    </div>
  )
}

// ─── Income Statement ─────────────────────────────────────────────────────────
function IncomeStatement({ curr, metaData, weeklyFixed, totalMonthlyFixed, rangeLabel }) {
  if (!curr) return null
  const adSpend = metaData?.spend || 0
  const netAfterAds = curr.netProfit - adSpend - weeklyFixed

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="card-title">Income Statement — {rangeLabel}</div>

      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Revenue</div>
      <LineRow label="Product Revenue"      value={fmt((curr.grossRevenue||0) - (curr.shippingCollected||0), 2)} color="var(--green)" />
      <LineRow label="Shipping Collected"   value={curr.shippingCollected > 0 ? `+${fmt(curr.shippingCollected, 2)}` : '$0.00'} color={curr.shippingCollected > 0 ? 'var(--green)' : 'var(--text-dim)'} indent />
      <LineRow label="Gross Revenue"        value={fmt(curr.grossRevenue, 2)} bold />
      <LineRow label="Refunds"              value={curr.refunds > 0 ? `−${fmt(curr.refunds, 2)}` : '$0.00'} color={curr.refunds > 0 ? 'var(--red)' : 'var(--text-dim)'} indent />
      <LineRow label="Discounts"            value={curr.discounts > 0 ? `−${fmt(curr.discounts, 2)}` : '$0.00'} color={curr.discounts > 0 ? 'var(--red)' : 'var(--text-dim)'} indent />
      <LineRow label="Net Revenue"          value={fmt(curr.netRevenue, 2)} bold border />

      <div style={{ fontSize: 11, color: 'var(--text-dim)', margin: '14px 0 8px', textTransform: 'uppercase', letterSpacing: 0.6 }}>Cost of Goods</div>
      <LineRow label="Total COGS"           value={`−${fmt(curr.totalCOGS, 2)}`} color="var(--red)" />
      <LineRow label="Gross Profit"         value={fmt(curr.grossProfit, 2)} color={curr.grossProfit >= 0 ? 'var(--green)' : 'var(--red)'} bold border />
      <LineRow label="Gross Margin"         value={fmtPct(curr.grossMarginPct)} indent />

      <div style={{ fontSize: 11, color: 'var(--text-dim)', margin: '14px 0 8px', textTransform: 'uppercase', letterSpacing: 0.6 }}>Operating Expenses</div>
      <LineRow label="3PL Pick Fees"        value={`−${fmt(curr.feeBreakdown?.threepl, 2)}`}    color="var(--red)" indent />
      <LineRow label="Packaging"            value={`−${fmt(curr.feeBreakdown?.packaging, 2)}`}  color="var(--red)" indent />
      <LineRow label="Shopify Processing"   value={`−${fmt(curr.feeBreakdown?.processing, 2)}`} color="var(--red)" indent />
      <LineRow label="Postage / Shipping"   value={curr.postageCost > 0 ? `−${fmt(curr.postageCost, 2)}` : '—'} color={curr.postageCost > 0 ? 'var(--red)' : 'var(--text-dim)'} indent />
      <LineRow label="Total Variable Fees"  value={`−${fmt((curr.totalFees||0) + (curr.postageCost||0), 2)}`} color="var(--red)" />
      <LineRow label="Ad Spend (Meta)"      value={adSpend > 0 ? `−${fmt(adSpend, 2)}` : '—'}   color={adSpend > 0 ? 'var(--red)' : 'var(--text-dim)'} />
      <LineRow label={`Fixed Overhead (${fmt(totalMonthlyFixed)}/mo ÷ 4.33)`} value={`−${fmt(weeklyFixed, 2)}`} color="var(--red)" />

      <LineRow label="Operating Profit (EBITDA)"
        value={fmt(netAfterAds, 2)}
        color={netAfterAds >= 0 ? 'var(--green)' : 'var(--red)'}
        bold border />
      <LineRow label="Net Margin" value={curr.netRevenue > 0 ? fmtPct((netAfterAds / curr.netRevenue) * 100) : '—'} indent />
    </div>
  )
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────
function OrdersTab({ enrichedOrders }) {
  const [sortCol, setSortCol] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')
  const [search,  setSearch]  = useState('')
  const [expand,  setExpand]  = useState(null)

  if (!enrichedOrders || enrichedOrders.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>
        No orders in this period
      </div>
    )
  }

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const filtered = enrichedOrders.filter(o => {
    if (!search) return true
    const q = search.toLowerCase()
    return String(o.orderNumber).toLowerCase().includes(q) ||
           o.email.toLowerCase().includes(q) ||
           o.lineItems.some(li => li.name.toLowerCase().includes(q))
  })

  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol]
    if (sortCol === 'createdAt') { av = new Date(av); bv = new Date(bv) }
    if (av < bv) return sortDir === 'asc' ? -1 : 1
    if (av > bv) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function SortIcon({ col }) {
    if (sortCol !== col) return <span style={{ opacity: 0.25 }}>↕</span>
    return <span style={{ color: 'var(--purple)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="card-title" style={{ margin: 0 }}>Order P&amp;L — {filtered.length} orders</div>
        <input
          type="text"
          placeholder="Search order #, email, product…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '6px 12px', color: 'var(--text)', fontSize: 12, width: 240, outline: 'none',
          }}
        />
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('orderNumber')} style={{ cursor: 'pointer' }}>Order <SortIcon col="orderNumber" /></th>
              <th onClick={() => toggleSort('createdAt')}   style={{ cursor: 'pointer' }}>Date <SortIcon col="createdAt" /></th>
              <th>Email</th>
              <th onClick={() => toggleSort('grossRevenue')} style={{ cursor: 'pointer', textAlign: 'right' }}>Revenue <SortIcon col="grossRevenue" /></th>
              <th style={{ textAlign: 'right' }}>COGS</th>
              <th style={{ textAlign: 'right' }}>Fees</th>
              <th onClick={() => toggleSort('netProfit')} style={{ cursor: 'pointer', textAlign: 'right' }}>Net Profit <SortIcon col="netProfit" /></th>
              <th onClick={() => toggleSort('netMarginPct')} style={{ cursor: 'pointer', textAlign: 'right' }}>Margin <SortIcon col="netMarginPct" /></th>
              <th style={{ textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(order => (
              <>
                <tr
                  key={order.id}
                  onClick={() => setExpand(expand === order.id ? null : order.id)}
                  style={{ cursor: 'pointer' }}
                  className={expand === order.id ? 'row-expanded' : ''}
                >
                  <td><span style={{ color: 'var(--purple)', fontWeight: 600 }}>#{order.orderNumber}</span></td>
                  <td style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{order.email || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmt(order.grossRevenue, 2)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--red)' }}>−{fmt(order.totalCOGS, 2)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--red)' }}>−{fmt(order.fees?.total, 2)}</td>
                  <td style={{ textAlign: 'right' }}><ProfitPill value={order.netProfit} /></td>
                  <td style={{ textAlign: 'right' }}><MarginBar pct={order.netMarginPct} /></td>
                  <td style={{ textAlign: 'right' }}>
                    {order.isRefunded
                      ? <span style={{ fontSize: 11, color: 'var(--red)', background: 'rgba(240,94,94,0.1)', padding: '2px 7px', borderRadius: 4 }}>Refunded</span>
                      : <span style={{ fontSize: 11, color: 'var(--green)', background: 'rgba(76,212,128,0.1)', padding: '2px 7px', borderRadius: 4 }}>Paid</span>
                    }
                  </td>
                </tr>
                {expand === order.id && (
                  <tr key={`${order.id}-detail`} className="row-detail">
                    <td colSpan={9}>
                      <div style={{ padding: '12px 16px', background: 'var(--surface2)', borderRadius: 6, margin: '4px 0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                          {/* Line items */}
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Line Items</div>
                            {order.lineItems.map((li, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                                <span>{li.name} × {li.qty}</span>
                                <span style={{ color: 'var(--text-dim)' }}>{fmt(li.revenue, 2)} revenue · {fmt(li.cogs, 2)} COGS · <span style={{ color: li.grossProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(li.grossProfit, 2)} GP</span></span>
                              </div>
                            ))}
                          </div>
                          {/* Fee breakdown */}
                          <div>
                            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>Cost Breakdown</div>
                            {[
                              { l: 'Product Revenue',    v: fmt(order.productRevenue, 2),  c: 'var(--green)' },
                              { l: 'Shipping Collected', v: order.shippingCollected > 0 ? `+${fmt(order.shippingCollected, 2)}` : '$0.00', c: order.shippingCollected > 0 ? 'var(--green)' : 'var(--text-dim)' },
                              { l: 'Refund',             v: order.refund > 0 ? `−${fmt(order.refund, 2)}` : '—', c: order.refund > 0 ? 'var(--red)' : 'var(--text-dim)' },
                              { l: 'COGS',               v: `−${fmt(order.totalCOGS, 2)}`, c: 'var(--red)' },
                              { l: '3PL Pick Fees',      v: `−${fmt(order.fees?.threepl, 2)}`, c: 'var(--red)' },
                              { l: 'Packaging',          v: `−${fmt(order.fees?.packaging, 2)}`, c: 'var(--red)' },
                              { l: 'Processing Fee',     v: `−${fmt(order.fees?.processing, 2)}`, c: 'var(--red)' },
                              { l: 'Postage (3PL)',       v: order.postageCost > 0 ? `−${fmt(order.postageCost, 2)}` : '—', c: order.postageCost > 0 ? 'var(--red)' : 'var(--text-dim)' },
                              { l: 'Net Profit',         v: fmt(order.netProfit, 2), c: order.netProfit >= 0 ? 'var(--green)' : 'var(--red)', bold: true },
                            ].map(({ l, v, c, bold }) => (
                              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                                <span style={{ color: 'var(--text-dim)', fontWeight: bold ? 600 : 400 }}>{l}</span>
                                <span style={{ color: c, fontWeight: bold ? 700 : 500 }}>{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
          {/* Totals row */}
          {sorted.length > 0 && (() => {
            const totals = sorted.reduce((acc, o) => ({
              grossRevenue: acc.grossRevenue + o.grossRevenue,
              totalCOGS:    acc.totalCOGS    + o.totalCOGS,
              totalFees:    acc.totalFees    + (o.fees?.total || 0),
              netProfit:    acc.netProfit    + o.netProfit,
            }), { grossRevenue: 0, totalCOGS: 0, totalFees: 0, netProfit: 0 })
            const avgMargin = sorted.reduce((s, o) => s + o.netMarginPct, 0) / sorted.length
            return (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                  <td colSpan={3} style={{ fontSize: 12, color: 'var(--text-dim)', padding: '10px 12px' }}>Totals ({sorted.length} orders)</td>
                  <td style={{ textAlign: 'right', padding: '10px 12px' }}>{fmt(totals.grossRevenue, 2)}</td>
                  <td style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--red)' }}>−{fmt(totals.totalCOGS, 2)}</td>
                  <td style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--red)' }}>−{fmt(totals.totalFees, 2)}</td>
                  <td style={{ textAlign: 'right', padding: '10px 12px' }}><ProfitPill value={totals.netProfit} /></td>
                  <td style={{ textAlign: 'right', padding: '10px 12px' }}><MarginBar pct={avgMargin} /></td>
                  <td />
                </tr>
              </tfoot>
            )
          })()}
        </table>
      </div>
    </div>
  )
}

// ─── Products Tab ─────────────────────────────────────────────────────────────
function ProductsTab({ skuBreakdown }) {
  if (!skuBreakdown || skuBreakdown.length === 0) {
    return <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-dim)' }}>No product data</div>
  }

  const totalRevenue = skuBreakdown.reduce((s, sku) => s + sku.revenue, 0)
  const totalCOGS    = skuBreakdown.reduce((s, sku) => s + sku.cogs, 0)
  const totalGP      = skuBreakdown.reduce((s, sku) => s + sku.grossProfit, 0)
  const totalUnits   = skuBreakdown.reduce((s, sku) => s + sku.qty, 0)

  // Group by category
  const categories = {}
  skuBreakdown.forEach(sku => {
    const cat = sku.category || 'Other'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(sku)
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Total Revenue',    value: fmt(totalRevenue, 2),              color: 'var(--green)' },
          { label: 'Total COGS',       value: fmt(totalCOGS, 2),                 color: 'var(--red)' },
          { label: 'Gross Profit',     value: fmt(totalGP, 2),                   color: totalGP >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'Gross Margin',     value: fmtPct(totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0), color: 'var(--purple)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card" style={{ padding: 16, textAlign: 'center' }}>
            <div className="kpi-label">{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 6 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Per-category tables */}
      {Object.entries(categories).map(([cat, skus]) => {
        const catRev = skus.reduce((s, sk) => s + sk.revenue, 0)
        const catGP  = skus.reduce((s, sk) => s + sk.grossProfit, 0)
        return (
          <div key={cat} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{cat}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {fmt(catRev, 2)} revenue · <span style={{ color: catGP >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(catGP, 2)} gross profit</span>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU / Product</th>
                  <th style={{ textAlign: 'right' }}>Units</th>
                  <th style={{ textAlign: 'right' }}>Unit Price</th>
                  <th style={{ textAlign: 'right' }}>Unit COGS</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>COGS</th>
                  <th style={{ textAlign: 'right' }}>Gross Profit</th>
                  <th style={{ textAlign: 'right' }}>Margin</th>
                  <th style={{ textAlign: 'right' }}>Revenue Mix</th>
                </tr>
              </thead>
              <tbody>
                {[...skus].sort((a, b) => b.revenue - a.revenue).map(sku => (
                  <tr key={sku.sku}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{sku.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{sku.sku}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtNum(sku.qty)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(sku.unitPrice, 2)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-dim)' }}>{sku.unitCost > 0 ? fmt(sku.unitCost, 2) : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}>{fmt(sku.revenue, 2)}</td>
                    <td style={{ textAlign: 'right', color: 'var(--red)' }}>{sku.unitCost > 0 ? fmt(sku.cogs, 2) : '—'}</td>
                    <td style={{ textAlign: 'right' }}><ProfitPill value={sku.unitCost > 0 ? sku.grossProfit : null} /></td>
                    <td style={{ textAlign: 'right' }}><MarginBar pct={sku.unitCost > 0 ? sku.marginPct : null} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                        <div style={{ width: 60, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ width: `${(sku.revenue / totalRevenue) * 100}%`, height: '100%', background: 'var(--purple)', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', minWidth: 34, textAlign: 'right' }}>
                          {fmtPct((sku.revenue / totalRevenue) * 100, 0)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

// ─── Cash Flow Tab ────────────────────────────────────────────────────────────
function CashFlowTab({ curr, metaData, weeklyFixed, totalMonthlyFixed, rangeLabel }) {
  if (!curr) return null
  const adSpend = metaData?.spend || 0
  const netAfterAds = curr.netProfit - adSpend - weeklyFixed
  const dailyData = curr.dailyRevenue || []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top row: waterfall KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="kpi-label">Gross Revenue</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--green)', marginTop: 6 }}>{fmt(curr.grossRevenue, 2)}</div>
          {curr.refunds > 0 && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>−{fmt(curr.refunds, 2)} refunds</div>}
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="kpi-label">Gross Profit</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: curr.grossProfit >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 6 }}>{fmt(curr.grossProfit, 2)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>After COGS only · {fmtPct(curr.grossMarginPct)} margin</div>
        </div>
        <div className="card" style={{ textAlign: 'center', borderLeft: `3px solid ${netAfterAds >= 0 ? 'var(--green)' : 'var(--red)'}` }}>
          <div className="kpi-label">Net Operating Profit</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: netAfterAds >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 6 }}>{fmt(netAfterAds, 2)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>After all costs &amp; overhead</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Full Income Statement */}
        <IncomeStatement curr={curr} metaData={metaData} weeklyFixed={weeklyFixed} totalMonthlyFixed={totalMonthlyFixed} rangeLabel={rangeLabel} />

        {/* Fee Breakdown */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-title">Order Fee Breakdown</div>
            {[
              { label: '3PL Pick Fees',      value: curr.feeBreakdown?.threepl,    note: '$2.50 first item + $0.50 each add\'l' },
              { label: 'Packaging',           value: curr.feeBreakdown?.packaging,  note: `$0.30 × ${curr.orderCount} orders` },
              { label: 'Shopify Processing',  value: curr.feeBreakdown?.processing, note: '2.9% + $0.30 per txn' },
              { label: 'Postage (3PL actual)',value: curr.feeBreakdown?.postage,    note: 'Carrier rate charged by 3PL' },
            ].map(({ label, value, note }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{note}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>
                  {value != null && value > 0 ? `−${fmt(value, 2)}` : '—'}
                </div>
              </div>
            ))}
            {/* Shipping P&L summary */}
            <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--surface2)', borderRadius: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'var(--text-dim)' }}>Shipping collected from customers</span>
                <span style={{ color: 'var(--green)' }}>+{fmt(curr.shippingCollected, 2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: 'var(--text-dim)' }}>Actual postage cost (3PL)</span>
                <span style={{ color: 'var(--red)' }}>−{fmt(curr.postageCost, 2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                <span style={{ color: 'var(--text-dim)' }}>Shipping margin</span>
                <span style={{ color: (curr.shippingMargin || 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {(curr.shippingMargin || 0) >= 0 ? '+' : ''}{fmt(curr.shippingMargin, 2)}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 700, fontSize: 14 }}>
              <span>Total Variable Costs</span>
              <span style={{ color: 'var(--red)' }}>−{fmt((curr.totalFees || 0) + (curr.postageCost || 0), 2)}</span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Fixed Overhead (Monthly)</div>
            {[
              { label: 'Shopify Subscription',   value: 29,   note: 'Basic plan, billed annually' },
              { label: '3PL Account Management', value: 100,  note: '$25/week × 4' },
              { label: '3PL Storage',            value: 79,   note: '$19.25/week × 4 approx' },
              { label: 'Marketing Agency',        value: 1250, note: 'Monthly retainer' },
            ].map(({ label, value, note }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{note}</div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--red)' }}>−${value}/mo</div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontWeight: 700 }}>
              <span>Monthly Total</span>
              <span style={{ color: 'var(--red)' }}>−${totalMonthlyFixed}/mo</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
              <span>Weekly allocation</span>
              <span>−{fmt(weeklyFixed, 2)}/wk</span>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Revenue Chart */}
      {dailyData.length > 1 && (
        <div className="card">
          <div className="card-title">Daily Revenue Trend</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120, marginTop: 8 }}>
            {dailyData.map((d, i) => {
              const max = Math.max(...dailyData.map(x => x.revenue), 1)
              const pct = (d.revenue / max) * 100
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{fmt(d.revenue, 0)}</div>
                  <div style={{
                    width: '100%', height: `${pct}%`, minHeight: 4,
                    background: `linear-gradient(180deg, var(--purple), var(--purple-light))`,
                    borderRadius: '3px 3px 0 0', transition: 'height 0.4s ease',
                  }} />
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    {new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Ads Tab ──────────────────────────────────────────────────────────────────
function AdsTab({ metaData, curr }) {
  const adSpend = metaData?.spend || 0
  const isMock = metaData?.isMock
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isMock && (
        <div style={{ padding: '10px 14px', background: 'rgba(245,200,66,0.08)', border: '1px solid rgba(245,200,66,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--yellow)' }}>
          ⚠️ Showing placeholder data — add VITE_META_ACCESS_TOKEN and VITE_META_AD_ACCOUNT_ID to connect real Meta Ads data.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Ad Spend',    value: adSpend > 0 ? fmt(adSpend, 2) : '—' },
          { label: 'ROAS',        value: metaData?.roas != null ? `${metaData.roas.toFixed(2)}×` : '—' },
          { label: 'Impressions', value: metaData?.impressions != null ? fmtNum(metaData.impressions) : '—' },
          { label: 'Clicks',      value: metaData?.clicks != null ? fmtNum(metaData.clicks) : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="kpi-card">
            <div className="kpi-label">{label}</div>
            <div className="kpi-value" style={{ fontSize: 24 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-title">Meta Ads Metrics</div>
          {[
            { label: 'CPC (Cost per Click)',        value: metaData?.cpc  != null ? fmt(metaData.cpc, 2)       : '—' },
            { label: 'CPM (Cost per 1,000 impr.)',  value: metaData?.cpm  != null ? fmt(metaData.cpm, 2)       : '—' },
            { label: 'CTR (Click-through Rate)',    value: metaData?.ctr  != null ? fmtPct(metaData.ctr)       : '—' },
            { label: 'ROAS',                        value: metaData?.roas != null ? `${metaData.roas.toFixed(2)}×` : '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ color: 'var(--text-dim)' }}>{label}</span>
              <span style={{ fontWeight: 600, color: 'var(--purple)' }}>{value}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Ad Efficiency vs Revenue</div>
          {curr && adSpend > 0 && [
            { label: 'Net Revenue',    value: fmt(curr.netRevenue, 2),   color: 'var(--green)' },
            { label: 'Ad Spend',       value: `−${fmt(adSpend, 2)}`,      color: 'var(--red)' },
            { label: 'Revenue ex-Ads', value: fmt(curr.netRevenue - adSpend, 2), color: curr.netRevenue - adSpend >= 0 ? 'var(--green)' : 'var(--red)' },
            { label: 'ROAS',           value: metaData?.roas != null ? `${metaData.roas.toFixed(2)}×` : '—', color: 'var(--purple)' },
            { label: 'Ad Cost / Order',value: fmt(adSpend / (curr.orderCount || 1), 2), color: 'var(--text-dim)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ color: 'var(--text-dim)' }}>{label}</span>
              <span style={{ fontWeight: 600, color }}>{value}</span>
            </div>
          ))}
          {(!curr || adSpend === 0) && (
            <div style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: 20 }}>Connect Meta Ads to see efficiency metrics</div>
          )}
        </div>
      </div>

      {metaData?.sparkline && (
        <div className="card">
          <div className="card-title">Weekly Ad Spend Trend</div>
          <div style={{ marginTop: 8 }}>
            <Sparkline data={metaData.sparkline} height={60} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Claude Q&A ───────────────────────────────────────────────────────────────
function ClaudeQA({ financialData }) {
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState(null)
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)

  const suggestedQuestions = [
    'What was my best-performing product?',
    'Am I profitable after all costs?',
    'What is my biggest cost driver?',
    'Where can I improve margins?',
  ]

  async function handleAsk(q) {
    const text = q || question
    if (!text.trim()) return
    setLoading(true); setResponse(null); setError(null)
    try {
      const answer = await askClaude(text.trim(), financialData)
      setResponse(answer)
    } catch (err) {
      setError(err.message || 'Failed — check Anthropic API key in .env')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card qa-card">
      <div className="card-title">Ask Claude about your business</div>
      <div className="qa-input-row">
        <input
          className="qa-input"
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() } }}
          placeholder="e.g. What was my best-performing product this period?"
          disabled={loading}
        />
        <button className="btn-ask" onClick={() => handleAsk()} disabled={loading || !question.trim()}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      {!response && !error && !loading && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {suggestedQuestions.map(q => (
            <button key={q} onClick={() => { setQuestion(q); handleAsk(q) }} className="pill-btn">{q}</button>
          ))}
        </div>
      )}
      {loading && (
        <div className="qa-thinking">
          <div className="thinking-dots"><span>·</span><span>·</span><span>·</span></div>
          Analyzing your data…
        </div>
      )}
      {response && <div className="qa-response">{response}</div>}
      {error && <div className="qa-error"><strong>Error:</strong> {error}</div>}
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ curr, prev, metaData, weeklyFixed, totalMonthlyFixed, shopifyData }) {
  if (!curr) return null
  const adSpend = metaData?.spend || 0
  const netAfterAds = curr.netProfit - adSpend - weeklyFixed

  const netRevChange    = pctChange(curr.netRevenue, prev?.netRevenue)
  const orderChange     = pctChange(curr.orderCount, prev?.orderCount)
  const netProfitChange = pctChange(curr.netProfit,  prev?.netProfit)
  const grossMgChange   = curr && prev ? curr.grossMarginPct - prev.grossMarginPct : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI Row */}
      <div className="kpi-row">
        <KpiCard label="Net Revenue"    value={fmt(curr.netRevenue, 2)}    change={netRevChange}    sub={`${fmtNum(curr.orderCount)} orders · AOV ${fmt(curr.aov, 2)}`} />
        <KpiCard label="Gross Profit"   value={fmt(curr.grossProfit, 2)}   change={grossMgChange}   sub={`Gross margin ${fmtPct(curr.grossMarginPct)}`} accent={curr.grossProfit >= 0 ? 'var(--green)' : 'var(--red)'} />
        <KpiCard label="Net Profit"     value={fmt(curr.netProfit, 2)}     change={netProfitChange} sub={`Margin ${fmtPct(curr.netMarginPct)} · Fees ${fmt(curr.totalFees, 2)}`} accent={curr.netProfit >= 0 ? 'var(--green)' : 'var(--red)'} />
        <KpiCard label="Orders"         value={fmtNum(curr.orderCount)}    change={orderChange}     sub={curr.refunds > 0 ? `${fmt(curr.refunds, 2)} refunded` : 'No refunds'} />
      </div>

      {/* Second KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Net Operating Profit" value={fmt(netAfterAds, 2)}  change={null}  sub="After ads &amp; fixed overhead" accent={netAfterAds >= 0 ? 'var(--green)' : 'var(--red)'} />
        <KpiCard label="ROAS"                 value={metaData?.roas != null ? `${metaData.roas.toFixed(2)}×` : '—'}  change={null}  sub={adSpend > 0 ? `Spend ${fmt(adSpend, 2)}` : 'Connect Meta Ads'} />
        <KpiCard label="Total COGS"           value={fmt(curr.totalCOGS, 2)} change={null}  sub={`${fmtPct(curr.netRevenue > 0 ? (curr.totalCOGS/curr.netRevenue)*100 : 0)} of revenue`} />
        <KpiCard label="Total Fees"           value={fmt(curr.totalFees, 2)} change={null}  sub={`${fmtPct(curr.netRevenue > 0 ? (curr.totalFees/curr.netRevenue)*100 : 0)} of revenue`} />
      </div>

      {/* Mid row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
        {/* Revenue by product */}
        <div className="card">
          <div className="card-title">Revenue by Product</div>
          <div className="bar-list">
            {[...curr.skuBreakdown].sort((a, b) => b.revenue - a.revenue).map(sku => {
              const maxRev = Math.max(...curr.skuBreakdown.map(s => s.revenue), 1)
              return (
                <div key={sku.sku} className="bar-item">
                  <div className="bar-header">
                    <span className="bar-name">{sku.name}</span>
                    <div className="bar-meta">
                      <span className="bar-revenue">{fmt(sku.revenue, 2)}</span>
                      <span className="bar-units">{sku.quantity} units</span>
                      {sku.unitCost > 0 && <span style={{ fontSize: 11, color: sku.marginPct >= 50 ? 'var(--green)' : 'var(--yellow)' }}>{fmtPct(sku.marginPct)} margin</span>}
                    </div>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(sku.revenue / maxRev) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right col */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Quick cash flow */}
          <div className={`card cash-flow-card ${netAfterAds < 0 ? 'negative' : ''}`}>
            <div className="card-title">Cash Position</div>
            <div className={`cash-flow-amount ${netAfterAds >= 0 ? 'positive' : 'negative'}`}>{fmt(netAfterAds, 2)}</div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                { label: 'Net Revenue',    val: curr.netRevenue,       color: 'var(--green)' },
                { label: 'COGS',           val: -curr.totalCOGS,       color: 'var(--red)' },
                { label: 'Order fees',     val: -curr.totalFees,       color: 'var(--red)' },
                { label: 'Fixed overhead', val: -weeklyFixed,          color: 'var(--red)' },
                { label: 'Ad spend',       val: -adSpend,              color: 'var(--red)' },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-dim)' }}>{label}</span>
                  <span style={{ color, fontWeight: 600 }}>{val < 0 ? `−${fmt(Math.abs(val), 2)}` : fmt(val, 2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Meta ads quick */}
          <div className="card">
            <div className="card-title">Meta Ads</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Spend</div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{adSpend > 0 ? fmt(adSpend, 2) : '—'}</div>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                {[
                  { v: metaData?.cpc  != null ? fmt(metaData.cpc, 2)       : '—', l: 'CPC' },
                  { v: metaData?.ctr  != null ? fmtPct(metaData.ctr)       : '—', l: 'CTR' },
                  { v: metaData?.roas != null ? `${metaData.roas.toFixed(2)}×` : '—', l: 'ROAS' },
                ].map(({ v, l }) => (
                  <div key={l} style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--purple)' }}>{v}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Claude Q&A at bottom of Overview */}
      <ClaudeQA financialData={{ shopify: shopifyData, meta: metaData }} />
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [shopifyData, setShopifyData] = useState(null)
  const [metaData,    setMetaData]    = useState(null)
  const [loadStatus,  setLoadStatus]  = useState('idle')
  const [lastSynced,  setLastSynced]  = useState(null)
  const [error,       setError]       = useState(null)
  const [activeTab,   setActiveTab]   = useState('overview')
  const [preset,      setPreset]      = useState('this_week')

  // ── Cache helpers ──────────────────────────────────────────────────────────
  function cacheKey(p) { return `${CACHE_KEY}_${p}` }

  function readCache(p) {
    try {
      const raw = localStorage.getItem(cacheKey(p))
      if (!raw) return null
      const { ts, shopify, meta } = JSON.parse(raw)
      if (Date.now() - ts > CACHE_TTL_MS) return null
      return { shopify, meta, ts }
    } catch { return null }
  }

  function writeCache(p, shopify, meta) {
    try {
      localStorage.setItem(cacheKey(p), JSON.stringify({ ts: Date.now(), shopify, meta }))
    } catch {}
  }

  // ── Fetch data ─────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (force = false, p = preset) => {
    setLoadStatus('loading')
    setError(null)

    if (!force) {
      const cached = readCache(p)
      if (cached) {
        setShopifyData(cached.shopify)
        setMetaData(cached.meta)
        setLastSynced(new Date(cached.ts))
        setLoadStatus('done')
        return
      }
    }

    try {
      const shopify = await getShopifyData(p)
      const meta    = await getMetaData(shopify.current?.netRevenue || 0)
      setShopifyData(shopify)
      setMetaData(meta)
      setLastSynced(new Date())
      writeCache(p, shopify, meta)
      setLoadStatus('done')
    } catch (err) {
      console.error('Fetch error:', err)
      setError(err.message)
      setLoadStatus('error')
    }
  }, [preset])

  useEffect(() => { fetchData(false, preset) }, [preset])

  // ── Derived values ─────────────────────────────────────────────────────────
  const curr   = shopifyData?.current
  const prev   = shopifyData?.prior
  const isMock = curr?.isMock || metaData?.isMock

  const totalMonthlyFixed = Object.values(MONTHLY_FIXED).reduce((s, v) => s + v, 0)
  const weeklyFixed = totalMonthlyFixed / 4.33

  const rangeLabel = curr?.range?.label || 'This Period'

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="header-logo">Hide <span>Tallow</span></div>
          {isMock && <div className="mock-badge">Sample Data</div>}
        </div>
        <div className="header-right">
          <div className="sync-status">
            <span className={`sync-dot ${loadStatus === 'loading' ? 'loading' : loadStatus === 'error' ? 'error' : ''}`} />
            {loadStatus === 'loading' ? 'Syncing…'
              : loadStatus === 'error' ? 'Sync failed'
              : lastSynced
                ? `Synced ${lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Not synced'}
          </div>
          <button className="btn-refresh" onClick={() => fetchData(true, preset)} disabled={loadStatus === 'loading'}>
            ↻ Refresh
          </button>
        </div>
      </header>

      {/* ── Time Preset Bar ──────────────────────────────────────────────────── */}
      <div className="preset-bar">
        {TIME_PRESETS.map(p => (
          <button
            key={p.id}
            className={`preset-btn ${preset === p.id ? 'active' : ''}`}
            onClick={() => setPreset(p.id)}
            disabled={loadStatus === 'loading'}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Tab Bar ──────────────────────────────────────────────────────────── */}
      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {curr && (
          <div className="tab-range-label">{rangeLabel}</div>
        )}
      </div>

      {/* ── Loading / Error ───────────────────────────────────────────────────── */}
      {loadStatus === 'loading' && !curr && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span>Loading {rangeLabel}…</span>
        </div>
      )}
      {loadStatus === 'error' && !curr && (
        <div className="loading-overlay">
          <div style={{ fontSize: 32 }}>⚠️</div>
          <span>Failed to load: {error}</span>
          <button className="btn-refresh" onClick={() => fetchData(true, preset)}>Try again</button>
        </div>
      )}

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      {curr && (
        <main className="main">
          {loadStatus === 'loading' && (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, background: 'var(--purple)', zIndex: 100, animation: 'progressBar 1.5s ease-in-out infinite' }} />
          )}

          {activeTab === 'overview' && (
            <OverviewTab curr={curr} prev={prev} metaData={metaData} weeklyFixed={weeklyFixed} totalMonthlyFixed={totalMonthlyFixed} shopifyData={shopifyData} />
          )}
          {activeTab === 'orders' && (
            <OrdersTab enrichedOrders={curr.enrichedOrders} />
          )}
          {activeTab === 'products' && (
            <ProductsTab skuBreakdown={curr.skuBreakdown} />
          )}
          {activeTab === 'cashflow' && (
            <CashFlowTab curr={curr} metaData={metaData} weeklyFixed={weeklyFixed} totalMonthlyFixed={totalMonthlyFixed} rangeLabel={rangeLabel} />
          )}
          {activeTab === 'ads' && (
            <AdsTab metaData={metaData} curr={curr} />
          )}
        </main>
      )}

      <footer className="footer">
        Hide Tallow · Financial Dashboard · {isMock && '⚠ Sample Data — '} Data cached 12h
      </footer>
    </div>
  )
}

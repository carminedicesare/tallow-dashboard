import { useState, useEffect, useCallback, useRef } from 'react'
import { getShopifyData } from './services/shopifyService.js'
import { getMetaData }    from './services/metaService.js'
import { askClaude }      from './services/claudeService.js'

// ─── Constants ────────────────────────────────────────────────────────────────
const CACHE_KEY    = 'tallow_dashboard_cache'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

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

function getWeekLabel() {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  return `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────
function Sparkline({ data, color = '#7F77DD', height = 40 }) {
  if (!data || data.length < 2) return null
  const width = 240
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

  return (
    <div className="sparkline-container">
      <div className="sparkline-label">7-week spend trend</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height: `${height}px` }}>
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#sparkGrad)" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Current week dot */}
        {(() => {
          const last = points[points.length - 1].split(',')
          return <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
        })()}
      </svg>
    </div>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, change, sub, prefix = '', suffix = '' }) {
  const dir = change === null ? 'flat' : change >= 0 ? 'up' : 'down'
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—'
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{prefix}{value}{suffix}</div>
      {change !== null && change !== undefined ? (
        <div className={`kpi-change ${dir}`}>
          <span className="kpi-change-arrow">{arrow}</span>
          <span>{Math.abs(change).toFixed(1)}% vs last week</span>
        </div>
      ) : (
        <div className="kpi-change flat"><span>No prior week data</span></div>
      )}
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

// ─── Revenue Bar Chart ────────────────────────────────────────────────────────
function RevenueChart({ skuBreakdown }) {
  if (!skuBreakdown || skuBreakdown.length === 0) {
    return <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No product data</div>
  }

  const maxRev = Math.max(...skuBreakdown.map(s => s.revenue), 1)

  return (
    <div className="bar-list">
      {[...skuBreakdown]
        .sort((a, b) => b.revenue - a.revenue)
        .map(sku => (
          <div key={sku.sku} className="bar-item">
            <div className="bar-header">
              <span className="bar-name">{sku.name}</span>
              <div className="bar-meta">
                <span className="bar-revenue">{fmt(sku.revenue, 2)}</span>
                <span className="bar-units">{sku.quantity} units</span>
              </div>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(sku.revenue / maxRev) * 100}%` }}
              />
            </div>
          </div>
        ))
      }
    </div>
  )
}

// ─── SKU Margin Table ─────────────────────────────────────────────────────────
function SkuTable({ skuBreakdown }) {
  const hasRealCogs = skuBreakdown?.some(s => s.unitCost > 0)

  return (
    <div className="card sku-table-card">
      <div className="card-title">SKU Margin Breakdown</div>
      <table className="sku-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Units Sold</th>
            <th>Revenue</th>
            <th>Unit COGS</th>
            <th>Total COGS</th>
            <th>Gross Profit</th>
            <th>Margin</th>
          </tr>
        </thead>
        <tbody>
          {(!skuBreakdown || skuBreakdown.length === 0) ? (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '24px' }}>
                No sales data for this period
              </td>
            </tr>
          ) : (
            [...skuBreakdown]
              .sort((a, b) => b.revenue - a.revenue)
              .map(sku => {
                const marginClass = sku.marginPct >= 60 ? 'high' : sku.marginPct >= 30 ? 'medium' : 'low'
                return (
                  <tr key={sku.sku}>
                    <td><strong>{sku.name}</strong></td>
                    <td>{sku.quantity}</td>
                    <td>{fmt(sku.revenue, 2)}</td>
                    <td>{sku.unitCost > 0 ? fmt(sku.unitCost, 2) : <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                    <td>{sku.unitCost > 0 ? fmt(sku.totalCOGS, 2) : <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                    <td>{sku.unitCost > 0 ? fmt(sku.grossProfit, 2) : <span style={{ color: 'var(--text-dim)' }}>—</span>}</td>
                    <td>
                      <div className="margin-bar">
                        {sku.unitCost > 0 ? (
                          <>
                            <div className="margin-track">
                              <div
                                className={`margin-fill ${marginClass}`}
                                style={{ width: `${Math.min(sku.marginPct, 100)}%` }}
                              />
                            </div>
                            <span style={{ minWidth: 36 }}>{fmtPct(sku.marginPct)}</span>
                          </>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
          )}
        </tbody>
      </table>

      {!hasRealCogs && (
        <div className="cogs-notice">
          ⚠️ COGS not configured — edit <code style={{ fontFamily: 'monospace', fontSize: 11 }}>src/cogsConfig.js</code> to add your unit costs and see real margins.
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
  const inputRef = useRef(null)

  const suggestedQuestions = [
    'What was my best-performing product this week?',
    'How did my ROAS change vs last week?',
    'Am I profitable after ad spend?',
    'What\'s my biggest opportunity to improve margins?',
  ]

  async function handleAsk(q) {
    const text = q || question
    if (!text.trim()) return
    setLoading(true)
    setResponse(null)
    setError(null)
    try {
      const answer = await askClaude(text.trim(), financialData)
      setResponse(answer)
    } catch (err) {
      setError(err.message || 'Failed to get a response. Check your Anthropic API key.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }

  return (
    <div className="card qa-card">
      <div className="card-title">Ask Claude about your business</div>

      <div className="qa-input-row">
        <input
          ref={inputRef}
          className="qa-input"
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. What was my best-performing product this week?"
          disabled={loading}
        />
        <button
          className="btn-ask"
          onClick={() => handleAsk()}
          disabled={loading || !question.trim()}
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {!response && !error && !loading && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {suggestedQuestions.map(q => (
            <button
              key={q}
              onClick={() => { setQuestion(q); handleAsk(q) }}
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                padding: '5px 12px',
                fontSize: 12,
                color: 'var(--text-dim)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.target.style.borderColor = 'var(--purple)'
                e.target.style.color = 'var(--purple-light)'
              }}
              onMouseLeave={e => {
                e.target.style.borderColor = 'var(--border)'
                e.target.style.color = 'var(--text-dim)'
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="qa-thinking">
          <div className="thinking-dots">
            <span>·</span><span>·</span><span>·</span>
          </div>
          Analyzing your data…
        </div>
      )}

      {response && (
        <div className="qa-response">{response}</div>
      )}

      {error && (
        <div className="qa-error">
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [shopifyData, setShopifyData] = useState(null)
  const [metaData,    setMetaData]    = useState(null)
  const [loadStatus,  setLoadStatus]  = useState('idle') // idle | loading | done | error
  const [lastSynced,  setLastSynced]  = useState(null)
  const [error,       setError]       = useState(null)

  // ── Cache helpers ──────────────────────────────────────────────────────────
  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return null
      const { ts, shopify, meta } = JSON.parse(raw)
      if (Date.now() - ts > CACHE_TTL_MS) return null
      return { shopify, meta, ts }
    } catch { return null }
  }

  function writeCache(shopify, meta) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), shopify, meta }))
    } catch {}
  }

  // ── Fetch data ─────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (force = false) => {
    setLoadStatus('loading')
    setError(null)

    if (!force) {
      const cached = readCache()
      if (cached) {
        setShopifyData(cached.shopify)
        setMetaData(cached.meta)
        setLastSynced(new Date(cached.ts))
        setLoadStatus('done')
        return
      }
    }

    try {
      const shopify = await getShopifyData()
      const meta    = await getMetaData(shopify.current?.netRevenue || 0)

      setShopifyData(shopify)
      setMetaData(meta)
      setLastSynced(new Date())
      writeCache(shopify, meta)
      setLoadStatus('done')
    } catch (err) {
      console.error('Fetch error:', err)
      setError(err.message)
      setLoadStatus('error')
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Derived values ─────────────────────────────────────────────────────────
  const curr = shopifyData?.current
  const prev = shopifyData?.prior
  const isMock = curr?.isMock || metaData?.isMock

  const netRevChange   = pctChange(curr?.netRevenue,    prev?.netRevenue)
  const marginChange   = curr && prev ? curr.grossMarginPct - prev.grossMarginPct : null
  const roasChange     = metaData ? pctChange(metaData.roas, 1.5) : null // no prior meta for now
  const orderChange    = pctChange(curr?.orderCount, prev?.orderCount)

  const cashFlow = curr && metaData
    ? curr.netRevenue - curr.totalCOGS - metaData.spend
    : null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="header-logo">Hide <span>Tallow</span></div>
          <div className="header-week">{getWeekLabel()}</div>
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
          <button
            className="btn-refresh"
            onClick={() => fetchData(true)}
            disabled={loadStatus === 'loading'}
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      {/* Loading state */}
      {loadStatus === 'loading' && !curr && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span>Loading dashboard…</span>
        </div>
      )}

      {/* Error state (no data) */}
      {loadStatus === 'error' && !curr && (
        <div className="loading-overlay">
          <div style={{ fontSize: 32 }}>⚠️</div>
          <span>Failed to load: {error}</span>
          <button className="btn-refresh" onClick={() => fetchData(true)}>Try again</button>
        </div>
      )}

      {/* Main dashboard */}
      {curr && (
        <main className="main">

          {/* ── KPI Row ──────────────────────────────────────────────────────── */}
          <div className="kpi-row">
            <KpiCard
              label="Net Revenue"
              value={fmt(curr.netRevenue, 2)}
              change={netRevChange}
              sub={`${fmtNum(curr.orderCount)} orders · AOV ${fmt(curr.aov, 2)}`}
            />
            <KpiCard
              label="Gross Margin"
              value={curr.totalCOGS > 0 ? fmtPct(curr.grossMarginPct) : '—'}
              change={curr.totalCOGS > 0 && prev?.totalCOGS > 0 ? marginChange : null}
              sub={curr.totalCOGS > 0 ? `COGS ${fmt(curr.totalCOGS, 2)}` : 'Add COGS to cogsConfig.js'}
              suffix=""
            />
            <KpiCard
              label="ROAS"
              value={metaData?.roas != null ? `${metaData.roas.toFixed(2)}×` : '—'}
              change={null}
              sub={metaData?.spend > 0 ? `Spend ${fmt(metaData.spend, 2)}` : 'No ad spend data'}
            />
            <KpiCard
              label="Orders"
              value={fmtNum(curr.orderCount)}
              change={orderChange}
              sub={`${curr.refunds > 0 ? `${fmt(curr.refunds, 2)} refunded` : 'No refunds'}`}
            />
          </div>

          {/* ── Middle Row ───────────────────────────────────────────────────── */}
          <div className="middle-row">
            {/* Revenue by product */}
            <div className="card revenue-chart">
              <div className="card-title">Revenue by Product</div>
              <RevenueChart skuBreakdown={curr.skuBreakdown} />
            </div>

            {/* Right column */}
            <div className="right-col">
              {/* Cash Flow */}
              <div className={`card cash-flow-card ${cashFlow < 0 ? 'negative' : ''}`}>
                <div className="card-title">Net Cash Flow</div>
                <div className={`cash-flow-amount ${cashFlow >= 0 ? 'positive' : 'negative'}`}>
                  {cashFlow !== null ? fmt(cashFlow, 2) : '—'}
                </div>
                <div className="cash-flow-sub">
                  Revenue − COGS − Ad Spend
                  {curr.totalCOGS === 0 && <span style={{ display: 'block', marginTop: 4, color: 'var(--yellow)' }}>⚠ COGS not set</span>}
                </div>
              </div>

              {/* Ad Spend */}
              <div className="card ad-spend-card">
                <div className="card-title">Meta Ads — This Week</div>
                <div className="ad-spend-main">
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Spend</div>
                    <div className="ad-spend-amount">{metaData ? fmt(metaData.spend, 2) : '—'}</div>
                  </div>
                  <div className="ad-metrics">
                    <div className="ad-metric">
                      <div className="ad-metric-val">{metaData?.cpc != null ? fmt(metaData.cpc, 2) : '—'}</div>
                      <div className="ad-metric-label">CPC</div>
                    </div>
                    <div className="ad-metric">
                      <div className="ad-metric-val">{metaData?.cpm != null ? fmt(metaData.cpm, 2) : '—'}</div>
                      <div className="ad-metric-label">CPM</div>
                    </div>
                    <div className="ad-metric">
                      <div className="ad-metric-val">{metaData?.ctr != null ? fmtPct(metaData.ctr) : '—'}</div>
                      <div className="ad-metric-label">CTR</div>
                    </div>
                  </div>
                </div>
                {metaData?.sparkline && (
                  <Sparkline data={metaData.sparkline} />
                )}
              </div>
            </div>
          </div>

          {/* ── Bottom ───────────────────────────────────────────────────────── */}
          <div className="bottom-section">
            <SkuTable skuBreakdown={curr.skuBreakdown} />
            <ClaudeQA financialData={{ shopify: shopifyData, meta: metaData }} />
          </div>

        </main>
      )}

      <footer className="footer">
        Hide Tallow Dashboard · Data reloads every 12 hours ·
        {isMock && ' ⚠ Showing sample data — configure API keys to see real data'}
      </footer>
    </div>
  )
}

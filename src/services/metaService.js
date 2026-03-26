/**
 * metaService.js
 * Fetches ad performance data via /api/metaProxy (server-side token injection).
 * Falls back to mock data if the proxy is unavailable.
 */

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_META = {
  current: {
    spend: 312.45,
    impressions: 48200,
    clicks: 823,
    purchases: 12,
    purchaseValue: 489.88,
    isMock: true,
  },
  sparkline: [180, 220, 195, 310, 280, 330, 312],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractActionValue(actions, actionType) {
  if (!actions || !Array.isArray(actions)) return 0
  const action = actions.find(a => a.action_type === actionType)
  return action ? parseFloat(action.value || 0) : 0
}

function calculateMetrics(rawInsights, netRevenue) {
  const spend       = parseFloat(rawInsights.spend || 0)
  const impressions = parseInt(rawInsights.impressions || 0, 10)
  const clicks      = parseInt(rawInsights.clicks || 0, 10)
  const actions     = rawInsights.actions || []

  const purchases     = extractActionValue(actions, 'purchase')
  const purchaseValue = extractActionValue(actions, 'offsite_conversion.fb_pixel_purchase')

  const roas = spend > 0 && netRevenue > 0 ? netRevenue / spend : 0
  const cpc  = clicks > 0 ? spend / clicks : 0
  const cpm  = impressions > 0 ? (spend / impressions) * 1000 : 0
  const ctr  = impressions > 0 ? (clicks / impressions) * 100 : 0

  return { spend, impressions, clicks, purchases, purchaseValue, roas, cpc, cpm, ctr }
}

// ─── Sparkline: 7-week spend history ─────────────────────────────────────────

async function fetchSpendHistory() {
  const weeks = []
  const now = new Date()

  for (let i = 6; i >= 0; i--) {
    const since = new Date(now)
    since.setDate(since.getDate() - (i + 1) * 7)
    const until = new Date(now)
    until.setDate(until.getDate() - i * 7)

    const params = new URLSearchParams({
      path: 'act_422096433958662/insights',
      fields: 'spend',
      time_range: JSON.stringify({
        since: since.toISOString().split('T')[0],
        until: until.toISOString().split('T')[0],
      }),
    })

    const res = await fetch(`/api/metaProxy?${params.toString()}`)
    if (!res.ok) throw new Error(`Meta sparkline error: ${res.status}`)
    const data = await res.json()
    weeks.push(parseFloat(data?.data?.[0]?.spend || 0))
  }

  return weeks
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getMetaData(netRevenue = 0) {
  const mockFallback = (err) => {
    console.warn('Meta API unavailable, using mock data:', err?.message || err)
    const roas = MOCK_META.current.spend > 0 ? netRevenue / MOCK_META.current.spend : 1.57
    return {
      ...MOCK_META.current,
      roas,
      cpc:  MOCK_META.current.spend / MOCK_META.current.clicks,
      cpm:  (MOCK_META.current.spend / MOCK_META.current.impressions) * 1000,
      ctr:  (MOCK_META.current.clicks / MOCK_META.current.impressions) * 100,
      sparkline: MOCK_META.sparkline,
      isMock: true,
    }
  }

  try {
    const params = new URLSearchParams({
      path: 'act_422096433958662/insights',
      fields: 'spend,impressions,clicks,actions',
      date_preset: 'last_7d',
    })

    const [insightsRes, sparkline] = await Promise.all([
      fetch(`/api/metaProxy?${params.toString()}`),
      fetchSpendHistory(),
    ])

    if (!insightsRes.ok) {
      const errData = await insightsRes.json().catch(() => ({}))
      console.error('Meta insights error:', errData)
      return mockFallback(`Meta insights ${insightsRes.status}`)
    }

    const insightsData = await insightsRes.json()
    console.log('Meta raw response:', JSON.stringify(insightsData))
    const raw = insightsData?.data?.[0] || {}

    return {
      ...calculateMetrics(raw, netRevenue),
      sparkline,
      isMock: false,
    }
  } catch (err) {
    return mockFallback(err)
  }
}

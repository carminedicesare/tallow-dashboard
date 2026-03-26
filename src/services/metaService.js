/**
 * metaService.js
 * Fetches ad performance data from the Meta Marketing API.
 * Falls back to mock data if the API is not configured.
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
  sparkline: [180, 220, 195, 310, 280, 330, 312],  // 7-week spend history
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

// ─── Sparkline: fetch 7-week history ─────────────────────────────────────────

async function fetchSpendHistory(adAccountId, token) {
  const weeks = []
  const now = new Date()

  for (let i = 6; i >= 0; i--) {
    const since = new Date(now)
    since.setDate(since.getDate() - (i + 1) * 7)
    const until = new Date(now)
    until.setDate(until.getDate() - i * 7)

    const params = new URLSearchParams({
      fields: 'spend',
      time_range: JSON.stringify({
        since: since.toISOString().split('T')[0],
        until: until.toISOString().split('T')[0],
      }),
      access_token: token,
    })

    const proxyParams = new URLSearchParams({ path: `${adAccountId}/insights` })
    params.forEach((v, k) => proxyParams.append(k, v))
    const res = await fetch(`/api/metaProxy?${proxyParams.toString()}`)
    if (!res.ok) throw new Error(`Meta API error: ${res.status}`)
    const data = await res.json()
    const spend = parseFloat(data?.data?.[0]?.spend || 0)
    weeks.push(spend)
  }

  return weeks
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function getMetaData(netRevenue = 0) {
  const token       = import.meta.env.VITE_META_ACCESS_TOKEN
  const adAccountId = import.meta.env.VITE_META_AD_ACCOUNT_ID

  if (!token || !adAccountId) {
    console.warn('Meta Ads not configured, using mock data')
    const roas = MOCK_META.current.spend > 0 ? netRevenue / MOCK_META.current.spend : 0
    return {
      ...MOCK_META.current,
      roas: roas || 1.57,
      cpc:  MOCK_META.current.spend / MOCK_META.current.clicks,
      cpm:  (MOCK_META.current.spend / MOCK_META.current.impressions) * 1000,
      ctr:  (MOCK_META.current.clicks / MOCK_META.current.impressions) * 100,
      sparkline: MOCK_META.sparkline,
      isMock: true,
    }
  }

  try {
    const params = new URLSearchParams({
      fields: 'spend,impressions,clicks,actions',
      date_preset: 'last_7d',
      access_token: token,
    })

    const proxyParams = new URLSearchParams({ path: `${adAccountId}/insights` })
    params.forEach((v, k) => proxyParams.append(k, v))
    const [insightsRes, sparkline] = await Promise.all([
      fetch(`/api/metaProxy?${proxyParams.toString()}`),
      fetchSpendHistory(adAccountId, token),
    ])

    if (!insightsRes.ok) throw new Error(`Meta insights error: ${insightsRes.status}`)
    const insightsData = await insightsRes.json()
    const raw = insightsData?.data?.[0] || {}

    return {
      ...calculateMetrics(raw, netRevenue),
      sparkline,
      isMock: false,
    }
  } catch (err) {
    console.warn('Meta API unavailable, using mock data:', err.message)
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
}

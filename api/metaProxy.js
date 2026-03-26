/**
 * api/metaProxy.js
 * Vercel serverless function — CORS proxy for Meta Marketing API.
 * Token is injected server-side from env vars (never exposed to browser).
 *
 * Client calls: /api/metaProxy?path=act_XXXXX/insights&fields=...&date_preset=...
 * This proxy forwards to: https://graph.facebook.com/v19.0/act_XXXXX/insights?...&access_token=SERVER_TOKEN
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  const token = process.env.META_ACCESS_TOKEN
  const adAccountId = process.env.META_AD_ACCOUNT_ID

  if (!token || !adAccountId) {
    return res.status(503).json({ error: 'Meta not configured — missing META_ACCESS_TOKEN or META_AD_ACCOUNT_ID env vars' })
  }

  try {
    // Strip access_token from client params (we inject it server-side)
    const { path, access_token, ...rest } = req.query

    if (!path) {
      return res.status(400).json({ error: 'Missing path param' })
    }

    const forwardParams = new URLSearchParams()
    for (const [key, val] of Object.entries(rest)) {
      forwardParams.append(key, val)
    }
    // Inject token server-side
    forwardParams.append('access_token', token)

    const metaUrl = `https://graph.facebook.com/v19.0/${path}?${forwardParams.toString()}`
    console.log('Meta proxy →', `https://graph.facebook.com/v19.0/${path}?${new URLSearchParams(rest).toString()}&access_token=***`)

    const metaRes = await fetch(metaUrl)
    const data = await metaRes.json()

    if (!metaRes.ok) {
      console.error('Meta API error:', JSON.stringify(data))
      return res.status(metaRes.status).json(data)
    }

    return res.status(200).json(data)
  } catch (err) {
    console.error('Meta proxy error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

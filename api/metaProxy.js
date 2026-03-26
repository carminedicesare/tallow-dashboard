/**
 * api/metaProxy.js
 * Vercel serverless function — CORS proxy for Meta Marketing API.
 *
 * Client calls: /api/metaProxy?path=act_XXXXX/insights&fields=...&access_token=...
 * This proxy forwards to: https://graph.facebook.com/v19.0/act_XXXXX/insights?fields=...
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    const { path, ...rest } = req.query

    if (!path) {
      return res.status(400).json({ error: 'Missing path param' })
    }

    const forwardParams = new URLSearchParams()
    for (const [key, val] of Object.entries(rest)) {
      forwardParams.append(key, val)
    }

    const metaUrl = `https://graph.facebook.com/v19.0/${path}?${forwardParams.toString()}`
    console.log('Meta proxy →', metaUrl.replace(/access_token=[^&]+/, 'access_token=***'))

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

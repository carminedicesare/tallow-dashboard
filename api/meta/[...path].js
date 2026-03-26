/**
 * api/meta/[...path].js
 * Vercel catch-all serverless function — CORS proxy for Meta Marketing API.
 *
 * The client calls:  /api/meta/act_XXXXX/insights?fields=...&access_token=...
 * This proxy forwards to: https://graph.facebook.com/v19.0/act_XXXXX/insights?...
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    // req.query.path is an array of path segments from the catch-all
    // e.g. ['act_422096433958662', 'insights']
    const pathSegments = req.query.path || []
    const apiPath = Array.isArray(pathSegments) ? pathSegments.join('/') : pathSegments

    if (!apiPath) {
      return res.status(400).json({ error: 'Missing Meta API path' })
    }

    // Forward all query params except 'path' (which is the catch-all param)
    const forwardParams = new URLSearchParams()
    for (const [key, val] of Object.entries(req.query)) {
      if (key !== 'path') forwardParams.append(key, val)
    }

    const metaUrl = `https://graph.facebook.com/v19.0/${apiPath}?${forwardParams.toString()}`
    console.log('Meta proxy →', metaUrl)

    const metaRes = await fetch(metaUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

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

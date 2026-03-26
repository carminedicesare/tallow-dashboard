/**
 * api/meta.js
 * Vercel serverless function — CORS proxy for Meta Marketing API.
 * Route: /api/meta/[...path]
 *
 * The client calls:  /api/meta/act_XXXXX/insights?fields=...&access_token=...
 * This proxy forwards to: https://graph.facebook.com/v19.0/act_XXXXX/insights?...
 */

export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  try {
    // Extract the path after /api/meta/
    // req.url will be something like /api/meta/act_123/insights?fields=...
    const urlObj = new URL(req.url, `http://${req.headers.host}`)
    const pathParts = urlObj.pathname.replace(/^\/api\/meta\/?/, '')
    const queryString = urlObj.search // includes the leading '?'

    if (!pathParts) {
      return res.status(400).json({ error: 'Missing Meta API path' })
    }

    const metaUrl = `https://graph.facebook.com/v19.0/${pathParts}${queryString}`

    const metaRes = await fetch(metaUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    })

    const data = await metaRes.json()

    if (!metaRes.ok) {
      console.error('Meta API error:', data)
      return res.status(metaRes.status).json(data)
    }

    return res.status(200).json(data)
  } catch (err) {
    console.error('Meta proxy error:', err)
    return res.status(500).json({ error: err.message })
  }
}

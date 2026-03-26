/**
 * Vercel Serverless Function: /api/meta/[adAccountId]/insights
 * Proxies requests to the Meta Marketing API, keeping credentials server-side.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const token       = process.env.VITE_META_ACCESS_TOKEN
  const adAccountId = process.env.VITE_META_AD_ACCOUNT_ID

  if (!token || !adAccountId) {
    return res.status(503).json({ error: 'Meta not configured' })
  }

  // Build query params, injecting the server-side token
  const query = { ...req.query, access_token: token }
  delete query.params // remove the catch-all route param
  const queryString = new URLSearchParams(query).toString()

  const url = `https://graph.facebook.com/v19.0/${adAccountId}/insights?${queryString}`

  try {
    const metaRes = await fetch(url)
    if (!metaRes.ok) {
      const text = await metaRes.text()
      return res.status(metaRes.status).json({ error: text })
    }
    const data = await metaRes.json()
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

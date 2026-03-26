/**
 * Vercel Serverless Function: /api/shopify
 * Uses Shopify Dev Dashboard client credentials flow to get an access token,
 * then fetches orders. Token is cached for 23 hours.
 */

let cachedToken = null
let tokenExpiresAt = 0

async function getAccessToken(storeUrl, clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken
  }

  // Must use x-www-form-urlencoded, NOT JSON
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  })

  const res = await fetch(`https://${storeUrl}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token error ${res.status}: ${text.substring(0, 200)}`)
  }

  const data = await res.json()
  cachedToken = data.access_token
  tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000 // 23 hours
  console.log('Got fresh Shopify token')
  return cachedToken
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const storeUrl     = process.env.VITE_SHOPIFY_STORE_URL
  const clientId     = process.env.VITE_SHOPIFY_CLIENT_ID
  const clientSecret = process.env.VITE_SHOPIFY_CLIENT_SECRET

  if (!storeUrl || !clientId || !clientSecret) {
    return res.status(503).json({ error: 'Shopify not configured — missing env vars' })
  }

  try {
    const token = await getAccessToken(storeUrl, clientId, clientSecret)

    const queryString = new URLSearchParams(req.query).toString()
    const url = `https://${storeUrl}/admin/api/2024-01/orders.json?${queryString}`

    console.log('Fetching:', url)

    const shopifyRes = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': token },
    })

    if (!shopifyRes.ok) {
      const text = await shopifyRes.text()
      console.error('Orders error:', shopifyRes.status, text.substring(0, 200))
      return res.status(shopifyRes.status).json({ error: text.substring(0, 200) })
    }

    const data = await shopifyRes.json()
    console.log('Got', data.orders?.length, 'orders')
    return res.status(200).json(data)
  } catch (err) {
    console.error('Handler error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

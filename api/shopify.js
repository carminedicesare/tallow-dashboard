/**
 * Vercel Serverless Function: /api/shopify
 * Proxies requests to the Shopify Admin API using a direct access token.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const storeUrl = process.env.VITE_SHOPIFY_STORE_URL
  const token    = process.env.VITE_SHOPIFY_ACCESS_TOKEN

  if (!storeUrl || !token) {
    return res.status(503).json({ error: 'Shopify not configured' })
  }

  try {
    const queryString = new URLSearchParams(req.query).toString()
    const url = `https://${storeUrl}/admin/api/2024-01/orders.json?${queryString}`

    console.log('Fetching Shopify orders from:', url)

    const shopifyRes = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    })

    if (!shopifyRes.ok) {
      const text = await shopifyRes.text()
      console.error('Shopify orders error:', shopifyRes.status, text)
      return res.status(shopifyRes.status).json({ error: text })
    }

    const data = await shopifyRes.json()
    console.log('Shopify returned', data.orders?.length, 'orders')
    return res.status(200).json(data)
  } catch (err) {
    console.error('Shopify handler error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

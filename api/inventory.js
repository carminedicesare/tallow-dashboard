/**
 * Vercel Serverless Function: /api/inventory
 * Fetches all product variants with inventory levels from Shopify.
 * Returns: [ { variantId, sku, title, productTitle, inventoryItemId, available } ]
 */

let cachedToken = null
let tokenExpiresAt = 0

async function getAccessToken(storeUrl, clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

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
  tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000
  return cachedToken
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET')

  const storeUrl     = process.env.VITE_SHOPIFY_STORE_URL
  const clientId     = process.env.VITE_SHOPIFY_CLIENT_ID
  const clientSecret = process.env.VITE_SHOPIFY_CLIENT_SECRET

  if (!storeUrl || !clientId || !clientSecret) {
    return res.status(503).json({ error: 'Shopify not configured' })
  }

  try {
    const token = await getAccessToken(storeUrl, clientId, clientSecret)
    const headers = { 'X-Shopify-Access-Token': token }

    // 1. Fetch all products (variants + SKUs)
    const variants = []
    let productsUrl = `https://${storeUrl}/admin/api/2024-01/products.json?limit=250&fields=id,title,variants`

    while (productsUrl) {
      const pRes = await fetch(productsUrl, { headers })
      if (!pRes.ok) {
        const text = await pRes.text()
        return res.status(pRes.status).json({ error: text.substring(0, 200) })
      }
      const pData = await pRes.json()
      for (const product of pData.products || []) {
        for (const v of product.variants || []) {
          variants.push({
            variantId:       v.id,
            inventoryItemId: v.inventory_item_id,
            sku:             v.sku || '',
            title:           v.title,
            productTitle:    product.title,
          })
        }
      }
      // Handle pagination via Link header
      const link = pRes.headers.get('link') || ''
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/)
      productsUrl = nextMatch ? nextMatch[1] : null
    }

    // 2. Fetch inventory levels for all inventory item IDs
    // Shopify allows up to 50 IDs per request
    const itemIds = variants.map(v => v.inventoryItemId).filter(Boolean)
    const levelMap = {}

    for (let i = 0; i < itemIds.length; i += 50) {
      const chunk = itemIds.slice(i, i + 50).join(',')
      const lvlRes = await fetch(
        `https://${storeUrl}/admin/api/2024-01/inventory_levels.json?inventory_item_ids=${chunk}&limit=250`,
        { headers }
      )
      if (!lvlRes.ok) continue
      const lvlData = await lvlRes.json()
      for (const level of lvlData.inventory_levels || []) {
        // Sum across all locations
        const id = level.inventory_item_id
        levelMap[id] = (levelMap[id] || 0) + (level.available || 0)
      }
    }

    // 3. Combine
    const result = variants.map(v => ({
      ...v,
      available: levelMap[v.inventoryItemId] ?? 0,
    }))

    return res.status(200).json({ variants: result })
  } catch (err) {
    console.error('Inventory handler error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}

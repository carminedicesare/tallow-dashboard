/**
 * claudeService.js
 * Sends the user's question + current financial data context to Claude.
 * Requires VITE_ANTHROPIC_API_KEY to be set.
 *
 * NOTE: In production on Vercel, this call is routed through /api/claude
 * to keep the API key server-side. The Vercel function acts as a proxy.
 */

const SYSTEM_PROMPT = `You are a financial analyst for a small tallow skincare business called Hide Tallow.
Answer questions about the business's weekly financial performance clearly and concisely.
Use only the data provided in the user's message context.
Be direct — the owner wants actionable insight, not fluff.
Format numbers as currency where appropriate. Keep responses under 200 words unless a detailed breakdown is explicitly requested.`

export async function askClaude(question, financialData) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY

  // Build rich context from current data
  const context = buildContext(financialData)

  const userMessage = `Here is the current week's financial data for Hide Tallow:\n\n${context}\n\nQuestion: ${question}`

  try {
    // Route through Vercel serverless function in production
    // (keeps API key server-side; falls back to direct call for local dev)
    const useProxy = !apiKey || window.location.hostname !== 'localhost'

    let response

    if (useProxy) {
      response = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context }),
      })
    } else {
      // Direct call for local dev when key is in .env
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      })
    }

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Claude API error ${response.status}: ${err}`)
    }

    const data = await response.json()

    // Handle both direct Anthropic response and proxied response
    if (data.content) {
      return data.content[0]?.text || 'No response received.'
    } else if (data.answer) {
      return data.answer
    }

    throw new Error('Unexpected response format from Claude API')
  } catch (err) {
    console.error('Claude service error:', err)
    throw err
  }
}

function buildContext(data) {
  if (!data) return 'No data available.'

  const { shopify, meta } = data
  const curr = shopify?.current
  const prev = shopify?.prior

  const lines = []

  if (curr) {
    lines.push('=== THIS WEEK (Shopify) ===')
    lines.push(`Gross Revenue: $${curr.grossRevenue?.toFixed(2)}`)
    lines.push(`Refunds: $${curr.refunds?.toFixed(2)}`)
    lines.push(`Net Revenue: $${curr.netRevenue?.toFixed(2)}`)
    lines.push(`Order Count: ${curr.orderCount}`)
    lines.push(`AOV: $${curr.aov?.toFixed(2)}`)
    lines.push(`Total COGS: $${curr.totalCOGS?.toFixed(2)}`)
    lines.push(`Gross Margin: ${curr.grossMarginPct?.toFixed(1)}%`)
    lines.push('')

    if (curr.skuBreakdown?.length > 0) {
      lines.push('--- Product Breakdown ---')
      curr.skuBreakdown.forEach(sku => {
        lines.push(`${sku.name}: ${sku.quantity} units, $${sku.revenue?.toFixed(2)} revenue, ${sku.marginPct?.toFixed(1)}% margin`)
      })
      lines.push('')
    }
  }

  if (prev) {
    lines.push('=== PRIOR WEEK (Shopify) ===')
    lines.push(`Net Revenue: $${prev.netRevenue?.toFixed(2)}`)
    lines.push(`Order Count: ${prev.orderCount}`)
    lines.push(`Gross Margin: ${prev.grossMarginPct?.toFixed(1)}%`)
    lines.push('')
  }

  if (meta) {
    lines.push('=== THIS WEEK (Meta Ads) ===')
    lines.push(`Ad Spend: $${meta.spend?.toFixed(2)}`)
    lines.push(`ROAS: ${meta.roas?.toFixed(2)}x`)
    lines.push(`Impressions: ${meta.impressions?.toLocaleString()}`)
    lines.push(`Clicks: ${meta.clicks?.toLocaleString()}`)
    lines.push(`CPC: $${meta.cpc?.toFixed(2)}`)
    lines.push(`CPM: $${meta.cpm?.toFixed(2)}`)
    lines.push(`CTR: ${meta.ctr?.toFixed(2)}%`)
    if (meta.purchases > 0) lines.push(`Purchases tracked: ${meta.purchases}`)
  }

  const isMock = curr?.isMock || meta?.isMock
  if (isMock) lines.push('\n(Note: some or all data is sample/mock data — API keys not yet configured)')

  return lines.join('\n')
}

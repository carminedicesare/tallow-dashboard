/**
 * Vercel Serverless Function: /api/claude
 * Proxies chat requests to Anthropic, keeping the API key server-side.
 */

const SYSTEM_PROMPT = `You are a financial analyst for a small tallow skincare business called Hide Tallow.
Answer questions about the business's weekly financial performance clearly and concisely.
Use only the data provided in the user's message context.
Be direct — the owner wants actionable insight, not fluff.
Format numbers as currency where appropriate. Keep responses under 200 words unless a detailed breakdown is explicitly requested.`

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(503).json({ error: 'Anthropic API key not configured' })
  }

  const { question, context } = req.body

  if (!question) {
    return res.status(400).json({ error: 'question is required' })
  }

  const userMessage = `Here is the current week's financial data for Hide Tallow:\n\n${context || 'No data provided.'}\n\nQuestion: ${question}`

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!anthropicRes.ok) {
      const text = await anthropicRes.text()
      return res.status(anthropicRes.status).json({ error: text })
    }

    const data = await anthropicRes.json()
    const answer = data.content?.[0]?.text || 'No response.'

    return res.status(200).json({ answer })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method not allowed' }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
    }
  }

  try {
    const { system, user, useSearch } = JSON.parse(event.body)

    const result = await callAnthropic({ system, user, useSearch, apiKey })

    // If search was used but got empty result, retry without search
    if (!result && useSearch) {
      const fallbackResult = await callAnthropic({ system, user, useSearch: false, apiKey })
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ result: fallbackResult || '' }),
      }
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ result: result || '' }),
    }
  } catch (err) {
    console.error('Claude API error:', err)
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message || 'Internal server error' }),
    }
  }
}

async function callAnthropic({ system, user, useSearch, apiKey }) {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: user }],
  }

  if (useSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  // Extract text from response content blocks
  const textBlocks = (data.content || []).filter((block) => block.type === 'text')
  return textBlocks.map((block) => block.text).join('\n')
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

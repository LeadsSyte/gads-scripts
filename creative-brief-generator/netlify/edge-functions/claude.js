export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders() })
  }

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: corsHeaders() }
    )
  }

  try {
    const { system, user, useSearch } = await request.json()

    const result = await callAnthropic({ system, user, useSearch, apiKey })

    // If search was used but got empty result, retry without search
    if (!result && useSearch) {
      const fallbackResult = await callAnthropic({ system, user, useSearch: false, apiKey })
      return new Response(
        JSON.stringify({ result: fallbackResult || '' }),
        { status: 200, headers: corsHeaders() }
      )
    }

    return new Response(
      JSON.stringify({ result: result || '' }),
      { status: 200, headers: corsHeaders() }
    )
  } catch (err) {
    console.error('Claude API error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: corsHeaders() }
    )
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

export const config = {
  path: '/api/claude',
}

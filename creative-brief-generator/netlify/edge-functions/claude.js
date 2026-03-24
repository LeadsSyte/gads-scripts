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

    let result = await callAnthropicStreaming({ system, user, useSearch, apiKey })

    // If search was used but got empty result, retry without search
    if (!result && useSearch) {
      result = await callAnthropicStreaming({ system, user, useSearch: false, apiKey })
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

async function callAnthropicStreaming({ system, user, useSearch, apiKey }) {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    stream: true,
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

  // Read the SSE stream and collect text blocks
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    // Process complete SSE lines
    const lines = buffer.split('\n')
    buffer = lines.pop() // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const event = JSON.parse(data)

        // content_block_delta with text
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          fullText += event.delta.text
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  return fullText
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

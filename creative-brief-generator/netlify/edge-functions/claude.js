export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders('text/plain') })
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders('text/plain') })
  }

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: corsHeaders('application/json') }
    )
  }

  try {
    const { system, user, useSearch } = await request.json()

    const anthropicBody = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      stream: true,
      system,
      messages: [{ role: 'user', content: user }],
    }

    if (useSearch) {
      anthropicBody.tools = [{ type: 'web_search_20250305', name: 'web_search' }]
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicBody),
    })

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text()
      return new Response(
        JSON.stringify({ error: `Anthropic API error (${anthropicRes.status}): ${errorText}` }),
        { status: 500, headers: corsHeaders('application/json') }
      )
    }

    // Pipe the Anthropic SSE stream directly to the client
    return new Response(anthropicRes.body, {
      status: 200,
      headers: corsHeaders('text/event-stream'),
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      { status: 500, headers: corsHeaders('application/json') }
    )
  }
}

function corsHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

export const config = {
  path: '/api/claude',
}

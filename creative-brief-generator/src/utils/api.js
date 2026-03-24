export async function callClaude({ system, user, useSearch = false, timeoutMs }) {
  const timeout = timeoutMs || (useSearch ? 180000 : 120000)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, user, useSearch }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`API error (${res.status}): ${errorText}`)
    }

    const contentType = res.headers.get('content-type') || ''

    let result
    if (contentType.includes('text/event-stream')) {
      // Streaming SSE response — read and extract text deltas
      result = await readSSEStream(res)
    } else {
      // Regular JSON response (error fallback from edge function)
      const data = await res.json()
      result = data.result || ''
    }

    // If search was used but got empty response, retry without search
    if (!result && useSearch) {
      return callClaude({ system, user, useSearch: false, timeoutMs: 120000 })
    }

    return result
  } catch (err) {
    if (err.name === 'AbortError' && useSearch) {
      return callClaude({ system, user, useSearch: false, timeoutMs: 120000 })
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

async function readSSEStream(response) {
  const text = await response.text()
  let fullText = ''

  const lines = text.split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') continue

    try {
      const event = JSON.parse(data)
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        fullText += event.delta.text
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return fullText
}

export function parseJsonResponse(text) {
  // Try direct parse first
  try {
    return JSON.parse(text)
  } catch {
    // Try to extract JSON from markdown code fences
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) {
      return JSON.parse(match[1].trim())
    }
    // Try to find JSON object/array in the text
    const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1])
    }
    throw new Error('Could not parse JSON from response')
  }
}

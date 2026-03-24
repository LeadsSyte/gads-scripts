export async function callClaude({ system, user, useSearch = false, timeoutMs }) {
  const timeout = timeoutMs || (useSearch ? 150000 : 90000)
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

    const data = await res.json()

    // If search was used but got empty response, retry without search
    if (!data.result && useSearch) {
      return callClaude({ system, user, useSearch: false, timeoutMs: 90000 })
    }

    return data.result
  } catch (err) {
    if (err.name === 'AbortError' && useSearch) {
      // Search timed out, retry without search
      return callClaude({ system, user, useSearch: false, timeoutMs: 90000 })
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
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

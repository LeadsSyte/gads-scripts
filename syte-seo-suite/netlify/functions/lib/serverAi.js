// Server-side AI calls for the Autopilot. Keys come from the Netlify
// environment, never from a browser:
//   ANTHROPIC_API_KEY — the writer (same model the suite uses in the browser)
//   OPENAI_API_KEY    — the independent checker (a different AI on purpose)

import { CLAUDE_MODEL } from '../../../src/lib/anthropic.js';

export const CHECKER_MODEL = 'gpt-4o';

// Same shape as the browser's claudeComplete, so shared modules
// (topicResearchCore, articleRelevance) accept it as `complete`.
export async function claudeCompleteServer({ system, messages, max_tokens = 4096, temperature = 0.7, model = CLAUDE_MODEL }) {
  const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in the Netlify environment.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': key },
    body: JSON.stringify({ model, max_tokens, temperature, system, messages }),
    signal: AbortSignal.timeout(240000)
  });
  if (!res.ok) throw new Error('Claude API error: ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  return (data.content || []).map(b => b.text || '').join('');
}

export async function openaiJson({ system, user, model = CHECKER_MODEL, max_tokens = 1200 }) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw new Error('OPENAI_API_KEY is not set in the Netlify environment.');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model, max_tokens, temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    }),
    signal: AbortSignal.timeout(120000)
  });
  if (!res.ok) throw new Error('OpenAI API error: ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  try { return JSON.parse(text); } catch { throw new Error('Checker returned unreadable JSON'); }
}

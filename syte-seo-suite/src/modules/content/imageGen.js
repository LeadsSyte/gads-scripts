// AI image generation for article hero images. Supports two providers:
//   - Google Imagen 3 (via the Generative AI API — same key as Gemini)
//   - OpenAI DALL-E 3 (via the Images API — same key as GPT-4o)
//
// Both are opt-in per client. The caller passes a prompt derived from the
// article title + primary keyword + client industry. Returns a base64 data
// URL or a hosted URL depending on the provider.

import { loadSettings } from '../../lib/settings.js';

// ---------------------------------------------------------------------------
// Prompt builder — turns an article title into a good image prompt.
// ---------------------------------------------------------------------------

export function buildImagePrompt(articleTitle, keyword, client) {
  const industry = client?.industry || '';
  const location = client?.location || '';

  return `Professional, modern hero image for a blog article titled "${articleTitle}".
Topic: ${keyword || articleTitle}.
Industry: ${industry || 'business'}.
${location ? 'Setting/location feel: ' + location + '. ' : ''}
Style: Clean, editorial photography style. No text overlays. No watermarks.
Suitable for a professional website header. 16:9 aspect ratio.
High quality, well-lit, modern aesthetic.`.trim();
}

// ---------------------------------------------------------------------------
// Google Imagen 3
// ---------------------------------------------------------------------------

export async function generateWithImagen(prompt) {
  const { googleAiKey } = loadSettings();
  if (!googleAiKey) throw new Error('Google AI API key not set. Open Suite Settings.');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key='
    + encodeURIComponent(googleAiKey);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: '16:9',
        safetyFilterLevel: 'block_few'
      }
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // Imagen might not be enabled or available in all regions.
    if (res.status === 403 || res.status === 404) {
      throw new Error('Imagen 3 is not available on your Google AI account. Try DALL-E 3 instead. (' + res.status + ')');
    }
    throw new Error('Imagen error ' + res.status + ': ' + txt.slice(0, 200));
  }

  const data = await res.json();
  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen returned no image data.');

  return {
    provider: 'imagen',
    dataUrl: 'data:image/png;base64,' + b64,
    prompt
  };
}

// ---------------------------------------------------------------------------
// OpenAI DALL-E 3
// ---------------------------------------------------------------------------

export async function generateWithDalle(prompt) {
  const { openaiKey } = loadSettings();
  if (!openaiKey) throw new Error('OpenAI API key not set. Open Suite Settings.');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + openaiKey
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1792x1024', // closest to 16:9
      quality: 'standard',
      response_format: 'b64_json'
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('DALL-E error ' + res.status + ': ' + txt.slice(0, 200));
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('DALL-E returned no image data.');

  return {
    provider: 'dalle',
    dataUrl: 'data:image/png;base64,' + b64,
    revisedPrompt: data.data?.[0]?.revised_prompt || '',
    prompt
  };
}

// ---------------------------------------------------------------------------
// Unified caller — tries the preferred provider, falls back to the other.
// ---------------------------------------------------------------------------

// allowFallback: when the caller picked a provider explicitly via the UI,
// we want a useful error from THAT provider — not a misleading message
// from the other one tried as a silent fallback. Auto-selected callers
// (e.g. CMS auto-generate-on-push) can opt back into fallback.
export async function generateHeroImage(articleTitle, keyword, client, { preferredProvider = 'dalle', allowFallback = false } = {}) {
  const prompt = buildImagePrompt(articleTitle, keyword, client);
  const { openaiKey, googleAiKey } = loadSettings();

  const dalle  = { name: 'dalle',  fn: () => generateWithDalle(prompt),  available: !!openaiKey };
  const imagen = { name: 'imagen', fn: () => generateWithImagen(prompt), available: !!googleAiKey };
  const chosen = preferredProvider === 'imagen' ? imagen : dalle;
  const other  = preferredProvider === 'imagen' ? dalle  : imagen;

  if (!chosen.available && !other.available) {
    throw new Error('No image generation API key configured. Set OpenAI or Google AI key in Suite Settings.');
  }
  if (!chosen.available) {
    throw new Error(
      (preferredProvider === 'imagen' ? 'Imagen 3' : 'DALL-E 3') +
      ' selected but no API key is set for it. Add the key in Suite Settings, or pick the other provider.'
    );
  }

  try {
    return await chosen.fn();
  } catch (e) {
    if (!allowFallback || !other.available) throw e;
    console.warn(`[ImageGen] ${chosen.name} failed, falling back to ${other.name}:`, e.message);
    return await other.fn();
  }
}

// Download a data URL as a file.
export function downloadImage(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

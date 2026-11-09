// AI image generation for article hero images. Supports two providers:
//   - Google Imagen 3 (via the Generative AI API — same key as Gemini)
//   - OpenAI DALL-E 3 (via the Images API — same key as GPT-4o)
//
// Both are opt-in per client. The caller passes a prompt derived from the
// article title + primary keyword + client industry. Returns a base64 data
// URL or a hosted URL depending on the provider.

import { loadSettings } from '../../lib/settings.js';
import { fnUrl } from '../../lib/fnUrl.js';

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

// Google's image model, through the suite's gemini-proxy (the proxy holds
// the GOOGLE_AI_KEY). Imagen 3 and both OpenAI image models stopped working
// on Syte's accounts in Nov 2026 (every Autopilot draft lost its hero image),
// so this is now the default provider. The provider id stays 'imagen' so
// saved choices and the Generate Image button keep working.
export const GOOGLE_IMAGE_MODEL = 'gemini-2.5-flash-image';

export async function generateWithImagen(prompt) {
  const res = await fetch(fnUrl('gemini-proxy'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await (globalThis.__SYTE_AUTH_HEADERS?.() ?? {})) },
    body: JSON.stringify({
      model: GOOGLE_IMAGE_MODEL,
      payload: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } }
      }
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (res.status === 403 || res.status === 404) {
      throw new Error('Google image generation is not available on this account (' + res.status + '). Try DALL-E instead.');
    }
    throw new Error('Google image error ' + res.status + ': ' + txt.slice(0, 200));
  }

  const data = await res.json();
  const part = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data || p.inline_data?.data);
  const b64 = part?.inlineData?.data || part?.inline_data?.data;
  if (!b64) throw new Error('Google returned no image data.');
  const mime = part?.inlineData?.mimeType || part?.inline_data?.mime_type || 'image/png';

  return {
    provider: 'imagen',
    dataUrl: 'data:' + mime + ';base64,' + b64,
    prompt
  };
}

// ---------------------------------------------------------------------------
// OpenAI DALL-E 3
// ---------------------------------------------------------------------------

export async function generateWithDalle(prompt) {
  const { openaiKey } = loadSettings();
  if (!openaiKey) throw new Error('OpenAI API key not set. Open Suite Settings.');

  // OpenAI doesn't allow browser-direct CORS, so route through our
  // Netlify proxy. The proxy adds the Authorization header server-side
  // and returns the upstream response verbatim.
  const res = await fetch(fnUrl('openai-proxy'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await (globalThis.__SYTE_AUTH_HEADERS?.() ?? {})) },
    body: JSON.stringify({
      apiKey: openaiKey,
      endpoint: 'images/generations',
      body: {
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1792x1024', // closest to 16:9
        quality: 'standard'
        // response_format is rejected by the Images API since Nov 2026.
      }
    })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('DALL-E error ' + res.status + ': ' + txt.slice(0, 300));
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
// Google is the default: it is the provider that works on Syte's accounts
// (see GOOGLE_IMAGE_MODEL above).
export async function generateHeroImage(articleTitle, keyword, client, { preferredProvider = 'imagen', allowFallback = false } = {}) {
  const prompt = buildImagePrompt(articleTitle, keyword, client);
  const { openaiKey, googleAiKey } = loadSettings();

  const dalle  = { name: 'dalle',  fn: () => generateWithDalle(prompt),  available: !!openaiKey };
  const imagen = { name: 'imagen', fn: () => generateWithImagen(prompt), available: !!googleAiKey };
  const chosen = preferredProvider === 'imagen' ? imagen : dalle;
  const other  = preferredProvider === 'imagen' ? dalle  : imagen;

  if (!chosen.available && !other.available) {
    throw new Error('No image generation API key configured. Set OpenAI or Google AI key in Suite Settings.');
  }
  // Automatic callers (CMS push) just want an image: use whichever provider
  // has a key rather than failing because the default one has none.
  if (!chosen.available && allowFallback) return await other.fn();
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

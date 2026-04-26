import React, { useState } from 'react';
import { useClients } from '../store/useClients.js';
import { generateHeroImage, downloadImage } from '../modules/content/imageGen.js';
import { loadSettings } from '../lib/settings.js';

// Inline image generator button. Placed next to each article output.
// Shows the generated image with download + regenerate options.
//
// Props:
//   title: article title (used to build the image prompt)
//   keyword: primary keyword
//   disabled?: boolean
export default function GenerateImageButton({ title, keyword, disabled }) {
  const client = useClients(s => s.current());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [provider, setProvider] = useState('dalle');

  const settings = loadSettings();
  const hasDalle = !!settings.openaiKey;
  const hasImagen = !!settings.googleAiKey;
  const hasAny = hasDalle || hasImagen;

  async function generate() {
    if (!client) { setErr('Select a client first.'); return; }
    setBusy(true); setErr(''); setResult(null);
    try {
      const img = await generateHeroImage(title, keyword, client, { preferredProvider: provider });
      setResult(img);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!result?.dataUrl) return;
    const safeName = (title || 'hero').replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
    downloadImage(result.dataUrl, safeName + '.png');
  }

  if (!hasAny) return null; // Don't render if no image API keys are set.

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={provider}
          onChange={e => setProvider(e.target.value)}
          style={{ width: 130, fontSize: 11, padding: '5px 8px' }}
        >
          {hasDalle && <option value="dalle">DALL-E 3</option>}
          {hasImagen && <option value="imagen">Imagen 3</option>}
        </select>
        <button
          onClick={generate}
          disabled={disabled || busy || !title}
          style={{
            fontSize: 11, padding: '5px 14px',
            borderColor: 'var(--purple)', color: 'var(--purple)'
          }}
        >
          {busy ? 'Generating image…' : result ? 'Regenerate image' : '🎨 Generate hero image'}
        </button>
        {result && (
          <button onClick={download} style={{ fontSize: 11, padding: '5px 14px' }}>
            Download .png
          </button>
        )}
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 6 }}>{err}</div>}

      {result && (
        <div style={{ marginTop: 10 }}>
          <img
            src={result.dataUrl}
            alt={title || 'Generated hero image'}
            style={{
              width: '100%',
              maxHeight: 400,
              objectFit: 'cover',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)'
            }}
          />
          <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>
            {result.provider === 'dalle' ? 'DALL-E 3' : 'Imagen 3'}
            {result.revisedPrompt && (
              <span> · Prompt: {result.revisedPrompt.slice(0, 100)}{result.revisedPrompt.length > 100 ? '…' : ''}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
